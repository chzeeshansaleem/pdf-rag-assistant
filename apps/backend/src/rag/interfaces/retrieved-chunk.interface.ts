export interface RetrievedChunk {
  documentId: string;
  text: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  score: number;
}
