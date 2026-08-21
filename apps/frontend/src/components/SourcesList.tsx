import { useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import type { ChatSource } from '../types/api';

interface SourcesListProps {
  sources: ChatSource[];
}

function sourceKey(source: ChatSource): string {
  return `${source.documentId}-${source.pageNumber}-${source.chunkIndex}`;
}

export function SourcesList({ sources }: SourcesListProps) {
  const [expanded, setExpanded] = useState(false);
  const [openSnippet, setOpenSnippet] = useState<string | null>(null);

  if (sources.length === 0) return null;

  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} strokeWidth={2.5} />
        {sources.length} {sources.length === 1 ? 'source' : 'sources'}
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source) => {
              const key = sourceKey(source);
              const isOpen = openSnippet === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpenSnippet((prev) => (prev === key ? null : key))}
                  title="Show text"
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors ${
                    isOpen ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <FileText className="h-3 w-3" strokeWidth={2} />
                  <span className="max-w-[160px] truncate">{source.filename}</span>
                  <span className="text-slate-400">· p.{source.pageNumber}</span>
                </button>
              );
            })}
          </div>
          {sources.map((source) => {
            const key = sourceKey(source);
            if (openSnippet !== key || !source.snippetText) return null;
            return (
              <blockquote
                key={`${key}-snippet`}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500 whitespace-pre-wrap"
              >
                {source.snippetText}
              </blockquote>
            );
          })}
        </div>
      )}
    </div>
  );
}
