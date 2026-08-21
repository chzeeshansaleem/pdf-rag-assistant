import { FileStack, Layers, HardDrive } from 'lucide-react';
import { formatFileSize } from '../../hooks/formatFileSize';
import type { DocumentResponse } from '../../types/api';

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none text-slate-900">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function StatsBar({ documents }: { documents: DocumentResponse[] }) {
  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const totalBytes = documents.reduce((sum, d) => sum + d.fileSize, 0);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard
        icon={<FileStack className="h-4 w-4 text-indigo-600" strokeWidth={2} />}
        label={`document${documents.length === 1 ? '' : 's'}`}
        value={String(documents.length)}
        accent="bg-indigo-50"
      />
      <StatCard
        icon={<Layers className="h-4 w-4 text-violet-600" strokeWidth={2} />}
        label={`chunk${totalChunks === 1 ? '' : 's'} indexed`}
        value={String(totalChunks)}
        accent="bg-violet-50"
      />
      <StatCard
        icon={<HardDrive className="h-4 w-4 text-emerald-600" strokeWidth={2} />}
        label="storage used"
        value={formatFileSize(totalBytes)}
        accent="bg-emerald-50"
      />
    </div>
  );
}
