import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EmbeddingServiceException } from '../common/exceptions/app.exceptions';
import { OPENAI_CLIENT } from '../common/openai-client.provider';

const MAX_BATCH_SIZE = 100; // OpenAI embeddings endpoint accepts up to 2048 inputs; we batch conservatively
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

/**
 * EmbeddingsService — turns text into vectors.
 *
 * Why it exists: similarity search (and therefore retrieval) only works in
 * vector space. An embedding model maps text to a fixed-length numeric
 * vector such that semantically similar text ends up close together in that
 * space — this is what lets us find "PostgreSQL is used as the primary
 * datastore" as relevant to the question "what database does this use?"
 * even though they share almost no exact words.
 *
 * What enters: one or more strings (document chunks, or a user's question).
 * What leaves: one float32 vector per input string, in the same order.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly model: string;

  constructor(
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
    private readonly configService: ConfigService,
  ) {
    this.model = this.configService.get<string>('openai.embeddingModel', { infer: true }) ?? 'text-embedding-3-small';
  }

  /** Embeds a single string. Convenience wrapper around generateEmbeddings(). */
  async generateEmbedding(text: string): Promise<number[]> {
    const [vector] = await this.generateEmbeddings([text]);
    return vector;
  }

  /**
   * Embeds many strings in batches, rather than firing one HTTP request per
   * chunk — for a 100-page PDF that could otherwise mean hundreds of
   * sequential API calls. Empty/whitespace-only strings are rejected early
   * since the OpenAI API errors on them, and callers (chunking) should never
   * be producing them in practice.
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const cleaned = texts.map((t) => t.trim());
    const emptyIndex = cleaned.findIndex((t) => t.length === 0);
    if (emptyIndex !== -1) {
      throw new EmbeddingServiceException(`Cannot embed empty text (index ${emptyIndex})`);
    }
    if (cleaned.length === 0) return [];

    const batches: string[][] = [];
    for (let i = 0; i < cleaned.length; i += MAX_BATCH_SIZE) {
      batches.push(cleaned.slice(i, i + MAX_BATCH_SIZE));
    }

    const vectors: number[][] = [];
    for (const batch of batches) {
      const batchVectors = await this.embedBatchWithRetry(batch);
      vectors.push(...batchVectors);
    }
    return vectors;
  }

  private async embedBatchWithRetry(batch: string[]): Promise<number[][]> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
        });

        if (!response.data || response.data.length !== batch.length) {
          throw new EmbeddingServiceException('OpenAI returned an unexpected number of embeddings');
        }

        return response.data
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding);
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryable(error);
        this.logger.warn(
          `Embedding batch attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${
            error instanceof Error ? error.message : error
          }`,
        );
        if (!retryable || attempt === MAX_RETRIES) break;
        await this.sleep(BASE_RETRY_DELAY_MS * 2 ** attempt);
      }
    }

    this.logger.error(`Embedding generation failed after retries: ${lastError instanceof Error ? lastError.message : lastError}`);
    throw new EmbeddingServiceException(
      lastError instanceof OpenAI.APIError ? `OpenAI embedding request failed: ${lastError.message}` : undefined,
    );
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      // 429 (rate limit) and 5xx are worth retrying; 4xx like bad request/auth are not.
      return error.status === 429 || (error.status !== undefined && error.status >= 500);
    }
    // Network-level errors (timeouts, ECONNRESET, etc.) are also worth retrying.
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
