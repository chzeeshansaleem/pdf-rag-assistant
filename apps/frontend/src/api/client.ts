import axios, { AxiosError } from 'axios';
import type { ApiErrorBody, ChatResponse, DocumentResponse, UploadDocumentResponse } from '../types/api';

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

export async function uploadDocument(file: File, onProgress?: (percent: number) => void): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const { data } = await apiClient.post<UploadDocumentResponse>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
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

export async function askQuestion(documentId: string, question: string): Promise<ChatResponse> {
  const { data } = await apiClient.post<ChatResponse>('/chat', { documentId, question });
  return data;
}
