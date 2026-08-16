export type DocumentStatus = 'processing' | 'processed' | 'failed';

export interface UploadDocumentResponse {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  pageCount: number;
  chunkCount: number;
}

export interface DocumentResponse {
  documentId: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  timestamp: string;
}
