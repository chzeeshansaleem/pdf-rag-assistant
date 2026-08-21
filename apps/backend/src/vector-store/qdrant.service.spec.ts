import { QdrantService } from './qdrant.service';
import { VectorStoreException } from '../common/exceptions/app.exceptions';

jest.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: jest.fn().mockImplementation(() => mockClientInstance),
  };
});

// A single shared mock instance so the service (constructed inside each
// test) and the assertions below refer to the same mocked methods.
const mockClientInstance = {
  getCollections: jest.fn(),
  createCollection: jest.fn(),
  createPayloadIndex: jest.fn(),
  upsert: jest.fn(),
  query: jest.fn(),
  delete: jest.fn(),
};

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'qdrant.url': 'http://localhost:6333',
    'qdrant.collection': 'pdf_documents',
    'openai.embeddingModel': 'text-embedding-3-small',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as any;
}

describe('QdrantService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCollection', () => {
    it('creates the collection and documentId/category payload indexes when it does not exist', async () => {
      mockClientInstance.getCollections.mockResolvedValue({ collections: [] });
      const service = new QdrantService(makeConfigStub());

      await service.createCollection();

      expect(mockClientInstance.createCollection).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ vectors: { size: 1536, distance: 'Cosine' } }),
      );
      expect(mockClientInstance.createPayloadIndex).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ field_name: 'documentId' }),
      );
      expect(mockClientInstance.createPayloadIndex).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ field_name: 'category' }),
      );
    });

    it('does not recreate the collection if it already exists, but still ensures payload indexes', async () => {
      mockClientInstance.getCollections.mockResolvedValue({ collections: [{ name: 'pdf_documents' }] });
      const service = new QdrantService(makeConfigStub());

      await service.createCollection();

      expect(mockClientInstance.createCollection).not.toHaveBeenCalled();
      expect(mockClientInstance.createPayloadIndex).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ field_name: 'documentId' }),
      );
      expect(mockClientInstance.createPayloadIndex).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ field_name: 'category' }),
      );
    });
  });

  describe('upsertChunks', () => {
    it('upserts points with vector and payload', async () => {
      mockClientInstance.upsert.mockResolvedValue({});
      const service = new QdrantService(makeConfigStub());

      await service.upsertChunks([
        {
          id: 'p1',
          vector: [0.1, 0.2],
          payload: {
            documentId: 'doc-1',
            filename: 'a.pdf',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'hello',
            createdAt: new Date().toISOString(),
          },
        },
      ]);

      expect(mockClientInstance.upsert).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ points: expect.arrayContaining([expect.objectContaining({ id: 'p1' })]) }),
      );
    });

    it('no-ops for an empty chunk array', async () => {
      const service = new QdrantService(makeConfigStub());
      await service.upsertChunks([]);
      expect(mockClientInstance.upsert).not.toHaveBeenCalled();
    });

    it('wraps upsert failures in VectorStoreException', async () => {
      mockClientInstance.upsert.mockRejectedValue(new Error('connection refused'));
      const service = new QdrantService(makeConfigStub());

      await expect(
        service.upsertChunks([
          {
            id: 'p1',
            vector: [0.1],
            payload: { documentId: 'd', filename: 'f', pageNumber: 1, chunkIndex: 0, text: 't', createdAt: '' },
          },
        ]),
      ).rejects.toBeInstanceOf(VectorStoreException);
    });
  });

  describe('searchSimilarChunks', () => {
    it('scopes the search to given documentIds via a filter', async () => {
      mockClientInstance.query.mockResolvedValue({ points: [] });
      const service = new QdrantService(makeConfigStub());

      await service.searchSimilarChunks([0.1, 0.2], { documentIds: ['doc-123'] }, 5, 0.35);

      expect(mockClientInstance.query).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({
          filter: { must: [{ key: 'documentId', match: { any: ['doc-123'] } }] },
          limit: 5,
          score_threshold: 0.35,
        }),
      );
    });

    it('scopes the search to a category via a filter', async () => {
      mockClientInstance.query.mockResolvedValue({ points: [] });
      const service = new QdrantService(makeConfigStub());

      await service.searchSimilarChunks([0.1], { category: 'HR' }, 5);

      expect(mockClientInstance.query).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({
          filter: { must: [{ key: 'category', match: { value: 'HR' } }] },
        }),
      );
    });

    it('combines documentIds and category filters with AND semantics', async () => {
      mockClientInstance.query.mockResolvedValue({ points: [] });
      const service = new QdrantService(makeConfigStub());

      await service.searchSimilarChunks([0.1], { documentIds: ['a', 'b'], category: 'Finance' }, 5);

      expect(mockClientInstance.query).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({
          filter: {
            must: [
              { key: 'documentId', match: { any: ['a', 'b'] } },
              { key: 'category', match: { value: 'Finance' } },
            ],
          },
        }),
      );
    });

    it('omits the filter entirely (searches all documents) when scope is empty', async () => {
      mockClientInstance.query.mockResolvedValue({ points: [] });
      const service = new QdrantService(makeConfigStub());

      await service.searchSimilarChunks([0.1], {}, 5);

      expect(mockClientInstance.query).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ filter: undefined }),
      );
    });

    it('maps Qdrant results to SearchResult objects', async () => {
      mockClientInstance.query.mockResolvedValue({
        points: [{ score: 0.9, payload: { documentId: 'd', filename: 'f.pdf', pageNumber: 2, chunkIndex: 3, text: 'x', createdAt: '' } }],
      });
      const service = new QdrantService(makeConfigStub());

      const results = await service.searchSimilarChunks([0.1], { documentIds: ['d'] }, 5);
      expect(results).toEqual([
        { score: 0.9, payload: { documentId: 'd', filename: 'f.pdf', pageNumber: 2, chunkIndex: 3, text: 'x', createdAt: '' } },
      ]);
    });

    it('wraps search failures in VectorStoreException', async () => {
      mockClientInstance.query.mockRejectedValue(new Error('timeout'));
      const service = new QdrantService(makeConfigStub());
      await expect(service.searchSimilarChunks([0.1], { documentIds: ['d'] }, 5)).rejects.toBeInstanceOf(VectorStoreException);
    });
  });

  describe('deleteDocument', () => {
    it('deletes all points matching the documentId filter', async () => {
      mockClientInstance.delete.mockResolvedValue({});
      const service = new QdrantService(makeConfigStub());

      await service.deleteDocument('doc-1');

      expect(mockClientInstance.delete).toHaveBeenCalledWith(
        'pdf_documents',
        expect.objectContaining({ filter: { must: [{ key: 'documentId', match: { value: 'doc-1' } }] } }),
      );
    });
  });
});
