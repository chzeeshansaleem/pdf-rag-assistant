import { useMutation, useQueryClient } from '@tanstack/react-query';
import { askQuestion } from '../api/client';
import type { AskQuestionScope, ChatResponse } from '../types/api';

interface AskArgs {
  conversationId: string;
  question: string;
  scope?: AskQuestionScope;
}

export function useChat() {
  const queryClient = useQueryClient();
  return useMutation<ChatResponse, unknown, AskArgs>({
    mutationFn: ({ conversationId, question, scope }) => askQuestion(conversationId, question, scope),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversation', variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}
