import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { AppModule } from '../src/app.module';
import { OPENAI_CLIENT } from '../src/common/openai-client.provider';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

/**
 * End-to-end integration test for the full pipeline described in the
 * README's architecture diagram:
 *
 *   PDF upload -> parse -> chunk -> embed -> store in Qdrant
 *                                              |
 *   question -> embed -> retrieve -> (threshold) -> prompt -> LLM -> answer
 *
 * Everything in this test is real EXCEPT the OpenAI SDK client, which is
 * replaced with a deterministic fake so the test:
 *   - runs with no API key and no network access to OpenAI,
 *   - is fast and free to run repeatedly (e.g. in CI),
 *   - is reproducible (a real LLM's phrasing can vary between calls).
 *
 * The fake embedding function is a simple bag-of-words hash: it maps shared
 * non-stopword tokens between two texts to the same vector dimensions, so
 * cosine similarity still tracks real keyword/topic overlap closely enough
 * to exercise retrieval, the similarity threshold, and per-document
 * filtering exactly as the real EmbeddingsService + QdrantService would.
 *
 * It still talks to a REAL Qdrant instance (docker compose up -d qdrant)
 * using an isolated, uniquely-named collection that is dropped afterward.
 */

const VECTOR_SIZE = 1536;
const STOPWORDS = new Set(['the', 'a', 'an', 'is', 'are', 'this', 'of', 'for', 'and', 'to', 'used', 'what', 'does']);

function hashToken(token: string): number {
  const digest = createHash('md5').update(token).digest();
  return digest.readUInt32BE(0);
}

// Crude suffix stripping so "uses"/"used"/"use" hash to the same dimension —
// good enough for this fake, not a real stemmer.
function stem(token: string): string {
  return token.replace(/(ing|edly|ies|ied|es|ed|s)$/, (suffix) => (token.length - suffix.length >= 3 ? '' : suffix));
}

function fakeEmbed(text: string): number[] {
  const vector = new Array(VECTOR_SIZE).fill(0);
  const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => !STOPWORDS.has(t)).map(stem);
  for (const token of tokens) {
    vector[hashToken(token) % VECTOR_SIZE] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

const fakeOpenAiClient = {
  embeddings: {
    create: async ({ input }: { input: string[] }) => ({
      data: input.map((text, index) => ({ index, embedding: fakeEmbed(text) })),
    }),
  },
  chat: {
    completions: {
      create: async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
        // Mirrors what a real grounded LLM does: answer strictly from the
        // DOCUMENT CONTEXT block it was given, never from outside knowledge.
        const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
        const contextMatch = userMessage.match(/DOCUMENT CONTEXT:\n\n([\s\S]*?)\n\nUSER QUESTION:/);
        const context = contextMatch?.[1] ?? '';
        const pageMatch = context.match(/\[Page (\d+)\]/);
        return {
          choices: [
            {
              message: {
                content: `Based on the document: ${context.slice(0, 200).replace(/\s+/g, ' ')} (Page ${pageMatch?.[1] ?? '?'})`,
              },
            },
          ],
        };
      },
    },
  },
};

describe('RAG pipeline (integration)', () => {
  let app: INestApplication;
  const testCollection = `pdf_documents_test_${Date.now()}`;

  beforeAll(async () => {
    process.env.QDRANT_COLLECTION = testCollection;
    // The fake bag-of-words embedding below is far coarser than a real
    // embedding model, so it needs a lower similarity threshold to behave
    // equivalently — this does not change what's being tested (retrieval +
    // thresholding + per-document filtering), only how similar two texts
    // need to look under this specific fake.
    process.env.RAG_SIMILARITY_THRESHOLD = '0.15';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OPENAI_CLIENT)
      .useValue(fakeOpenAiClient)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    const client = new QdrantClient({ url: 'http://localhost:6333', checkCompatibility: false });
    await client.deleteCollection(testCollection).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to clean up test collection:', err);
    });
    await app.close();
  });

  async function uploadFixture(filename: string) {
    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .attach('file', join(__dirname, 'fixtures', filename));
    return res;
  }

  it('Test 1: answers a question whose answer exists in the PDF, grounded with a source', async () => {
    const upload = await uploadFixture('aws-architecture.pdf');
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('processed');
    expect(upload.body.chunkCount).toBeGreaterThan(0);

    const chat = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: upload.body.documentId, question: 'What database does this architecture use?' });

    expect(chat.status).toBe(201);
    expect(chat.body.answer.toLowerCase()).toContain('postgresql');
    expect(chat.body.sources.length).toBeGreaterThan(0);
    expect(chat.body.sources[0].documentId).toBe(upload.body.documentId);
  });

  it('Test 2: responds with "not found" when the question is not answered by the PDF', async () => {
    const upload = await uploadFixture('aws-architecture.pdf');

    const chat = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: upload.body.documentId, question: 'What programming language is the backend written in?' });

    expect(chat.status).toBe(201);
    expect(chat.body.answer).toBe("I couldn't find this information in the uploaded document.");
    expect(chat.body.sources).toEqual([]);
  });

  it('Test 3: responds with "not found" for a completely unrelated question', async () => {
    const upload = await uploadFixture('aws-architecture.pdf');

    const chat = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: upload.body.documentId, question: 'What is the recipe for chocolate cake?' });

    expect(chat.status).toBe(201);
    expect(chat.body.answer).toBe("I couldn't find this information in the uploaded document.");
    expect(chat.body.sources).toEqual([]);
  });

  it('Test 4: a question against one document never retrieves chunks from a different document', async () => {
    const docA = await uploadFixture('aws-architecture.pdf');
    const docB = await uploadFixture('payments-service.pdf');
    expect(docA.body.documentId).not.toBe(docB.body.documentId);

    // docB's content (MongoDB) should be found when asking docB...
    const chatB = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: docB.body.documentId, question: 'What database does the payments service use?' });
    expect(chatB.body.answer.toLowerCase()).toContain('mongodb');
    for (const source of chatB.body.sources) {
      expect(source.documentId).toBe(docB.body.documentId);
    }

    // ...but every source returned for docA must belong to docA, never docB,
    // even when asked the same question.
    const chatA = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: docA.body.documentId, question: 'What database does the payments service use?' });
    for (const source of chatA.body.sources) {
      expect(source.documentId).toBe(docA.body.documentId);
    }
  });

  it('rejects a chat request for a document that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/chat')
      .send({ documentId: '00000000-0000-0000-0000-000000000000', question: 'test' });
    expect(res.status).toBe(404);
  });

  it('rejects an upload that is not a PDF', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/documents/upload')
      .attach('file', join(__dirname, 'fixtures', 'corrupted.pdf'));
    // Corrupted-but-.pdf-named file passes MIME/extension checks and fails at parse time.
    expect(res.status).toBe(422);
  });

  it('deleting a document removes its vectors so it can no longer be queried', async () => {
    const upload = await uploadFixture('payments-service.pdf');
    await request(app.getHttpServer()).delete(`/api/documents/${upload.body.documentId}`).expect(204);

    const getRes = await request(app.getHttpServer()).get(`/api/documents/${upload.body.documentId}`);
    expect(getRes.status).toBe(404);
  });
});
