# PDF RAG Assistant

Upload a PDF, ask questions about it in plain English, and get answers grounded **strictly** in that document — with page citations, and an honest "not found" when the answer isn't there. Built as a learning project for understanding Retrieval-Augmented Generation (RAG) from the inside out: no LangChain, no black-box framework — every step of the pipeline (chunking, embeddings, similarity search, prompt construction, hallucination protection) is implemented directly with the OpenAI SDK and the Qdrant SDK, so the mechanics are visible and hackable.

## 1. What this project does

```
User uploads:  AWS Architecture.pdf
User asks:     "What database does this architecture use?"
System says:   "The architecture uses PostgreSQL (Page 5)."

User asks:     "What is the capital of France?"
System says:   "I couldn't find this information in the uploaded document."
```

The second example is the important one. A generic LLM would happily answer "Paris" — this system refuses, because that answer doesn't come from the uploaded PDF. That refusal is a feature, not a bug: see [§15 Hallucination Protection](#15-hallucination-protection).

## 2. Architecture

```mermaid
flowchart TD
    A[React Frontend] -->|REST /api| B[NestJS Backend]

    subgraph Backend["NestJS Backend"]
        B --> C[PdfController]
        B --> D[ChatController]
        C --> E[PdfService]
        D --> F[ChatService]
        F --> G[RagService]
        E --> H[PdfProcessor]
        E --> I[ChunkingService]
        E --> J[EmbeddingsService]
        E --> K[QdrantService]
        G --> L[RetrieverService]
        G --> M[PromptService]
        G --> N[OpenAI Chat]
        L --> J
        L --> K
    end

    H -->|pdf-parse| O[(PDF bytes)]
    J -->|embeddings API| P[OpenAI]
    N -->|chat completions API| P
    K -->|REST| Q[(Qdrant)]
```

### Request-time RAG flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as React Frontend
    participant Chat as ChatService
    participant Rag as RagService
    participant Ret as RetrieverService
    participant Emb as EmbeddingsService
    participant Qd as Qdrant
    participant LLM as OpenAI Chat

    U->>FE: "What database is used?"
    FE->>Chat: POST /api/chat {documentId, question}
    Chat->>Chat: verify document exists & status=processed
    Chat->>Rag: answerQuestion(documentId, question)
    Rag->>Ret: retrieve(documentId, question)
    Ret->>Emb: generateEmbedding(question)
    Emb->>Ret: question vector
    Ret->>Qd: search(vector, filter: documentId, topK, threshold)
    Qd->>Ret: scored chunks
    Ret->>Rag: chunks above similarity threshold
    alt no chunks above threshold
        Rag->>Chat: "I couldn't find this information..."
    else chunks found
        Rag->>LLM: system prompt + context + question
        LLM->>Rag: grounded answer
        Rag->>Chat: answer + sources
    end
    Chat->>FE: {answer, sources}
    FE->>U: render answer + page citations
```

## 3. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS + TanStack Query + Axios |
| Backend | NestJS + TypeScript (strict mode), REST APIs, Multer |
| AI | OpenAI SDK (embeddings + chat completions), used directly — no framework |
| Vector DB | Qdrant |
| Metadata store | In-memory repository behind a `DocumentsRepository` interface (Postgres-ready, see [§17](#17-future-improvements)) |
| Infra | Docker Compose (Qdrant, Postgres, backend, frontend) |

## 4. Project structure

```
pdf-rag-agent/
├── apps/
│   ├── frontend/               React + Vite + TypeScript
│   │   └── src/
│   │       ├── api/            axios client
│   │       ├── components/     UploadPanel, ChatPanel, DocumentCard, ...
│   │       ├── hooks/           useUploadDocument, useChat
│   │       └── types/
│   └── backend/                NestJS + TypeScript
│       └── src/
│           ├── pdf/            upload, parsing, chunking, document metadata
│           ├── embeddings/     OpenAI embeddings (batched, retried)
│           ├── vector-store/   Qdrant abstraction
│           ├── rag/            retriever, prompt builder, RAG orchestration
│           ├── chat/           /api/chat endpoint
│           ├── health/         /api/health
│           └── common/         exceptions, filters, interceptors, DI providers
├── docker/                     Dockerfiles + nginx.conf
├── docker-compose.yml
├── .env.example
└── README.md
```

## 5. Environment variables

Copy `.env.example` to `.env` (for `docker compose`) and to `apps/backend/.env` (for local dev — NestJS's `ConfigModule` reads from the app directory). **Never commit either file.**

```env
OPENAI_API_KEY=                     # your OpenAI key
OPENAI_CHAT_MODEL=gpt-4o-mini       # any chat-capable model
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=pdf_documents

CHUNK_SIZE=700                      # target chunk size, in tokens
CHUNK_OVERLAP=120                   # overlap between consecutive chunks, in tokens

RAG_TOP_K=5                         # chunks retrieved per question
RAG_SIMILARITY_THRESHOLD=0.35       # minimum cosine similarity to keep a chunk

MAX_FILE_SIZE=20971520              # 20 MB
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/pdf_rag_agent
```

Changing `OPENAI_CHAT_MODEL` / `OPENAI_EMBEDDING_MODEL` requires no code changes — every service reads them through `ConfigService`.

## 6. Installation & running locally

**Prerequisites:** Node 20+, Docker.

```bash
# 1. Start Qdrant (+ optional Postgres)
docker compose up -d qdrant postgres

# 2. Configure environment
cp .env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
# edit apps/backend/.env and set OPENAI_API_KEY

# 3. Install & run backend
cd apps/backend && npm install && npm run start:dev

# 4. Install & run frontend (in a new terminal)
cd apps/frontend && npm install && npm run dev
```

Open http://localhost:5173, upload a PDF, and ask a question.

### Running everything via Docker Compose

```bash
cp .env.example .env   # fill in OPENAI_API_KEY
docker compose up -d --build
```

This starts all 4 services: `qdrant` (6333), `postgres` (5434→5432), `backend` (3001), `frontend` (5173).

## 7. Qdrant setup

Qdrant needs no manual setup beyond `docker compose up -d qdrant`. On boot, `QdrantService.onModuleInit()` automatically:
1. Checks whether the configured collection (`QDRANT_COLLECTION`) exists.
2. If not, creates it with vector size matched to `OPENAI_EMBEDDING_MODEL` (1536 dims for `text-embedding-3-small`/`ada-002`, 3072 for `text-embedding-3-large`) and cosine distance.
3. Creates a **keyword payload index on `documentId`** — this is what makes per-document filtering fast and correct (see [§13](#13-how-retrieval-works)).

The Qdrant dashboard is available at http://localhost:6333/dashboard.

## 8. API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/documents/upload` | Upload a PDF (`multipart/form-data`, field `file`) |
| GET | `/api/documents/:documentId` | Get document status/metadata |
| DELETE | `/api/documents/:documentId` | Delete a document and its vectors |
| POST | `/api/chat` | Ask a question about a document |
| GET | `/api/health` | Health check |

### Example requests

```bash
# Upload
curl -F "file=@AWS_Architecture.pdf" http://localhost:3001/api/documents/upload
# => {"documentId":"...", "filename":"AWS_Architecture.pdf", "status":"processed", "pageCount":12, "chunkCount":87}

# Ask a question
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"documentId":"<uuid>","question":"What database does this architecture use?"}'
# => {"answer":"The architecture uses PostgreSQL (Page 5).","sources":[{"filename":"AWS_Architecture.pdf","pageNumber":5,...}]}
```

## 9. How chunking works

**Why chunking exists:** an embedding vector represents the *overall meaning* of whatever text you feed it. Embed an entire 20-page PDF as one vector and you get a blurry average of everything in it — useless for finding a single specific fact. Embedding is too fine-grained a tool at the whole-document level, so the document is split into many small, topically-focused pieces first, and each piece gets its own vector.

`ChunkingService` ([`apps/backend/src/pdf/chunking.service.ts`](apps/backend/src/pdf/chunking.service.ts)):
- Groups sentences up to `CHUNK_SIZE` tokens (approximated at ~4 characters/token — close enough for sizing decisions without a real tokenizer dependency).
- Splits on sentence boundaries wherever possible, rather than mid-sentence, so each chunk reads coherently and embeds meaningfully.
- Carries the last `CHUNK_OVERLAP` tokens of one chunk into the start of the next. Without overlap, a fact sitting right at a chunk boundary gets torn across two chunks, and the surrounding context needed to answer a question about it can end up in neither. Overlap means boundary content still appears whole in at least one chunk.
- Chunks **per page**, so every chunk is tagged with the exact page it came from — this is what makes the "Page 5" citation possible later.
- Is completely independent of `PdfProcessor` — it only consumes `{ pageNumber, text }`, so a future DOCX/HTML importer could reuse it unmodified.

## 10. How embeddings work

`EmbeddingsService` ([`apps/backend/src/embeddings/embeddings.service.ts`](apps/backend/src/embeddings/embeddings.service.ts)) calls OpenAI's embeddings endpoint to turn text into a fixed-length vector, positioned in space such that semantically similar text ends up near each other — even with very different wording. That's what lets the question *"what database is used?"* find the chunk *"PostgreSQL is used as the primary datastore"*, despite sharing almost no words.

- **Batched**, not one request per chunk — a 100-page PDF could otherwise mean hundreds of sequential API calls.
- **Retried** with exponential backoff on rate limits (429) and server errors (5xx); non-retryable errors (bad key, malformed input) fail fast.
- **Validated** — empty/whitespace text is rejected before ever reaching the API, since OpenAI errors on it anyway.

## 11. How retrieval works

`RetrieverService` ([`apps/backend/src/rag/retriever.service.ts`](apps/backend/src/rag/retriever.service.ts)) embeds the user's question with the same model used for chunks, then asks Qdrant for the `RAG_TOP_K` most similar vectors — **scoped to the single document being asked about** via a server-side Qdrant filter on the `documentId` payload field. This filter is the actual mechanism that keeps Document A's chunks from ever leaking into an answer about Document B (verified in the multi-document isolation test, [§16](#16-testing)) — it is not enforced by convention, it's a hard query constraint evaluated by Qdrant itself.

**Why top-K:** returning every chunk above 0 similarity would flood the LLM's context with marginally-relevant noise and blow through context limits on large documents. Top-K keeps only the strongest matches.

## 12. How vector similarity works

Every chunk (and every question) is a vector in the same 1536-or-3072-dimensional space. Qdrant ranks stored vectors by **cosine similarity** to the query vector — the cosine of the angle between them, ranging from -1 (opposite meaning) to 1 (identical meaning). Two chunks about the same topic, phrased completely differently, still point in roughly the same direction in that space; that's the entire mechanism that makes semantic (not just keyword) search possible.

## 13. Qdrant

`QdrantService` ([`apps/backend/src/vector-store/qdrant.service.ts`](apps/backend/src/vector-store/qdrant.service.ts)) is the single point of contact with the vector database — no other service imports the Qdrant SDK directly. It exposes exactly four operations, matching the spec's abstraction: `createCollection`, `upsertChunks`, `searchSimilarChunks` (with a `documentId` filter and similarity threshold), and `deleteDocument`. Every stored point carries a payload: `documentId, filename, pageNumber, chunkIndex, text, createdAt` — enough to reconstruct a citation without a second lookup anywhere else.

## 14. How context/prompt construction works

`PromptService` ([`apps/backend/src/rag/prompt.service.ts`](apps/backend/src/rag/prompt.service.ts)) takes the retrieved chunks and builds the exact messages sent to the LLM — nothing else in the app talks to `openai.chat.completions` with a hand-built prompt. Each chunk is labeled with its page number (`[Page 5]\n...`) before being joined into a single context block, so the model can (and is instructed to) cite where an answer came from. Irrelevant chunks are never included — only what `RetrieverService` already filtered above the similarity threshold.

## 15. Hallucination protection

This is enforced in **two independent layers**, deliberately redundant:

1. **Similarity threshold (retrieval layer).** Cosine search always returns its top-K results, even for a totally unrelated question — it just finds "the least dissimilar" chunks. `RAG_SIMILARITY_THRESHOLD` discards anything below a minimum relevance score. If *nothing* clears the bar, `RagService` returns `"I couldn't find this information in the uploaded document."` **without ever calling the LLM** — cheaper, faster, and removes any chance of the model inventing an answer from its own training data.
2. **System prompt (generation layer).** Even with genuinely relevant chunks, the system prompt explicitly forbids outside knowledge and instructs the model to say so when the answer isn't in the given context — a second line of defense for cases where retrieval finds something topically related but not actually sufficient to answer.

```
You are a document question-answering assistant.
Answer the user's question using ONLY the provided document context.
Rules:
1. Do not use outside knowledge.
2. Do not invent facts.
3. If the answer cannot be found in the context, clearly say that the
   information was not found in the document.
4. Prefer concise and direct answers.
5. When possible, mention the page number where the information was found.
```

## 16. Testing

```bash
cd apps/backend
npm test          # unit tests (mocked OpenAI + Qdrant clients)
npm run test:e2e  # integration test against a real Qdrant + fake deterministic OpenAI client
```

**Unit tests** (41 tests) cover `ChunkingService`, `EmbeddingsService`, `QdrantService`, `RetrieverService`, `PromptService`, and `RagService` in isolation, each with mocked dependencies — retries, batching, threshold filtering, source deduplication, and error mapping are all exercised directly.

**Integration test** ([`apps/backend/test/rag-pipeline.e2e-spec.ts`](apps/backend/test/rag-pipeline.e2e-spec.ts)) drives the real HTTP API (`supertest`) against a real, isolated Qdrant collection, with only the OpenAI client swapped for a deterministic fake (a bag-of-words embedding + a context-echoing "LLM") — no API key or network access needed, and fully reproducible. It covers the four required scenarios plus document deletion and validation errors:

1. **Question exists in the PDF** → correct, grounded answer with a source citation.
2. **Question doesn't exist in the PDF** → `"I couldn't find this information in the uploaded document."`
3. **Completely unrelated question** → same "not found" response, never reaches the LLM.
4. **Multiple PDFs uploaded** → a question against Document A never retrieves chunks from Document B, verified by asserting every returned source's `documentId` matches the document that was actually queried.

## 17. Future improvements

The architecture was kept intentionally extensible for these (not implemented in this MVP):

- **PostgreSQL-backed document metadata** — swap `InMemoryDocumentsRepository` for a Postgres implementation of the same `DocumentsRepository` interface; nothing else changes.
- **User authentication & multi-user document isolation** — add a `userId` to document metadata + a Qdrant payload filter, mirroring how `documentId` isolation already works.
- **Conversation history** — persist chat turns per document and feed prior Q&A into the prompt.
- **Streaming responses** — swap `chat.completions.create` for the streaming variant and pipe chunks to the client over SSE.
- **Redis caching** — cache embeddings for repeated questions.
- **Hybrid search (BM25 + vectors) and reranking** — combine keyword and semantic search, then rerank the merged results.
- **OCR for scanned PDFs, table/image extraction** — `PdfProcessor` is isolated specifically so its internals can be swapped without touching chunking, embedding, or retrieval.
- **Background job processing (BullMQ)** — move the currently-synchronous upload pipeline off the request thread for very large PDFs.
- **Token/cost tracking, RAG evaluation, observability** — instrument `EmbeddingsService` and `RagService` call sites, which already centralize every OpenAI call.
