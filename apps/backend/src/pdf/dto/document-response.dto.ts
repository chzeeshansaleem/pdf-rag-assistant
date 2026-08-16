import type { DocumentStatus } from '../documents.repository';

export class DocumentResponseDto {
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
