export type DocumentStatus = 'queued' | 'processing' | 'processed' | 'failed';

export interface UploadDocumentResponse {
  documentId: string;
  filename: string;
  status: DocumentStatus;
  category?: string;
  pageCount: number;
  chunkCount: number;
}

export interface DocumentResponse {
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

export interface ListDocumentsFilter {
  status?: DocumentStatus;
  category?: string;
  ids?: string[];
}

export interface ChatSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  snippetText?: string;
}

export interface ChatResponse {
  conversationId: string;
  answer: string;
  sources: ChatSource[];
}

export interface AskQuestionScope {
  documentIds?: string[];
  category?: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  scopeDocumentIds: string[];
  scopeCategory: string | null;
  createdAt: string;
  sources: ChatSource[];
}

export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  timestamp: string;
}
