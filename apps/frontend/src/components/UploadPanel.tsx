import { useCallback, useEffect, useRef, useState } from 'react';
import { useUploadDocument } from '../hooks/useUploadDocument';
import { extractErrorMessage } from '../api/client';
import type { UploadDocumentResponse } from '../types/api';

const PROCESSING_STAGES = ['Extracting text...', 'Cleaning and chunking text...', 'Creating embeddings...', 'Indexing document...'];

interface UploadPanelProps {
  onUploaded: (doc: UploadDocumentResponse) => void;
}

export function UploadPanel({ onUploaded }: UploadPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate, isPending, isError, error, reset } = useUploadDocument(setUploadProgress);

  // Upload itself finishes fast; the bulk of the wait is server-side
  // processing (parse -> chunk -> embed -> store). Since the backend
  // processes synchronously within the request, we simulate the staged
  // "Processing PDF..." messaging from section 13 client-side while we wait
  // for the response, to keep the user oriented on what's happening.
  useEffect(() => {
    if (!isPending || uploadProgress < 100) return;
    setStageIndex(0);
    const interval = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, PROCESSING_STAGES.length - 1));
    }, 900);
    return () => clearInterval(interval);
  }, [isPending, uploadProgress]);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      reset();
      setUploadProgress(0);
      mutate(file, { onSuccess: onUploaded });
    },
    [mutate, onUploaded, reset],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
    [handleFile],
  );

  return (
    <div className="w-full max-w-xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400'
        }`}
      >
        <div className="text-4xl">📄</div>
        <p className="text-slate-700 font-medium">Drag & drop a PDF here</p>
        <p className="text-slate-400 text-sm">or</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Choose PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {isPending && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          {uploadProgress < 100 ? (
            <>
              <div className="flex justify-between text-sm text-slate-600 mb-1">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
              <span>Processing PDF... {PROCESSING_STAGES[stageIndex]}</span>
            </div>
          )}
        </div>
      )}

      {isError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {extractErrorMessage(error)}
        </div>
      )}
    </div>
  );
}
