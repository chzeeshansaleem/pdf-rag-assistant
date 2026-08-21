import { useQuery } from '@tanstack/react-query';
import { listDocuments } from '../api/client';
import type { DocumentResponse, ListDocumentsFilter } from '../types/api';

const IN_FLIGHT_STATUSES = new Set(['queued', 'processing']);

export function useDocuments(filter?: ListDocumentsFilter) {
  return useQuery<DocumentResponse[]>({
    queryKey: ['documents', filter ?? {}],
    queryFn: () => listDocuments(filter),
    refetchInterval: (query) => {
      const docs = query.state.data;
      return docs?.some((d) => IN_FLIGHT_STATUSES.has(d.status)) ? 2000 : false;
    },
  });
}
