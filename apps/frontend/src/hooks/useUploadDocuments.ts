import { useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadDocuments } from '../api/client';
import type { UploadDocumentResponse } from '../types/api';

export function useUploadDocuments(onProgress?: (percent: number) => void) {
  const queryClient = useQueryClient();
  return useMutation<UploadDocumentResponse[], unknown, { files: File[]; category?: string }>({
    mutationFn: ({ files, category }) => uploadDocuments(files, category, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}
