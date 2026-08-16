export class UploadDocumentResponseDto {
  documentId: string;
  filename: string;
  status: 'processed' | 'failed';
  pageCount: number;
  chunkCount: number;
}
