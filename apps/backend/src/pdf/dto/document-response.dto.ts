import type { DocumentStatus } from '../interfaces/document-metadata.interface';

export class DocumentResponseDto {
  documentId: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  category?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}
