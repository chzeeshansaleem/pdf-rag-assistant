import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { RetrieverService } from './retriever.service';
import { PromptService, NOT_FOUND_ANSWER } from './prompt.service';
import { LlmServiceException } from '../common/exceptions/app.exceptions';
import { OPENAI_CLIENT } from '../common/openai-client.provider';

export interface AnswerSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
}

export interface AnswerResult {
  answer: string;
  sources: AnswerSource[];
}

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

/**
 * RagService — orchestrates the full retrieval-augmented generation flow:
 *
 *   question -> retrieve chunks -> relevance check -> build prompt -> LLM -> grounded answer
 *
 * Why it exists: this is the component described in spec section 9 ("RAG
 * Query Flow"). It deliberately contains no retrieval or prompt-construction
 * logic of its own (those belong to RetrieverService and PromptService) —
 * its only responsibility is sequencing them and applying the final
 * hallucination-protection short-circuit: if retrieval finds nothing
 * sufficiently relevant, the LLM is never even called.
 *
 * What enters: a documentId and a natural-language question.
 * What leaves: an answer string grounded in the document, plus the exact
 * chunks (page numbers, chunk indices) it was derived from.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly model: string;

  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly promptService: PromptService,
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
  ) {
    this.model = this.configService.get<string>('openai.chatModel', { infer: true }) ?? 'gpt-4o-mini';
  }

  async answerQuestion(documentId: string, question: string): Promise<AnswerResult> {
    this.logger.log(`RAG query received for document '${documentId}'`);

    const chunks = await this.retrieverService.retrieve(documentId, question);

    if (chunks.length === 0) {
      this.logger.log(`No sufficiently relevant chunks found for document '${documentId}' — skipping LLM call`);
      return { answer: NOT_FOUND_ANSWER, sources: [] };
    }

    const messages = this.promptService.buildMessages(chunks, question);

    this.logger.log(`LLM request started (model=${this.model}, contextChunks=${chunks.length})`);
    const answer = await this.generateAnswer(messages);
    this.logger.log('LLM request completed');

    // Sources are deduplicated by page so the UI doesn't show the same page
    // multiple times when several chunks from it were retrieved.
    const seenPages = new Set<number>();
    const sources: AnswerSource[] = [];
    for (const chunk of chunks) {
      if (seenPages.has(chunk.pageNumber)) continue;
      seenPages.add(chunk.pageNumber);
      sources.push({
        documentId,
        filename: chunk.filename,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
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
