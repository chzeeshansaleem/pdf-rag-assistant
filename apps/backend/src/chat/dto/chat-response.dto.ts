export class SourceDto {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  snippetText: string;
}

export class ChatResponseDto {
  conversationId: string;
  answer: string;
  sources: SourceDto[];
}
