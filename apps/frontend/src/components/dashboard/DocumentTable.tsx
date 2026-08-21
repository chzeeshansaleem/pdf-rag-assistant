import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCcw, RefreshCw, Trash2, Loader2, Clock } from 'lucide-react';
import { deleteDocument, retryDocument, reprocessDocument, extractErrorMessage } from '../../api/client';
import { formatFileSize } from '../../hooks/formatFileSize';
import { categoryColor } from '../../constants/categoryColors';
import type { DocumentResponse } from '../../types/api';

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; dot: string; text: string; bg: string; spin?: boolean }> = {
    processed: { label: 'Ready', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    processing: { label: 'Processing', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', spin: true },
    queued: { label: 'Queued', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100' },
    failed: { label: 'Failed', dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50' },
  };
  const c = config[status] ?? config.queued;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.spin ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.5} />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      )}
      {c.label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function IconButton({
  onClick,
  title,
  children,
  tone = 'default',
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        tone === 'danger'
          ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
          : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
      }`}
    >
      {children}
    </button>
  );
}

export function DocumentTable({ documents }: { documents: DocumentResponse[] }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['documents'] });

  const deleteMutation = useMutation({ mutationFn: deleteDocument, onSuccess: invalidate });
  const retryMutation = useMutation({ mutationFn: retryDocument, onSuccess: invalidate });
  const reprocessMutation = useMutation({ mutationFn: reprocessDocument, onSuccess: invalidate });

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
          <FileText className="h-5 w-5 text-slate-300" strokeWidth={1.75} />
        </div>
        <p className="text-sm font-medium text-slate-600">No documents yet</p>
        <p className="text-xs text-slate-400">Upload a PDF above to build your knowledge base.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Filename</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Category</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Chunks</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide">Uploaded</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const c = categoryColor(doc.category);
              return (
                <tr key={doc.documentId} className="border-b border-slate-50 last:border-0 transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 border border-slate-100">
                        <FileText className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{doc.filename}</p>
                        <p className="text-xs text-slate-400">{formatFileSize(doc.fileSize)}</p>
                        {doc.status === 'failed' && doc.errorMessage && (
                          <p className="text-xs text-red-500 truncate max-w-xs" title={doc.errorMessage}>
                            {doc.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {doc.category ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${c.bg} ${c.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                        {doc.category}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-500 tabular-nums">{doc.status === 'processed' ? doc.chunkCount : '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-slate-300" strokeWidth={2} />
                      {formatDate(doc.createdAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {doc.status === 'failed' && (
                        <IconButton onClick={() => retryMutation.mutate(doc.documentId)} title="Retry">
                          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                        </IconButton>
                      )}
                      {doc.status === 'processed' && (
                        <IconButton onClick={() => reprocessMutation.mutate(doc.documentId)} title="Re-process">
                          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                        </IconButton>
                      )}
                      <IconButton
                        tone="danger"
                        title="Delete document"
                        onClick={() => {
                          if (confirm(`Delete "${doc.filename}"? This removes it and its indexed content permanently.`)) {
                            deleteMutation.mutate(doc.documentId);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(deleteMutation.isError || retryMutation.isError || reprocessMutation.isError) && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {extractErrorMessage(deleteMutation.error ?? retryMutation.error ?? reprocessMutation.error)}
        </div>
      )}
    </div>
  );
}
