import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RetrieverService } from './retriever.service';
import { PromptService, NOT_FOUND_ANSWER } from './prompt.service';
import { QueryRewriterService } from './query-rewriter.service';
import { ChitchatService } from './chitchat.service';
import { LlmServiceException } from '../common/exceptions/app.exceptions';
import { OPENAI_CLIENT } from '../common/openai-client.provider';
import { AnswerSource, AnswerResult } from './interfaces/answer-result.interface';
import { RetrievalScope } from '../vector-store/interfaces/retrieval-scope.interface';
import type { ConversationMemory } from '../conversations/interfaces/conversation-memory.interface';

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

/**
 * RagService — orchestrates the full retrieval-augmented generation flow:
 *
 *   question -> chitchat check -> retrieve chunks -> relevance check -> build prompt -> LLM -> grounded answer
 *
 * Why it exists: this is the component described in spec section 9 ("RAG
 * Query Flow"). It deliberately contains no retrieval or prompt-construction
 * logic of its own (those belong to RetrieverService and PromptService) —
 * its only responsibility is sequencing them and applying two
 * short-circuits: ChitchatService first (a greeting/social message never
 * touches retrieval or the LLM at all), then the hallucination-protection
 * short-circuit — if retrieval finds nothing sufficiently relevant, the LLM
 * is never even called.
 *
 * What enters: a retrieval scope (specific documents and/or a category, or
 * neither to search the whole library), the user's natural-language
 * question, and optionally that conversation's memory (rolling summary +
 * recent messages).
 * What leaves: an answer string grounded in the retrieved documents, plus
 * the exact chunks (which document, page number, chunk index) it was
 * derived from.
 *
 * Conversation memory feeds two DIFFERENT things here, deliberately kept
 * separate:
 *   1. QueryRewriterService turns the raw question into a standalone search
 *      query (using memory to resolve "it"/"the second one"/etc.) — THAT
 *      resolved query is what gets embedded and searched in Qdrant, since a
 *      bare follow-up like "explain the second one" carries almost no
 *      retrievable signal on its own.
 *   2. PromptService still sees the user's original raw question (so the
 *      final answer reads naturally) plus the memory itself, so the model
 *      can resolve references in its own phrasing — but memory is never
 *      the source of facts; DOCUMENT CONTEXT (this turn's fresh retrieval)
 *      is, per the system prompt's explicit instruction.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly model: string;

  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly promptService: PromptService,
    private readonly queryRewriterService: QueryRewriterService,
    private readonly chitchatService: ChitchatService,
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
  ) {
    this.model = this.configService.get<string>('openai.chatModel', { infer: true }) ?? 'gpt-4o-mini';
  }

  async answerQuestion(scope: RetrievalScope, question: string, memory?: ConversationMemory): Promise<AnswerResult> {
    const chitchatReply = this.chitchatService.detect(question);
    if (chitchatReply) {
      this.logger.log(`Detected a chitchat/greeting message — skipping retrieval and the LLM call entirely`);
      return { answer: chitchatReply, sources: [] };
    }

    this.logger.log(`RAG query received for scope ${JSON.stringify(scope)}`);

    const searchQuery = memory ? await this.queryRewriterService.rewrite(question, memory) : question;
    const chunks = await this.retrieverService.retrieve(scope, searchQuery);

    if (chunks.length === 0) {
      this.logger.log(`No sufficiently relevant chunks found for scope ${JSON.stringify(scope)} — skipping LLM call`);
      return { answer: NOT_FOUND_ANSWER, sources: [] };
    }

    const messages = this.promptService.buildMessages(chunks, question, memory);

    this.logger.log(`LLM request started (model=${this.model}, contextChunks=${chunks.length})`);
    const answer = await this.generateAnswer(messages);
    this.logger.log('LLM request completed');

    // Sources are deduplicated by document+page so the UI doesn't show the
    // same page multiple times when several chunks from it were retrieved —
    // keyed by documentId as well as page number since two different
    // documents can legitimately share the same page number.
    const seenPages = new Set<string>();
    const sources: AnswerSource[] = [];
    for (const chunk of chunks) {
      const key = `${chunk.documentId}:${chunk.pageNumber}`;
      if (seenPages.has(key)) continue;
      seenPages.add(key);
      sources.push({
        documentId: chunk.documentId,
        filename: chunk.filename,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        snippetText: chunk.text,
      });
    }

    return { answer, sources };
  }

  private async generateAnswer(messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature: 0, // deterministic, grounded answers over creative ones
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new LlmServiceException('OpenAI returned an empty response');
        }
        return content.trim();
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryable(error);
        this.logger.warn(
          `LLM request attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${error instanceof Error ? error.message : error}`,
        );
        if (!retryable || attempt === MAX_RETRIES) break;
        await this.sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
      }
    }

    this.logger.error(`LLM answer generation failed after retries: ${lastError instanceof Error ? lastError.message : lastError}`);
    throw new LlmServiceException(
      lastError instanceof OpenAI.APIError ? `OpenAI chat request failed: ${lastError.message}` : undefined,
    );
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return error.status === 429 || (error.status !== undefined && error.status >= 500);
    }
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
