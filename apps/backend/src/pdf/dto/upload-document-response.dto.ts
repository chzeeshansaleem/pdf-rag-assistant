import type { DocumentStatus } from '../interfaces/document-metadata.interface';

export class UploadDocumentResponseDto {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  category?: string;
  pageCount: number;
  chunkCount: number;
}
