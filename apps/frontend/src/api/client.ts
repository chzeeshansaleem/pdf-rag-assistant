import axios, { AxiosError } from 'axios';
import type {
  ApiErrorBody,
  AskQuestionScope,
  ChatResponse,
  ConversationDetail,
  ConversationSummary,
  DocumentResponse,
  ListDocumentsFilter,
  UploadDocumentResponse,
} from '../types/api';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

export const apiClient = axios.create({ baseURL: API_URL });

/** Extracts a clean, user-facing message from any Axios error the backend returns. */
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorBody>;
    const body = axiosError.response?.data;
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join(', ') : body.message;
    }
    if (axiosError.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!axiosError.response) return 'Could not reach the server. Is the backend running?';
  }
  return 'Something went wrong. Please try again.';
}

export async function uploadDocuments(
  files: File[],
  category?: string,
  onProgress?: (percent: number) => void,
): Promise<UploadDocumentResponse[]> {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  if (category) formData.append('category', category);

  const { data } = await apiClient.post<UploadDocumentResponse[]>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    },
  });
  return data;
}

export async function listDocuments(filter?: ListDocumentsFilter): Promise<DocumentResponse[]> {
  const { data } = await apiClient.get<DocumentResponse[]>('/documents', {
    params: {
      status: filter?.status,
      category: filter?.category,
      ids: filter?.ids?.join(','),
    },
  });
  return data;
}

export async function getDocument(documentId: string): Promise<DocumentResponse> {
  const { data } = await apiClient.get<DocumentResponse>(`/documents/${documentId}`);
  return data;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/documents/${documentId}`);
}

export async function retryDocument(documentId: string): Promise<DocumentResponse> {
  const { data } = await apiClient.post<DocumentResponse>(`/documents/${documentId}/retry`);
  return data;
}

export async function reprocessDocument(documentId: string): Promise<DocumentResponse> {
  const { data } = await apiClient.post<DocumentResponse>(`/documents/${documentId}/reprocess`);
  return data;
}

export async function createConversation(): Promise<ConversationSummary> {
  const { data } = await apiClient.post<ConversationSummary>('/conversations');
  return data;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const { data } = await apiClient.get<ConversationSummary[]>('/conversations');
  return data;
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  const { data } = await apiClient.get<ConversationDetail>(`/conversations/${conversationId}`);
  return data;
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiClient.delete(`/conversations/${conversationId}`);
}

export async function askQuestion(conversationId: string, question: string, scope?: AskQuestionScope): Promise<ChatResponse> {
  const { data } = await apiClient.post<ChatResponse>('/chat', {
    conversationId,
    question,
    documentIds: scope?.documentIds,
    category: scope?.category,
  });
  return data;
}
