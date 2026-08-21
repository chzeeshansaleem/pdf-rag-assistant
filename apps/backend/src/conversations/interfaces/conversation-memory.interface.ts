/**
 * A single verbatim turn kept in the "recent window" sent to the LLM.
 */
export interface MemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * What a conversation contributes to a new question's context: a rolling
 * summary of everything older than the recent window, plus the recent
 * window itself, verbatim. This is intentionally bounded — see
 * ConversationsService.getContextForPrompt / maybeSummarize — so a long
 * conversation never grows the LLM context unboundedly.
 */
export interface ConversationMemory {
  summary: string | null;
  recentMessages: MemoryMessage[];
}
