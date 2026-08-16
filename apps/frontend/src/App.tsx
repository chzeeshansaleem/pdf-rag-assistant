import { useState } from 'react';
import { UploadPanel } from './components/UploadPanel';
import { DocumentCard } from './components/DocumentCard';
import { ChatPanel } from './components/ChatPanel';
import { deleteDocument } from './api/client';
import type { UploadDocumentResponse } from './types/api';

function App() {
  const [document, setDocument] = useState<UploadDocumentResponse | null>(null);

  const handleRemove = async () => {
    if (!document) return;
    const id = document.documentId;
    setDocument(null);
    try {
      await deleteDocument(id);
    } catch {
      // Best-effort cleanup; the UI has already moved on regardless.
    }
  };

  return (
    <div className="min-h-full bg-slate-50 flex flex-col">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-800">PDF RAG Assistant</h1>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 flex flex-col gap-6">
        {!document ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <p className="text-slate-500 mb-4">Upload your PDF to get started</p>
            <UploadPanel onUploaded={setDocument} />
          </div>
        ) : (
          <>
            <DocumentCard document={document} onRemove={handleRemove} />
            <div className="flex-1 rounded-xl border border-slate-200 bg-white overflow-hidden" style={{ minHeight: 420 }}>
              <ChatPanel documentId={document.documentId} documentReady={document.status === 'processed'} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
