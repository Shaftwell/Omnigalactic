import { auth } from '../firebase';

// Client transport for the /api/files Cloud Function. The function is the sole
// writer of both the Storage object and its Firestore metadata doc (the app's
// named DB is invisible to Storage rules), so this module never touches
// firebase/storage and performs NO Firestore write for files: on a successful
// upload/delete the parent's files subcollection onSnapshot (in
// AttachmentsPanel) reflects the change. It only POSTs/GETs/DELETEs bytes.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

export type AllowedAttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

type ParentType = 'vendors' | 'purchases';

// Some browsers report an empty file.type for HEIC (and occasionally an
// octet-stream for PDFs), so fall back to the extension to recover the type.
const EXTENSION_CONTENT_TYPES: Record<string, AllowedAttachmentType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

function isAllowedType(value: string): value is AllowedAttachmentType {
  return (ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(value);
}

// Resolves the content type to send: the browser-declared type when it is
// whitelisted, else the extension-mapped type, else null (unsupported).
function resolveContentType(file: File): AllowedAttachmentType | null {
  const declared = (file.type || '').split(';')[0].trim().toLowerCase();
  if (declared && isAllowedType(declared)) return declared;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPES[ext] ?? null;
}

async function requireIdToken(action: string): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error(`You must be signed in to ${action} files.`);
  return token;
}

function endpoint(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return `/api/files?${query}`;
}

// Pulls a server error message out of a fetch Response, guarding the body kind:
// a non-JSON body (an SPA index.html fallback, or a gateway 413/502 HTML page)
// must never be parsed as JSON.
async function errorMessageFromResponse(response: Response, fallback: string): Promise<string> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) return fallback;
  const body = await response.json().catch(() => null);
  if (body && typeof body.error === 'string' && body.error) return body.error;
  return fallback;
}

/**
 * Uploads a file to a vendor or purchase via the /api/files function. Uses
 * XMLHttpRequest so upload progress can be reported. Resolves once the function
 * has stored the bytes and written the metadata doc (no client Firestore write).
 */
export async function uploadAttachment(
  parentType: ParentType,
  parentId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (file.size === 0) throw new Error('That file is empty.');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`That file is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`);
  }
  const contentType = resolveContentType(file);
  if (!contentType) {
    throw new Error('Unsupported file type. Upload a PDF, JPEG, PNG, WebP, or HEIC.');
  }
  const token = await requireIdToken('upload');
  const url = endpoint({ parentType, parentId, fileName: file.name });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      const responseType = (xhr.getResponseHeader('content-type') ?? '').toLowerCase();
      const isJson = responseType.includes('application/json');
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok && isJson) {
        resolve();
        return;
      }
      if (!isJson) {
        // A 2xx non-JSON body is the dev/preview SPA fallback (index.html, 200)
        // — the upload endpoint isn't served here. A non-2xx non-JSON body is a
        // transport/gateway error whose HTML page we can't parse.
        reject(new Error(
          ok
            ? 'File uploads are only available on the deployed site.'
            : `Upload failed (${xhr.status}).`,
        ));
        return;
      }
      // Non-2xx JSON: surface the function's error message when present.
      let message = `Upload failed (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body && typeof body.error === 'string' && body.error) message = body.error;
      } catch {
        // Keep the status-based fallback.
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

/**
 * Downloads an attachment's bytes as a Blob via the /api/files function.
 */
export async function fetchAttachmentBlob(
  parentType: ParentType,
  parentId: string,
  fileId: string,
): Promise<Blob> {
  const token = await requireIdToken('download');
  const url = endpoint({ parentType, parentId, fileId });
  const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    // SPA fallback (dev/preview) served index.html instead of the file bytes.
    throw new Error('File downloads are only available on the deployed site.');
  }
  if (!response.ok) {
    throw new Error(await errorMessageFromResponse(response, `Download failed (${response.status}).`));
  }
  return response.blob();
}

/**
 * Deletes an attachment (Storage object + metadata doc) via the /api/files
 * function. The delete is idempotent server-side.
 */
export async function deleteAttachment(
  parentType: ParentType,
  parentId: string,
  fileId: string,
): Promise<void> {
  const token = await requireIdToken('delete');
  const url = endpoint({ parentType, parentId, fileId });
  const response = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error('File management is only available on the deployed site.');
  }
  if (!response.ok) {
    throw new Error(await errorMessageFromResponse(response, `Delete failed (${response.status}).`));
  }
}
