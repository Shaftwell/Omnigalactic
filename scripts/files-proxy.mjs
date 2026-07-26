// Locked-down file proxy for the Vendors tab. Every upload/download flows
// through this Cloud Function: it verifies the caller, owns the per-user
// users/{uid}/(vendors|purchases)/{id}/files/{fileId} metadata docs via the
// Admin SDK, and reads/writes the storage object under userFiles/{uid}/....
// Clients never touch Storage or write the files subcollection directly. This module is pure — every dependency is
// injected — so it runs identically under `node --test` and in production
// (functions/index.js wires the real Firestore/Storage). Mirrors the shape of
// scripts/quotes-proxy.mjs.

import { createRateLimiter } from './quotes-proxy.mjs';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
];

// parentId + fileId live in a Storage object path, so this pattern is the whole
// path-traversal defense: no dots, slashes, or separators can slip through.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PARENT_TYPES = new Set(['vendors', 'purchases']);

// Per-verb per-uid ceilings. Uploads are the most expensive, so they get the
// tightest cap; downloads are cheap and frequent (thumbnails, previews).
const RATE_LIMITS = { POST: 20, GET: 120, DELETE: 30 };

// RFC 5987 ext-value encoding for a Content-Disposition filename*. encodeURIComponent
// already escapes control chars, quotes, and separators; the extra pass covers the
// characters it leaves raw but RFC 5987 forbids in an attr-char run: ' ( ) *.
const rfc5987 = value => encodeURIComponent(value)
  .replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// A user-supplied file name only ever reaches a header or a metadata doc, but
// keep it sane regardless: drop control chars (CR/LF header-injection) and path
// separators, collapse whitespace, bound the length, never leave it empty.
function sanitizeFileName(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw ?? '');
  } catch {
    decoded = String(raw ?? ''); // malformed %-encoding: fall back to the literal
  }
  let cleaned = '';
  for (const ch of decoded) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue; // C0 controls + DEL
    if (ch === '/' || ch === '\\') continue; // path separators
    cleaned += ch;
  }
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 300) || 'document';
}

export function createFilesRequestHandler({ store, bucket, generateFileId, now = Date.now }) {
  // One limiter per verb, keyed on the authenticated uid the caller sets. now
  // is shared so a test clock advances the windows and the createdAt stamp alike.
  const limiters = {
    POST: createRateLimiter({ limit: RATE_LIMITS.POST, windowMs: 60_000, now }),
    GET: createRateLimiter({ limit: RATE_LIMITS.GET, windowMs: 60_000, now }),
    DELETE: createRateLimiter({ limit: RATE_LIMITS.DELETE, windowMs: 60_000, now }),
  };

  return async function handleFilesRequest(req, res) {
    const respond = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };

    try {
      const method = req.method;
      const limiter = limiters[method];
      if (!limiter) {
        respond(405, { error: 'Method not allowed.' });
        return;
      }
      const verdict = limiter(req.omniUid);
      if (!verdict.allowed) {
        res.setHeader('Retry-After', String(verdict.retryAfterSec));
        respond(429, { error: 'Too many file requests; retry shortly.' });
        return;
      }

      const url = new URL(req.url ?? '/', 'http://localhost');
      const query = url.searchParams;
      const parentType = query.get('parentType');
      const parentId = query.get('parentId');
      if (!PARENT_TYPES.has(parentType) || !ID_PATTERN.test(parentId ?? '')) {
        respond(400, { error: 'Invalid parentType or parentId.' });
        return;
      }

      // Authorization is structural: the verified uid from the token scopes
      // every path below, so a caller can only ever reach their own files.
      const uid = req.omniUid;
      if (method === 'POST') {
        await handleUpload(req, respond, query, uid, parentType, parentId);
      } else if (method === 'GET') {
        await handleDownload(res, respond, query, uid, parentType, parentId);
      } else {
        await handleDelete(respond, query, uid, parentType, parentId);
      }
    } catch (error) {
      respond(500, { error: error?.message ?? 'File request failed.' });
    }
  };

  async function handleUpload(req, respond, query, uid, parentType, parentId) {
    const contentType = String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      respond(415, { error: 'Unsupported file type.' });
      return;
    }
    const body = req.rawBody;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      respond(400, { error: 'Empty file upload.' });
      return;
    }
    if (body.length > MAX_FILE_BYTES) {
      respond(413, { error: 'File exceeds the 10 MB limit.' });
      return;
    }
    // Never let an upload conjure a parent record: the vendor/purchase must exist.
    if (!(await store.parentExists(uid, parentType, parentId))) {
      respond(404, { error: 'Parent record not found.' });
      return;
    }

    const fileId = generateFileId();
    const storagePath = `userFiles/${uid}/${parentType}/${parentId}/${fileId}`;
    const fileName = sanitizeFileName(query.get('fileName'));
    await bucket.save(storagePath, body, contentType, { uploadedBy: req.omniUid, fileName });
    await store.createFileMeta(uid, parentType, parentId, fileId, {
      fileName,
      storagePath,
      contentType,
      size: body.length,
      createdBy: req.omniUid,
      authorName: req.omniName || 'Explorer',
      createdAt: new Date(now()).toISOString(),
    });
    respond(200, { fileId, storagePath, contentType, size: body.length, fileName });
  }

  async function handleDownload(res, respond, query, uid, parentType, parentId) {
    const fileId = query.get('fileId');
    if (!ID_PATTERN.test(fileId ?? '')) {
      respond(400, { error: 'Invalid fileId.' });
      return;
    }
    // The metadata doc is authoritative: a deleted attachment is not
    // downloadable even if the Storage object briefly outlived it.
    const meta = await store.getFileMeta(uid, parentType, parentId, fileId);
    if (!meta) {
      respond(404, { error: 'File not found.' });
      return;
    }
    const storagePath = `userFiles/${uid}/${parentType}/${parentId}/${fileId}`;
    const obj = await bucket.download(storagePath);
    if (!obj) {
      respond(404, { error: 'File not found.' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${rfc5987(meta.fileName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(obj.buffer);
  }

  async function handleDelete(respond, query, uid, parentType, parentId) {
    const fileId = query.get('fileId');
    if (!ID_PATTERN.test(fileId ?? '')) {
      respond(400, { error: 'Invalid fileId.' });
      return;
    }
    const storagePath = `userFiles/${uid}/${parentType}/${parentId}/${fileId}`;
    // Object removal is idempotent; the function owns the metadata doc, so the
    // authoritative delete is store.deleteFileMeta.
    await bucket.remove(storagePath);
    await store.deleteFileMeta(uid, parentType, parentId, fileId);
    respond(200, { ok: true });
  }
}
