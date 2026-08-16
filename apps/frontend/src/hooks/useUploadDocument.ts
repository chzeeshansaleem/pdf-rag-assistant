import { useMutation } from '@tanstack/react-query';
import { uploadDocument } from '../api/client';
import type { UploadDocumentResponse } from '../types/api';

export function useUploadDocument(onProgress?: (percent: number) => void) {
  return useMutation<UploadDocumentResponse, unknown, File>({
    mutationFn: (file: File) => uploadDocument(file, onProgress),
  });
}
