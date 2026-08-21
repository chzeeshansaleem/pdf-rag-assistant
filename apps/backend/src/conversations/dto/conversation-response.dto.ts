export class ConversationSummaryDto {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MessageSourceDto {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  snippetText: string;
}

export class ConversationMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scopeDocumentIds: string[];
  scopeCategory: string | null;
  createdAt: string;
  sources: MessageSourceDto[];
}

export class ConversationDetailDto extends ConversationSummaryDto {
  messages: ConversationMessageDto[];
}
