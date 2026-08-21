/**
 * Centralized, typed application configuration.
 *
 * Why this exists: scattering `process.env.X` calls across services makes it
 * hard to know what configuration the app depends on, and gives no single
 * place to apply defaults or fail fast on missing values. Every other module
 * reads configuration through `ConfigService.get<AppConfig>(...)` instead of
 * touching `process.env` directly.
 */

export interface AppConfig {
  port: number;
  corsOrigin: string;
  openai: {
    apiKey: string;
    chatModel: string;
    embeddingModel: string;
  };
  qdrant: {
    url: string;
    collection: string;
  };
  chunking: {
    chunkSize: number;
    chunkOverlap: number;
  };
  rag: {
    topK: number;
    similarityThreshold: number;
    maxRecentMessages: number;
    /** Additional retry attempts the self-correcting retrieval loop may take beyond the first, when the LLM evaluator judges retrieved context insufficient. */
    maxRetries: number;
  };
  upload: {
    maxFileSize: number;
    storageDir: string;
  };
  databaseUrl?: string;
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default (): AppConfig => ({
  port: toInt(process.env.PORT, 3001),
  // Comma-separated list is supported (see main.ts) — includes a couple of
  // Vite's common fallback ports so local dev isn't broken when 5173 is
  // already taken (e.g. by the Dockerized frontend) and Vite bumps up.
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175',
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    chatModel: process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },
  qdrant: {
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    collection: process.env.QDRANT_COLLECTION ?? 'pdf_documents',
  },
  chunking: {
    chunkSize: toInt(process.env.CHUNK_SIZE, 700),
    chunkOverlap: toInt(process.env.CHUNK_OVERLAP, 120),
  },
  rag: {
    topK: toInt(process.env.RAG_TOP_K, 8),
    similarityThreshold: toFloat(process.env.RAG_SIMILARITY_THRESHOLD, 0.35),
    // Verbatim messages sent to the LLM per turn (both for query rewriting
    // and the final answer). Older messages are folded into a rolling
    // conversation summary instead of being sent raw forever.
    maxRecentMessages: toInt(process.env.RAG_MAX_RECENT_MESSAGES, 10),
    maxRetries: toInt(process.env.RAG_MAX_RETRIES, 2),
  },
  upload: {
    maxFileSize: toInt(process.env.MAX_FILE_SIZE, 20 * 1024 * 1024),
    storageDir: process.env.UPLOAD_STORAGE_DIR ?? './data/uploads',
  },
  databaseUrl: process.env.DATABASE_URL,
});
