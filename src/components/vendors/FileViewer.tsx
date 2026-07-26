import React, { useEffect, useState } from 'react';
import { X, Download, FileWarning, Loader2 } from 'lucide-react';
import { AttachmentMeta } from '../../types';
import { fetchAttachmentBlob } from '../../lib/familyFiles';

interface FileViewerProps {
  parentType: 'vendors' | 'purchases';
  parentId: string;
  file: AttachmentMeta;
  onClose: () => void;
}

// Views an uploaded document. Because <img>/<iframe> can't send the
// Authorization header the function requires, every view fetches the bytes
// with the ID token first, then renders from a blob: URL that is revoked when
// the modal closes.
export default function FileViewer({ parentType, parentId, file, onClose }: FileViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isImage = file.contentType.startsWith('image/');
  const isPdf = file.contentType === 'application/pdf';
  // Browsers other than Safari can't render HEIC inline; offer download only.
  const canPreview = (isImage && file.contentType !== 'image/heic') || isPdf;

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    fetchAttachmentBlob(parentType, parentId, file.id!)
      .then(blob => {
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch(err => {
        if (revoked) return;
        console.error('Failed to load attachment:', err);
        setError(err?.message ?? 'This document could not be loaded.');
      });
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [parentType, parentId, file.id]);

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90dvh]"
      >
        <div className="p-4 pb-3 flex items-center justify-between border-b border-slate-800 gap-3">
          <p className="font-bold text-white text-sm truncate min-w-0">{file.fileName}</p>
          <div className="flex items-center gap-1 shrink-0">
            {blobUrl && (
              <a
                href={blobUrl}
                download={file.fileName}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                aria-label={`Download ${file.fileName}`}
              >
                <Download className="w-4 h-4" />
              </a>
            )}
            <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close document viewer">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center">
          {error ? (
            <div className="text-center text-amber-300 text-sm flex flex-col items-center gap-2 py-10">
              <FileWarning className="w-8 h-8" />
              {error}
            </div>
          ) : !blobUrl ? (
            <div className="text-slate-500 flex flex-col items-center gap-2 py-10">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">Loading…</span>
            </div>
          ) : !canPreview ? (
            <div className="text-center text-slate-400 text-sm flex flex-col items-center gap-3 py-10">
              <FileWarning className="w-8 h-8 text-slate-500" />
              <p>This file type can't be previewed here.</p>
              <a href={blobUrl} download={file.fileName} className="bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-1.5">
                <Download className="w-4 h-4" /> Download to view
              </a>
            </div>
          ) : isImage ? (
            <img src={blobUrl} alt={file.fileName} className="max-w-full max-h-[70dvh] object-contain rounded-lg" />
          ) : (
            // iOS renders only page 1 of a PDF in an iframe, so the Download
            // button in the header is always available as the full-fidelity path.
            <iframe src={blobUrl} title={file.fileName} className="w-full h-[70dvh] rounded-lg bg-white" />
          )}
        </div>
      </div>
    </div>
  );
}
