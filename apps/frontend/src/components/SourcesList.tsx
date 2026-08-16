import type { ChatSource } from '../types/api';

interface SourcesListProps {
  sources: ChatSource[];
  /** Optional hook for a future "open PDF at this page" viewer. */
  onSourceClick?: (source: ChatSource) => void;
}

export function SourcesList({ sources, onSourceClick }: SourcesListProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {sources.map((source) => (
        <button
          key={`${source.documentId}-${source.pageNumber}-${source.chunkIndex}`}
          type="button"
          onClick={() => onSourceClick?.(source)}
          title={`Chunk ${source.chunkIndex}`}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
        >
          📄 {source.filename} — Page {source.pageNumber}
        </button>
      ))}
    </div>
  );
}
