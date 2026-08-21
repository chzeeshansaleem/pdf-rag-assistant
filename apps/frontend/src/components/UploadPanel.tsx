import { useCallback, useRef, useState } from 'react';
import { UploadCloud, AlertCircle } from 'lucide-react';
import { useUploadDocuments } from '../hooks/useUploadDocuments';
import { extractErrorMessage } from '../api/client';
import { CATEGORIES } from '../constants/categories';

interface UploadPanelProps {
  onUploaded?: () => void;
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [category, setCategory] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate, isPending, isError, error, reset } = useUploadDocuments(setUploadProgress);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
      if (files.length === 0) return;
      reset();
      setUploadProgress(0);
      mutate({ files, category: category || undefined }, { onSuccess: onUploaded });
    },
    [mutate, onUploaded, reset, category],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">Upload documents</p>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Category
          <select
            id="upload-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-all ${
          isDragging ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:bg-indigo-50/30'
        }`}
      >
        <div className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${isDragging ? 'bg-indigo-100' : 'bg-white border border-slate-200'}`}>
          <UploadCloud className={`h-5 w-5 ${isDragging ? 'text-indigo-600' : 'text-slate-400'}`} strokeWidth={1.75} />
        </div>
        <p className="text-sm font-medium text-slate-700">
          <span className="text-indigo-600">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-slate-400">PDF only, up to 25MB each · multi-select supported</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {isPending && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Uploading…</span>
            <span className="tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-1.5 rounded-full bg-indigo-600 transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {isError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
          <span>{extractErrorMessage(error)}</span>
        </div>
      )}
    </div>
  );
}
