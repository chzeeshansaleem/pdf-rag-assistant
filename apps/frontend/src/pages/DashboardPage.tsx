import { UploadPanel } from '../components/UploadPanel';
import { StatsBar } from '../components/dashboard/StatsBar';
import { DocumentTable } from '../components/dashboard/DocumentTable';
import { useDocuments } from '../hooks/useDocuments';

export function DashboardPage() {
  const { data: documents = [], isLoading, isError } = useDocuments();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Documents</h2>
          <p className="mt-0.5 text-sm text-slate-500">Manage your knowledge base — upload, tag, and monitor processing status.</p>
        </div>

        <StatsBar documents={documents} />

        <UploadPanel />

        {isLoading ? (
          <p className="text-sm text-slate-500">Loading documents…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Could not load documents. Is the backend running?</p>
        ) : (
          <DocumentTable documents={documents} />
        )}
      </div>
    </div>
  );
}
