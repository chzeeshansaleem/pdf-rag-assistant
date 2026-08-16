export class SourceDto {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
}

export class ChatResponseDto {
  answer: string;
  sources: SourceDto[];
}
