import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OPENAI_CLIENT } from '../common/openai-client.provider';
import type { ConversationMemory } from '../conversations/interfaces/conversation-memory.interface';

const SYSTEM_PROMPT = `You are a query rewriting component in a document search system. Your ONLY job is to transform the user's latest message into a standalone search query, using the conversation history to resolve references. You do NOT answer the question.

Rules:
1. Resolve pronouns and references (it, this, that, they, them, the above, the previous one, the second one, that policy, this document) using the conversation history.
2. Resolve implicit follow-ups ("what about employees?", "and managers?", "explain more", "why?", "how?") into a complete standalone question using the topic from the conversation history.
3. If the conversation history previously established a specific document or filename relevant to the question, keep it in the rewritten query.
4. If the latest message is already a complete, standalone question — especially if it introduces a new topic, names a different document, or otherwise doesn't depend on prior context — return it UNCHANGED. Do not force a connection to previous turns that isn't there.
5. Never answer the question. Never add facts not implied by the conversation. Never explain your reasoning.
6. Output ONLY the rewritten (or unchanged) query text — no quotes, no prefix, no commentary.`;

function formatHistory(memory: ConversationMemory): string {
  const parts: string[] = [];
  if (memory.summary) {
    parts.push(`Summary of earlier conversation:\n${memory.summary}`);
  }
  if (memory.recentMessages.length > 0) {
    const transcript = memory.recentMessages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    parts.push(`Recent conversation:\n${transcript}`);
  }
  return parts.join('\n\n');
}

/**
 * QueryRewriterService — the "Conversation-Aware Query Rewriter" stage
 * between a user's raw message and semantic search.
 *
 * Why it exists: embedding a follow-up like "explain the second one" or
 * "what about directors?" on its own carries almost no semantic signal —
 * vector search needs a self-contained query to find the right chunks.
 * This service resolves references using conversation history and produces
 * that standalone query. It is deliberately separate from RagService's
 * final-answer LLM call: this call's only output is a search string, never
 * an answer, which keeps its prompt small, fast, and easy to reason about
 * independently of answer-quality concerns.
 *
 * What enters: the latest question plus conversation memory (rolling
 * summary + recent verbatim messages).
 * What leaves: a standalone search query — either the resolved/rewritten
 * version, or the original question unchanged when it was already
 * self-contained (e.g. a topic switch, or the very first question in a
 * conversation).
 */
@Injectable()
export class QueryRewriterService {
  private readonly logger = new Logger(QueryRewriterService.name);
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
  ) {
    this.model = this.configService.get<string>('openai.chatModel', { infer: true }) ?? 'gpt-4o-mini';
  }

  async rewrite(question: string, memory: ConversationMemory): Promise<string> {
    // Nothing to resolve against — skip the extra LLM round-trip entirely.
    if (!memory.summary && memory.recentMessages.length === 0) {
      return question;
    }

    try {
      const history = formatHistory(memory);
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${history}\n\nLatest user message: ${question}\n\nStandalone search query:` },
        ],
      });

      const rewritten = response.choices[0]?.message?.content?.trim();
      if (!rewritten) {
        this.logger.warn('Query rewrite returned an empty response — falling back to the raw question');
        return question;
      }
      this.logger.log(`Rewrote question '${question}' -> '${rewritten}'`);
      return rewritten;
    } catch (error) {
      // Rewriting is an optimization, not a correctness requirement — if it
      // fails, retrieval simply falls back to the raw question rather than
      // failing the whole chat request.
      this.logger.warn(`Query rewrite failed, falling back to the raw question: ${error instanceof Error ? error.message : error}`);
      return question;
    }
  }
}
