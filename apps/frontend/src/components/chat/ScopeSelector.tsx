import { Filter } from 'lucide-react';
import { CATEGORIES } from '../../constants/categories';
import type { AskQuestionScope, DocumentResponse } from '../../types/api';

interface ScopeSelectorProps {
  documents: DocumentResponse[];
  scope: AskQuestionScope;
  onChange: (scope: AskQuestionScope) => void;
}

function scopeToValue(scope: AskQuestionScope): string {
  if (scope.documentIds?.length === 1) return `doc:${scope.documentIds[0]}`;
  if (scope.category) return `category:${scope.category}`;
  return 'all';
}

function valueToScope(value: string): AskQuestionScope {
  if (value === 'all') return {};
  if (value.startsWith('category:')) return { category: value.slice('category:'.length) };
  if (value.startsWith('doc:')) return { documentIds: [value.slice('doc:'.length)] };
  return {};
}

export function ScopeSelector({ documents, scope, onChange }: ScopeSelectorProps) {
  const processedDocs = documents.filter((d) => d.status === 'processed');
  const categoriesInUse = CATEGORIES.filter((c) => processedDocs.some((d) => d.category === c));

  return (
    <div className="relative flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 pl-2.5 pr-1.5 py-1.5 text-xs font-medium text-slate-600">
      <Filter className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
      <select
        value={scopeToValue(scope)}
        onChange={(e) => onChange(valueToScope(e.target.value))}
        className="appearance-none bg-transparent pr-4 text-xs font-medium text-slate-700 focus:outline-none"
      >
        <option value="all">All documents</option>
        {categoriesInUse.length > 0 && (
          <optgroup label="By category">
            {categoriesInUse.map((c) => (
              <option key={c} value={`category:${c}`}>
                {c}
              </option>
            ))}
          </optgroup>
        )}
        {processedDocs.length > 0 && (
          <optgroup label="Specific file">
            {processedDocs.map((d) => (
              <option key={d.documentId} value={`doc:${d.documentId}`}>
                {d.filename}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
