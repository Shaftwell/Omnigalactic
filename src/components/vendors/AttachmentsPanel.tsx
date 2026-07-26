import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Trash2, FileText, Image as ImageIcon, Loader2, Eye } from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { userRoot, db } from '../../firebase';
import { AttachmentMeta } from '../../types';
import { clearSnapshotMetadata, reportSnapshotMetadata, useSyncStatus } from '../../lib/syncStatus';
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, deleteAttachment, uploadAttachment } from '../../lib/familyFiles';
import FileViewer from './FileViewer';

interface AttachmentsPanelProps {
  parentType: 'vendors' | 'purchases';
  parentId: string;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,.pdf,.jpg,.jpeg,.png,.webp,.heic';

// Warranties, invoices, and receipts attached to a vendor or purchase. The
// metadata list renders offline like everything else; the upload/view/delete
// network actions need a connection (they go through the files function).
export default function AttachmentsPanel({ parentType, parentId }: AttachmentsPanelProps) {
  const [files, setFiles] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AttachmentMeta | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { online } = useSyncStatus();

  useEffect(() => {
    const source = `${parentType}-files-${parentId}`;
    const q = query(collection(userRoot(), parentType, parentId, 'files'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setFiles(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AttachmentMeta)));
    }, err => {
      clearSnapshotMetadata(source);
      console.error('Failed to load attachments:', err);
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [parentType, parentId]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after an error
    if (!file) return;
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      await uploadAttachment(parentType, parentId, file, setProgress);
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err?.message ?? 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const handleDelete = async (file: AttachmentMeta) => {
    if (!file.id) return;
    setError(null);
    setDeletingId(file.id);
    try {
      await deleteAttachment(parentType, parentId, file.id);
    } catch (err: any) {
      console.error('Delete failed:', err);
      setError(err?.message ?? 'Could not delete this document.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
          <Paperclip className="w-3 h-3" /> Documents
        </h4>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || !online}
          title={!online ? 'File uploads need a connection' : undefined}
          className="text-xs font-bold text-orange-400 hover:text-orange-300 disabled:text-slate-600 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? `${progress}%` : 'Upload'}
        </button>
        <input ref={inputRef} type="file" accept={ACCEPT} onChange={handleFile} className="hidden" />
      </div>

      {!online && (
        <p className="text-[10px] text-slate-500">Reconnect to upload, view, or delete documents.</p>
      )}
      {error && <p className="text-[11px] text-amber-400 font-medium">{error}</p>}

      {files.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic">No documents yet. Upload warranties, invoices, or receipts (PDF or photo, up to {formatBytes(MAX_ATTACHMENT_BYTES)}).</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map(file => {
            const isImage = file.contentType.startsWith('image/');
            return (
              <li key={file.id} className="flex items-center gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
                {isImage ? <ImageIcon className="w-4 h-4 text-slate-500 shrink-0" /> : <FileText className="w-4 h-4 text-slate-500 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-200 truncate">{file.fileName}</p>
                  <p className="text-[10px] text-slate-500">{formatBytes(file.size)} · {file.authorName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewing(file)}
                  disabled={!online}
                  title={!online ? 'Viewing needs a connection' : undefined}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:text-slate-700 disabled:cursor-not-allowed"
                  aria-label={`View ${file.fileName}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(file)}
                  disabled={!online || deletingId === file.id}
                  title={!online ? 'Deleting needs a connection' : undefined}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20 disabled:text-slate-700 disabled:cursor-not-allowed"
                  aria-label={`Delete ${file.fileName}`}
                >
                  {deletingId === file.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {viewing && (
        <FileViewer parentType={parentType} parentId={parentId} file={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
