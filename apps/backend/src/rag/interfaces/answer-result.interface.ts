export interface AnswerSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
}

export interface AnswerResult {
  answer: string;
  sources: AnswerSource[];
}
