import { useMutation } from '@tanstack/react-query';
import { askQuestion } from '../api/client';
import type { ChatResponse } from '../types/api';

export function useChat() {
  return useMutation<ChatResponse, unknown, { documentId: string; question: string }>({
    mutationFn: ({ documentId, question }) => askQuestion(documentId, question),
  });
}
