import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService } from '../vector-store/qdrant.service';
import { RetrievalScope } from '../vector-store/interfaces/retrieval-scope.interface';
import { RetrievedChunk } from './interfaces/retrieved-chunk.interface';

/**
 * RetrieverService — turns a user's question into a ranked list of relevant
 * document chunks.
 *
 * Why it exists: this is the "R" in RAG, isolated from prompt construction
 * and LLM invocation so retrieval quality can be reasoned about (and tested)
 * independently of how the answer is eventually phrased.
 *
 * Why the similarity threshold matters for hallucination protection: cosine
 * similarity search always returns its top-K results, even if none of them
 * are actually relevant — asking an unrelated question still finds "the
 * least dissimilar" chunks. Discarding results below RAG_SIMILARITY_THRESHOLD
 * is what lets the caller distinguish "no chunk was actually about this" from
 * "here are weakly-related chunks", so an off-topic question can correctly
 * short-circuit to "not found" instead of feeding noise to the LLM.
 *
 * What enters: a scope (specific document IDs and/or a category, or neither
 * to search the whole library) and a question.
 * What leaves: chunks above the similarity threshold, ranked by relevance.
 */
@Injectable()
export class RetrieverService {
  private readonly logger = new Logger(RetrieverService.name);

  constructor(
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
    private readonly configService: ConfigService,
  ) {}

  async retrieve(scope: RetrievalScope, question: string): Promise<RetrievedChunk[]> {
    const topK = this.configService.get<number>('rag.topK', { infer: true }) ?? 8;
    const similarityThreshold = this.configService.get<number>('rag.similarityThreshold', { infer: true }) ?? 0.35;

    const questionVector = await this.embeddingsService.generateEmbedding(question);
    const results = await this.qdrantService.searchSimilarChunks(questionVector, scope, topK, similarityThreshold);

    this.logger.log(
      `Retrieved ${results.length} chunk(s) for scope ${JSON.stringify(scope)} (threshold=${similarityThreshold})`,
    );

    // Defensive re-filter: guarantees the threshold is honored even if the
    // underlying store's score_threshold semantics ever change.
    return results
      .filter((r) => r.score >= similarityThreshold)
      .map((r) => ({
        documentId: r.payload.documentId,
        text: r.payload.text,
        filename: r.payload.filename,
        pageNumber: r.payload.pageNumber,
        chunkIndex: r.payload.chunkIndex,
        score: r.score,
      }));
  }
}
