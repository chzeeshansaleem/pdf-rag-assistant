export interface AnswerSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  snippetText: string;
}

export interface AnswerResult {
  answer: string;
  sources: AnswerSource[];
}
