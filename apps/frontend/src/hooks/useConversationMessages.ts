import { useQuery } from '@tanstack/react-query';
import { getConversation } from '../api/client';
import type { ConversationDetail } from '../types/api';

export function useConversationMessages(conversationId: string | undefined) {
  return useQuery<ConversationDetail>({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId!),
    enabled: !!conversationId,
  });
}
