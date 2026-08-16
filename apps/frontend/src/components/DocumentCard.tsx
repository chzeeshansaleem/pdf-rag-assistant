import { formatFileSize } from '../hooks/formatFileSize';
import type { UploadDocumentResponse } from '../types/api';

interface DocumentCardProps {
  document: UploadDocumentResponse & { fileSize?: number };
  onRemove: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  processed: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

export function DocumentCard({ document, onRemove }: DocumentCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-2xl shrink-0">📄</span>
        <div className="min-w-0">
          <p className="font-medium text-slate-800 truncate">{document.filename}</p>
          <p className="text-xs text-slate-500">
            {document.fileSize !== undefined ? `${formatFileSize(document.fileSize)} · ` : ''}
            {document.pageCount} page{document.pageCount === 1 ? '' : 's'} · {document.chunkCount} chunk
            {document.chunkCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[document.status] ?? ''}`}>
          {document.status === 'processed' ? 'Ready' : document.status}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-400 hover:text-red-600 text-sm"
          title="Remove document"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
