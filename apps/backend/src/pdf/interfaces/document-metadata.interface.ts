export type DocumentStatus = 'processing' | 'processed' | 'failed';

export interface DocumentMetadata {
  id: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
