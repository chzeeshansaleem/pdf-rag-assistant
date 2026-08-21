# DocuMind AI — Architecture

A multi-document RAG (Retrieval-Augmented Generation) assistant: upload PDFs, tag them by category, and ask questions that are answered strictly from the retrieved document content, with citations.

**Stack**: React 19 + Vite (frontend) · NestJS 11 (backend) · PostgreSQL + Prisma (metadata/conversations) · Qdrant (vector store) · OpenAI (embeddings + chat)

---

## 1. System Overview

```mermaid
flowchart LR
    subgraph Client["Browser"]
        FE["React SPA\n(Dashboard + Chat)"]
    end

    subgraph Backend["NestJS Backend (apps/backend)"]
        API["REST API\n/api/*"]
        PDF["PdfService\n(ingestion pipeline)"]
        RAG["RagService\n(retrieval + prompting)"]
        CONV["ConversationsService\n(chat history)"]
    end

    subgraph Data["Data Stores"]
        PG[("PostgreSQL\ndocuments, conversations,\nmessages, citations")]
        QD[("Qdrant\nvector chunks +\nmetadata payload")]
        FS[("Local disk\noriginal PDF bytes")]
    end

    subgraph External["OpenAI"]
        EMB["Embeddings API\ntext-embedding-3-small"]
        LLM["Chat Completions API\ngpt-4o-mini"]
    end

    FE <-->|"axios / JSON\nCORS"| API
    API --> PDF
    API --> RAG
    API --> CONV

    PDF --> FS
    PDF -->|"chunk metadata"| PG
    PDF -->|"embed chunks"| EMB
    PDF -->|"upsert vectors"| QD

    RAG -->|"embed question"| EMB
    RAG -->|"scoped similarity search"| QD
    RAG -->|"grounded completion"| LLM
    CONV -->|"persist Q/A + citations"| PG
```

---

## 2. Backend Module Graph — how files talk to each other

Every module is a NestJS `@Module`; arrows are dependency-injection imports (who calls whom). This is the literal file-to-file communication path.

```mermaid
flowchart TD
    AppModule["app.module.ts"]

    AppModule --> PrismaModule["database/prisma.module.ts\n(@Global — PrismaService)"]
    AppModule --> HealthModule["health/health.module.ts"]
    AppModule --> PdfModule["pdf/pdf.module.ts"]
    AppModule --> EmbeddingsModule["embeddings/embeddings.module.ts"]
    AppModule --> VectorStoreModule["vector-store/vector-store.module.ts"]
    AppModule --> RagModule["rag/rag.module.ts"]
    AppModule --> ConversationsModule["conversations/conversations.module.ts"]
    AppModule --> ChatModule["chat/chat.module.ts"]

    PdfModule --> EmbeddingsModule
    PdfModule --> VectorStoreModule
    PdfModule -.->|"PrismaDocumentsRepository"| PrismaModule

    RagModule --> EmbeddingsModule
    RagModule --> VectorStoreModule

    ChatModule --> RagModule
    ChatModule --> PdfModule
    ChatModule --> ConversationsModule

    ConversationsModule -.->|"ConversationsService"| PrismaModule

    subgraph PdfModuleInternals["pdf/ internals"]
        PdfController["pdf.controller.ts\n(HTTP routes)"]
        PdfService["pdf.service.ts\n(orchestration)"]
        PdfProcessor["pdf.processor.ts\n(pdf-parse extraction)"]
        Chunking["chunking.service.ts"]
        FileStorage["file-storage.service.ts\n(disk read/write)"]
        DocsRepo["documents.repository.ts\n(abstract)"]
        PrismaDocsRepo["prisma-documents.repository.ts\n(impl)"]
        Limiter["concurrency-limiter.ts"]
        Sweeper["stuck-processing-sweeper.service.ts"]

        PdfController --> PdfService
        PdfService --> PdfProcessor
        PdfService --> Chunking
        PdfService --> FileStorage
        PdfService --> DocsRepo
        PdfService --> Limiter
        DocsRepo -.implements.-> PrismaDocsRepo
        Sweeper --> DocsRepo
    end

    subgraph RagModuleInternals["rag/ internals"]
        RagService["rag.service.ts\n(orchestration)"]
        Retriever["retriever.service.ts"]
        Prompt["prompt.service.ts"]

        RagService --> Retriever
        RagService --> Prompt
    end

    subgraph ChatModuleInternals["chat/ internals"]
        ChatController["chat.controller.ts"]
        ChatService["chat.service.ts"]
        ChatController --> ChatService
    end

    PdfModule -.-> PdfModuleInternals
    RagModule -.-> RagModuleInternals
    ChatModule -.-> ChatModuleInternals
```

**Key seams:**
- `DocumentsRepository` is an abstract class; `PrismaDocumentsRepository` is the only implementation. Nothing outside `pdf/` talks to Prisma directly for documents — this is the swap point if storage ever changes.
- `QdrantService` (in `vector-store/`) is the *only* file that imports `@qdrant/js-client-rest`. `RetrieverService` and `PdfService` never touch Qdrant's SDK directly.
- `ConcurrencyLimiter` lives inside `PdfService` as a private field — it caps how many documents are actively chunking/embedding/upserting at once (default 4), regardless of how many were queued in one upload batch.

---

## 3. Document Ingestion Pipeline — from upload to searchable vectors

```mermaid
sequenceDiagram
    participant U as Browser (UploadPanel)
    participant C as PdfController
    participant S as PdfService
    participant FS as FileStorageService
    participant DB as Postgres (Prisma)
    participant P as PdfProcessor
    participant Ch as ChunkingService
    participant E as EmbeddingsService
    participant O as OpenAI Embeddings API
    participant Q as QdrantService

    U->>C: POST /documents/upload\n(multipart: files[], category)
    loop per file (synchronous, fast)
        C->>S: createQueuedDocument(file, category)
        S->>FS: save(documentId, buffer)
        S->>DB: INSERT Document {status: QUEUED}
    end
    C-->>U: 201 [{documentId, status: "queued"}, ...]

    Note over C,S: Upload returns immediately.\nReal work happens in the background,\ngated by ConcurrencyLimiter(4).

    par fire-and-forget, per document
        S->>S: processDocumentAsync(id)\n(admitted by ConcurrencyLimiter)
        S->>DB: UPDATE status = PROCESSING
        S->>FS: read(documentId)
        S->>P: extract(buffer)
        P-->>S: pages[] (raw text)
        S->>Ch: chunkPages(cleanedPages)
        Ch-->>S: chunks[] {text, pageNumber, chunkIndex}
        S->>E: generateEmbeddings(chunk texts)
        E->>O: batched embedding requests\n(retry w/ backoff on 429/5xx)
        O-->>E: vectors[]
        E-->>S: vectors[]
        S->>Q: upsertChunks(vectorChunks)
        Note right of Q: payload per point:\n{documentId, filename, pageNumber,\nchunkIndex, text, category, createdAt}
        S->>DB: UPDATE status = PROCESSED,\npageCount, chunkCount
    end

    U->>C: GET /documents (polling every 2s\nwhile any doc is queued/processing)
    C-->>U: current status per document
```

**Chunking**: pages → paragraphs → sentences, accumulated up to `CHUNK_SIZE` tokens (~700, char/4 estimate) with a `CHUNK_OVERLAP` (~120 tokens) sentence tail carried into the next chunk, so context isn't severed mid-thought at chunk boundaries.

**Failure handling**: any exception in the pipeline (corrupt PDF, empty text, embedding API failure, Qdrant failure) sets `status = FAILED` with `errorMessage`; the dashboard exposes **Retry** (re-run from `QUEUED`) and **Re-process** (delete existing vectors, re-run from the stored original bytes — used after a chunking config change).

---

## 4. Chat / RAG Query Flow — how a prompt becomes a grounded answer

```mermaid
sequenceDiagram
    participant U as Browser (ChatPanel)
    participant CC as ChatController
    participant CS as ChatService
    participant CV as ConversationsService
    participant DR as DocumentsRepository
    participant RS as RagService
    participant RT as RetrieverService
    participant EM as EmbeddingsService
    participant QD as QdrantService
    participant PR as PromptService
    participant LLM as OpenAI Chat API
    participant DB as Postgres

    U->>CC: POST /chat\n{conversationId, question, documentIds?, category?}
    CC->>CS: ask(dto)
    CS->>CV: exists(conversationId)?
    alt documentIds given
        CS->>DR: findById(each) — must exist + be "processed"
    end
    CS->>CV: appendUserMessage(question, scope)
    CV->>DB: INSERT Message {role: USER, scopeDocumentIds, scopeCategory}

    CS->>RS: answerQuestion(scope, question)
    RS->>RT: retrieve(scope, question)
    RT->>EM: generateEmbedding(question)
    EM->>LLM: (OpenAI embeddings endpoint)
    LLM-->>EM: question vector
    RT->>QD: searchSimilarChunks(vector, scope, topK, threshold)
    Note right of QD: Qdrant filter built from scope:\nmust:[{documentId: any[...]}, {category: value}]\nomitted entirely = search ALL documents
    QD-->>RT: ranked chunks + similarity scores
    RT-->>RS: chunks above RAG_SIMILARITY_THRESHOLD

    alt no chunks clear the threshold
        RS-->>CS: {answer: "I couldn't find this information...", sources: []}
        Note over RS: LLM is never called —\nfirst hallucination guard
    else chunks found
        RS->>PR: buildMessages(chunks, question)
        Note right of PR: system prompt: "use ONLY this context,\nsay NOT_FOUND if absent, cite filename+page"\nuser prompt: "[filename, Page N]\n<chunk text>" per chunk
        PR-->>RS: [system, user] messages
        RS->>LLM: chat.completions.create({model, messages, temperature: 0})
        LLM-->>RS: grounded answer text
        RS->>RS: dedupe sources by documentId+pageNumber
        RS-->>CS: {answer, sources: [{documentId, filename, pageNumber, chunkIndex, snippetText}]}
    end

    CS->>CV: appendAssistantMessage(answer, sources)
    CV->>DB: INSERT Message {role: ASSISTANT} + MessageSource rows\n(snippetText snapshotted — survives later document deletion)
    CS-->>CC: {conversationId, answer, sources}
    CC-->>U: 201 JSON response
    U->>U: render MessageBubble + SourcesList
```

**Two hallucination guards**, independent of each other:
1. **Similarity threshold** (`RetrieverService`) — if nothing clears `RAG_SIMILARITY_THRESHOLD`, the LLM is never called at all; the canned "not found" answer is returned directly.
2. **System prompt constraint** (`PromptService`) — even when relevant chunks exist, the model is instructed to answer *only* from the provided context and to say so explicitly if the answer isn't actually in it.

---

## 5. Multi-Document Isolation — how Qdrant keeps documents from leaking into each other

All chunks from every document live in **one Qdrant collection** (`pdf_documents`). Isolation is enforced entirely through **payload filtering**, not separate collections/namespaces per document.

```mermaid
flowchart TB
    subgraph Collection["Qdrant collection: pdf_documents"]
        direction LR
        C1["chunk\ndocumentId: doc-A\ncategory: HR\ntext: '...vacation policy...'"]
        C2["chunk\ndocumentId: doc-B\ncategory: Finance\ntext: '...reimbursement...'"]
        C3["chunk\ndocumentId: doc-C\ncategory: Security\ntext: '...MFA required...'"]
        C4["chunk\ndocumentId: doc-A\ncategory: HR\ntext: '...HR portal...'"]
    end

    Idx1[["payload index: documentId (keyword)"]]
    Idx2[["payload index: category (keyword)"]]
    Collection --- Idx1
    Collection --- Idx2

    Q1["Question, scope = {}\n(no filter)"] -->|"searches ALL"| Collection
    Q2["Question, scope = {category: 'HR'}"] -->|"filter: category = HR"| C1 & C4
    Q3["Question, scope = {documentIds: [doc-B, doc-C]}"] -->|"filter: documentId IN [...]"| C2 & C3
```

```ts
// vector-store/qdrant.service.ts — filter construction (simplified)
const must = [];
if (scope.documentIds?.length) must.push({ key: 'documentId', match: { any: scope.documentIds } });
if (scope.category)            must.push({ key: 'category',   match: { value: scope.category } });
const filter = must.length ? { must } : undefined; // undefined = whole library
```

- **Default (Dashboard "All documents")** → empty scope → filter omitted → searches every processed document.
- **Category-scoped** ("Search: HR") → `category` filter only.
- **Specific file** → `documentId` filter (`match.any` with a single ID — same code path as multi-file scoping).
- Both filters can combine (AND) — e.g. "these 3 documentIds, but only if they're also tagged Finance."

This is what the HR/Finance/Security isolation test (`rag-pipeline.e2e-spec.ts`) verifies directly: uploading three category-tagged documents and asserting a category-scoped question never returns chunks from a different category, even when another document's content is topically closer.

---

## 6. Data Model (PostgreSQL via Prisma)

```mermaid
erDiagram
    Document {
        string id PK
        string filename
        int fileSize
        int pageCount
        int chunkCount
        enum status "QUEUED | PROCESSING | PROCESSED | FAILED"
        string category "nullable, HR/Engineering/Finance/Product/Security"
        string storagePath "original PDF bytes on disk"
        string errorMessage
        datetime createdAt
        datetime updatedAt
    }

    Conversation {
        string id PK
        string title "derived from first question"
        datetime createdAt
        datetime updatedAt
    }

    Message {
        string id PK
        string conversationId FK
        enum role "USER | ASSISTANT"
        string content
        string_array scopeDocumentIds
        string scopeCategory
        datetime createdAt
    }

    MessageSource {
        string id PK
        string messageId FK
        string documentId "plain string, NOT a foreign key"
        string filename
        int pageNumber
        int chunkIndex
        string snippetText "snapshotted chunk text"
    }

    Conversation ||--o{ Message : "has many"
    Message ||--o{ MessageSource : "cites (assistant only)"
    Document ||..o{ MessageSource : "referenced by id (no FK — survives deletion)"
```

**Why `MessageSource.documentId` is not a foreign key**: deleting a `Document` (from the dashboard) must not corrupt past conversation history. `filename`, `pageNumber`, and `snippetText` are snapshotted onto the citation at answer time, so a chat transcript stays fully readable — "here's what it said and why" — even after the source document is gone or re-processed.

The vector store (Qdrant) has no equivalent foreign-key relationship either: chunks are addressed purely by the `documentId` string in their payload, deleted via a payload-filtered `delete` call (`QdrantService.deleteDocument`), independent of the Postgres row's lifecycle.

---

## 7. Frontend Structure

```mermaid
flowchart TD
    App["App.tsx\n(BrowserRouter + Sidebar + Routes)"]
    Sidebar["layout/Sidebar.tsx\nnav + conversation list"]
    Dashboard["pages/DashboardPage.tsx"]
    ChatPage["pages/ChatPage.tsx"]

    App --> Sidebar
    App --> Dashboard
    App --> ChatPage

    Dashboard --> StatsBar["dashboard/StatsBar.tsx"]
    Dashboard --> UploadPanel["UploadPanel.tsx"]
    Dashboard --> DocumentTable["dashboard/DocumentTable.tsx"]

    ChatPage --> ChatPanel["ChatPanel.tsx"]
    ChatPanel --> ScopeSelector["chat/ScopeSelector.tsx"]
    ChatPanel --> MessageBubble["MessageBubble.tsx"]
    MessageBubble --> SourcesList["SourcesList.tsx"]

    subgraph DataLayer["Data layer"]
        Client["api/client.ts\n(axios instance + endpoint fns)"]
        Hooks["hooks/*.ts\n(react-query wrappers)"]
    end

    Hooks --> Client
    UploadPanel -.-> Hooks
    DocumentTable -.-> Hooks
    Sidebar -.-> Hooks
    ChatPanel -.-> Hooks
    Client -->|"HTTP /api/*"| Backend[("NestJS backend")]
```

- **Polling, not sockets**: `useDocuments()` uses react-query's `refetchInterval`, active only while any document is `queued`/`processing` — the dashboard's per-row status updates without a page reload, without needing WebSockets.
- **Conversation state lives server-side**: `ChatPanel` has no local message array; `useConversationMessages(conversationId)` fetches the full persisted history on mount/switch, and sending a message invalidates that query so the just-answered turn reloads from Postgres. Reloading the browser mid-conversation loses nothing.
- **Scope selector → API call**: `AskQuestionScope` (`{documentIds?, category?}`) flows from `ScopeSelector` state straight through `useChat()` → `askQuestion()` → the `/chat` POST body, matching the backend's `RetrievalScope` shape one-to-one.

---

## 8. Request Path Cheat Sheet

| Action | Route | Backend chain |
|---|---|---|
| Upload PDFs | `POST /api/documents/upload` | `PdfController` → `PdfService.createQueuedDocument` (sync) → `processDocumentAsync` (async, limiter-gated) |
| List documents (polling) | `GET /api/documents` | `PdfController` → `PdfService.listDocuments` → `PrismaDocumentsRepository` |
| Retry a failed upload | `POST /api/documents/:id/retry` | resets to `QUEUED`, re-enters the same async pipeline |
| Re-process | `POST /api/documents/:id/reprocess` | deletes existing Qdrant vectors for that id, re-reads stored bytes, re-runs pipeline |
| Delete a document | `DELETE /api/documents/:id` | deletes Qdrant vectors → Postgres row → stored file bytes |
| New conversation | `POST /api/conversations` | `ConversationsController` → `ConversationsService.create` |
| Ask a question | `POST /api/chat` | `ChatController` → `ChatService.ask` → `RagService.answerQuestion` → persists via `ConversationsService` |
| Load chat history | `GET /api/conversations/:id` | returns messages + nested `MessageSource[]`, ordered oldest→newest |
