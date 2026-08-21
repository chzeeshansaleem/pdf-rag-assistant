import { RetrieverService } from './retriever.service';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'rag.topK': 5, 'rag.similarityThreshold': 0.35, ...overrides };
  return { get: (key: string) => values[key] } as any;
}

describe('RetrieverService', () => {
  it('embeds the question and searches Qdrant scoped to the given documentIds', async () => {
    const embeddingsService = { generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2]) } as any;
    const qdrantService = { searchSimilarChunks: jest.fn().mockResolvedValue([]) } as any;

    const retriever = new RetrieverService(embeddingsService, qdrantService, makeConfigStub());
    await retriever.retrieve({ documentIds: ['doc-1'] }, 'What database is used?');

    expect(embeddingsService.generateEmbedding).toHaveBeenCalledWith('What database is used?');
    expect(qdrantService.searchSimilarChunks).toHaveBeenCalledWith([0.1, 0.2], { documentIds: ['doc-1'] }, 5, 0.35);
  });

  it('maps Qdrant results into RetrievedChunk objects', async () => {
    const embeddingsService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) } as any;
    const qdrantService = {
      searchSimilarChunks: jest.fn().mockResolvedValue([
        { score: 0.9, payload: { text: 'PostgreSQL is used', filename: 'a.pdf', pageNumber: 3, chunkIndex: 7, documentId: 'doc-1', createdAt: '' } },
      ]),
    } as any;

    const retriever = new RetrieverService(embeddingsService, qdrantService, makeConfigStub());
    const results = await retriever.retrieve({ documentIds: ['doc-1'] }, 'question');

    expect(results).toEqual([
      { documentId: 'doc-1', text: 'PostgreSQL is used', filename: 'a.pdf', pageNumber: 3, chunkIndex: 7, score: 0.9 },
    ]);
  });

  it('discards results below the similarity threshold (hallucination protection)', async () => {
    const embeddingsService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) } as any;
    const qdrantService = {
      searchSimilarChunks: jest.fn().mockResolvedValue([
        { score: 0.1, payload: { text: 'weakly related', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, documentId: 'doc-1', createdAt: '' } },
      ]),
    } as any;

    const retriever = new RetrieverService(embeddingsService, qdrantService, makeConfigStub({ 'rag.similarityThreshold': 0.35 }));
    const results = await retriever.retrieve({ documentIds: ['doc-1'] }, 'unrelated question');

    expect(results).toEqual([]);
  });

  it('uses the configured topK and similarityThreshold', async () => {
    const embeddingsService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) } as any;
    const qdrantService = { searchSimilarChunks: jest.fn().mockResolvedValue([]) } as any;

    const retriever = new RetrieverService(
      embeddingsService,
      qdrantService,
      makeConfigStub({ 'rag.topK': 10, 'rag.similarityThreshold': 0.5 }),
    );
    await retriever.retrieve({ documentIds: ['doc-1'] }, 'question');

    expect(qdrantService.searchSimilarChunks).toHaveBeenCalledWith([0.1], { documentIds: ['doc-1'] }, 10, 0.5);
  });

  it('passes an empty scope through unchanged to search the whole library', async () => {
    const embeddingsService = { generateEmbedding: jest.fn().mockResolvedValue([0.1]) } as any;
    const qdrantService = { searchSimilarChunks: jest.fn().mockResolvedValue([]) } as any;

    const retriever = new RetrieverService(embeddingsService, qdrantService, makeConfigStub());
    await retriever.retrieve({}, 'question');

    expect(qdrantService.searchSimilarChunks).toHaveBeenCalledWith([0.1], {}, 5, 0.35);
  });
});
