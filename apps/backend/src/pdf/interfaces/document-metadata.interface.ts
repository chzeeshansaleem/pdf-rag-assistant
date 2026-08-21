export type DocumentStatus = 'queued' | 'processing' | 'processed' | 'failed';

export interface DocumentMetadata {
  id: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  category?: string;
  storagePath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentListFilter {
  status?: DocumentStatus;
  category?: string;
  ids?: string[];
}
