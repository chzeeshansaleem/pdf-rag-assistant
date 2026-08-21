import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrieverService } from './retriever.service';
import { ContextEvaluatorService } from './context-evaluator.service';
import { RetrievalScope } from '../vector-store/interfaces/retrieval-scope.interface';
import { RetrievedChunk } from './interfaces/retrieved-chunk.interface';
import { SelfCorrectingRetrievalResult } from './interfaces/self-correcting-retrieval-result.interface';

const DEFAULT_MAX_RETRIES = 2;

// Identity for "is this the same chunk" purposes — document + chunk index
// is stable regardless of score jitter or retrieval order, so two retrieval
// results are the "same set" if they contain exactly the same chunk
// identities, independent of ordering.
function chunkSetSignature(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `${c.documentId}:${c.chunkIndex}`)
    .sort()
    .join('|');
}

function sameChunkSet(a: RetrievedChunk[], b: RetrievedChunk[]): boolean {
  return chunkSetSignature(a) === chunkSetSignature(b);
}

/**
 * SelfCorrectingRetrievalService — owns the retry-control loop of
 * self-correcting RAG:
 *
 *   retrieve -> evaluate -> (sufficient? done : refine query -> retrieve again) -> ... -> give up
 *
 * Why it exists: RagService should stay a straight-line orchestrator (scope
 * resolution -> retrieval -> prompt -> LLM), not own a while-loop with
 * retry/give-up bookkeeping. Isolating that loop here means it can be
 * reasoned about and tested on its own — "does it stop at the right time,
 * does it use the refined query on retry, does it give up cleanly" — without
 * dragging in prompt-building or answer generation.
 *
 * `MAX_RETRIES` is interpreted as ADDITIONAL attempts beyond the first, so
 * MAX_RETRIES=2 (the default) means up to 3 retrieve+evaluate cycles total:
 * the initial attempt plus up to 2 refined retries.
 *
 * The loop stops early (before exhausting MAX_RETRIES) whenever continuing
 * clearly wouldn't help: the evaluator judged the context sufficient, it had
 * nothing new to suggest (no refinedQuery, or the same query repeated), or a
 * refined query retrieved the SAME chunks as the previous attempt. That last
 * case matters for small/single-chunk documents: refining the query can't
 * conjure up a chunk that doesn't exist, so retrying against an unchanged
 * result set would just burn evaluator calls until MAX_RETRIES and give up —
 * instead, once retrieval has converged, this falls through and lets the
 * (more lenient) answer LLM attempt a grounded answer from what's there,
 * rather than returning NOT_FOUND for content the LLM could have used.
 */
@Injectable()
export class SelfCorrectingRetrievalService {
  private readonly logger = new Logger(SelfCorrectingRetrievalService.name);

  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly contextEvaluatorService: ContextEvaluatorService,
    private readonly configService: ConfigService,
  ) {}

  async retrieveWithSelfCorrection(scope: RetrievalScope, initialQuery: string): Promise<SelfCorrectingRetrievalResult> {
    const maxRetries = this.configService.get<number>('rag.maxRetries', { infer: true }) ?? DEFAULT_MAX_RETRIES;
    const maxAttempts = maxRetries + 1;

    let query = initialQuery;
    let chunks = await this.retrieverService.retrieve(scope, query);
    let evaluation = await this.contextEvaluatorService.evaluate(query, chunks);
    let attempt = 1;

    this.logAttempt(attempt, maxAttempts, query, chunks.length, evaluation);

    while (!evaluation.sufficient && attempt < maxAttempts) {
      const nextQuery = evaluation.refinedQuery?.trim();
      if (!nextQuery || nextQuery.toLowerCase() === query.trim().toLowerCase()) {
        this.logger.log('Evaluator had no new query to try — stopping retries early.');
        break;
      }

      query = nextQuery;
      const nextChunks = await this.retrieverService.retrieve(scope, query);
      attempt++;

      if (chunks.length > 0 && sameChunkSet(chunks, nextChunks)) {
        this.logger.log(
          `[attempt ${attempt}/${maxAttempts}] query="${query}" retrieved the same chunk(s) as the previous attempt — further refinement can't find anything new, falling through to the answer LLM with what's available.`,
        );
        return {
          chunks: nextChunks,
          sufficient: true,
          reason: 'Retrieval converged on the same context after refinement; letting the answer model attempt a grounded answer from it.',
          finalQuery: query,
          attempts: attempt,
        };
      }

      chunks = nextChunks;
      evaluation = await this.contextEvaluatorService.evaluate(query, chunks);

      this.logAttempt(attempt, maxAttempts, query, chunks.length, evaluation);
    }

    return {
      chunks,
      sufficient: evaluation.sufficient && chunks.length > 0,
      reason: evaluation.reason,
      finalQuery: query,
      attempts: attempt,
    };
  }

  private logAttempt(attempt: number, maxAttempts: number, query: string, chunkCount: number, evaluation: { sufficient: boolean; reason: string }): void {
    // Intentionally logs the query and chunk COUNT, never chunk text —
    // retrieved document content shouldn't end up in application logs.
    this.logger.log(
      `[attempt ${attempt}/${maxAttempts}] query="${query}" chunks=${chunkCount} sufficient=${evaluation.sufficient} reason="${evaluation.reason}"`,
    );
  }
}
