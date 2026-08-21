import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';
import { VectorStoreException } from '../common/exceptions/app.exceptions';
import { ChunkPayload, VectorChunk, SearchResult } from './interfaces/vector-chunk.interface';
import { RetrievalScope } from './interfaces/retrieval-scope.interface';

const VECTOR_SIZE_BY_MODEL: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

/**
 * QdrantService — the app's only point of contact with the vector database.
 *
 * Why it exists: every other service that needs similarity search goes
 * through this abstraction rather than importing `@qdrant/js-client-rest`
 * directly. That keeps Qdrant-specific concepts (collections, payload
 * filters, score thresholds) out of business logic, and means swapping
 * vector databases later only touches this file.
 *
 * What enters: vectors + metadata (on write), or a query vector + filter
 * (on read).
 * What leaves: nothing (on write), or a ranked list of the most similar
 * stored chunks with their similarity scores (on read).
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly vectorSize: number;

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('qdrant.url', { infer: true }) ?? 'http://localhost:6333';
    this.collectionName = this.configService.get<string>('qdrant.collection', { infer: true }) ?? 'pdf_documents';
    const embeddingModel =
      this.configService.get<string>('openai.embeddingModel', { infer: true }) ?? 'text-embedding-3-small';
    this.vectorSize = VECTOR_SIZE_BY_MODEL[embeddingModel] ?? 1536;
    // checkCompatibility disabled: the pinned docker-compose Qdrant image
    // and the @qdrant/js-client-rest SDK version drift independently, and a
    // minor version mismatch here does not affect API compatibility.
    this.client = new QdrantClient({ url, checkCompatibility: false });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.createCollection();
    } catch (error) {
      // Don't crash the whole app if Qdrant isn't reachable at boot — the
      // error will surface naturally (and clearly) on the first real request.
      this.logger.error(
        `Could not verify/create Qdrant collection on startup: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async createCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === this.collectionName);
    if (exists) {
      this.logger.log(`Qdrant collection '${this.collectionName}' already exists`);
      await this.ensurePayloadIndexes();
      return;
    }

    await this.client.createCollection(this.collectionName, {
      vectors: { size: this.vectorSize, distance: 'Cosine' },
    });
    this.logger.log(`Created Qdrant collection '${this.collectionName}' (size=${this.vectorSize})`);

    await this.ensurePayloadIndexes();
  }

  /**
   * Ensures the documentId and category payload indexes exist, regardless
   * of whether the collection was just created or already existed. Qdrant
   * no-ops when an index of the same name/schema already exists, so this is
   * safe to call unconditionally on every boot — self-healing for a
   * collection that predates the category index, with no manual migration
   * step required.
   */
  private async ensurePayloadIndexes(): Promise<void> {
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'documentId',
      field_schema: 'keyword',
    });
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'category',
      field_schema: 'keyword',
    });
  }

  async upsertChunks(chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    try {
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: chunks.map((chunk) => ({
          id: chunk.id,
          vector: chunk.vector,
          payload: chunk.payload as unknown as Record<string, unknown>,
        })),
      });
      this.logger.log(`Upserted ${chunks.length} vector(s) into '${this.collectionName}'`);
    } catch (error) {
      this.logger.error(`Qdrant upsert failed: ${error instanceof Error ? error.message : error}`);
      throw new VectorStoreException('Failed to store document vectors');
    }
  }

  /**
   * Similarity search scoped to a subset of documents (by documentId list
   * and/or category), or the whole library when scope is empty. Filtering
   * at the database level (rather than fetching broadly and filtering in
   * app code) is both faster and is the actual guarantee that a question
   * scoped to one document/category can never retrieve chunks outside it.
   */
  async searchSimilarChunks(
    queryVector: number[],
    scope: RetrievalScope,
    topK: number,
    scoreThreshold?: number,
  ): Promise<SearchResult[]> {
    try {
      const must: Array<Record<string, unknown>> = [];
      if (scope.documentIds?.length) {
        must.push({ key: 'documentId', match: { any: scope.documentIds } });
      }
      if (scope.category) {
        must.push({ key: 'category', match: { value: scope.category } });
      }

      const response = await this.client.query(this.collectionName, {
        query: queryVector,
        filter: must.length ? { must } : undefined,
        limit: topK,
        score_threshold: scoreThreshold,
        with_payload: true,
      });

      return response.points.map((point) => ({
        score: point.score,
        payload: point.payload as unknown as ChunkPayload,
      }));
    } catch (error) {
      this.logger.error(`Qdrant search failed: ${error instanceof Error ? error.message : error}`);
      throw new VectorStoreException('Failed to search document vectors');
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [{ key: 'documentId', match: { value: documentId } }],
        },
      });
      this.logger.log(`Deleted vectors for document '${documentId}'`);
    } catch (error) {
      this.logger.error(`Qdrant delete failed: ${error instanceof Error ? error.message : error}`);
      throw new VectorStoreException('Failed to delete document vectors');
    }
  }

  generatePointId(): string {
    return randomUUID();
  }
}
