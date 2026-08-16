import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';
import { VectorStoreException } from '../common/exceptions/app.exceptions';

/**
 * Payload stored alongside every vector in Qdrant. This is what a similarity
 * search returns in addition to the raw score — it is how a retrieved chunk
 * gets traced back to a filename, page number, and position in the source
 * document.
 */
export interface ChunkPayload {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  createdAt: string;
}

export interface VectorChunk {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface SearchResult {
  score: number;
  payload: ChunkPayload;
}

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
      return;
    }

    await this.client.createCollection(this.collectionName, {
      vectors: { size: this.vectorSize, distance: 'Cosine' },
    });

    // Index documentId so retrieval can filter by it efficiently — this is
    // what keeps one document's chunks from leaking into another's answers.
    await this.client.createPayloadIndex(this.collectionName, {
      field_name: 'documentId',
      field_schema: 'keyword',
    });

    this.logger.log(`Created Qdrant collection '${this.collectionName}' (size=${this.vectorSize})`);
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
   * Similarity search scoped to a single document. Filtering by documentId
   * at the database level (rather than fetching broadly and filtering in
   * app code) is both faster and is the actual guarantee that a question
   * about Document A can never retrieve chunks from Document B.
   */
  async searchSimilarChunks(
    queryVector: number[],
    documentId: string,
    topK: number,
    scoreThreshold?: number,
  ): Promise<SearchResult[]> {
    try {
      const response = await this.client.query(this.collectionName, {
        query: queryVector,
        filter: {
          must: [{ key: 'documentId', match: { value: documentId } }],
        },
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
