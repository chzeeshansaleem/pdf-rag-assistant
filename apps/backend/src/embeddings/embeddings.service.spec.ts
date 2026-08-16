import { EmbeddingsService } from './embeddings.service';
import { EmbeddingServiceException } from '../common/exceptions/app.exceptions';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'openai.embeddingModel': 'text-embedding-3-small', ...overrides };
  return { get: (key: string) => values[key] } as any;
}

describe('EmbeddingsService', () => {
  it('generateEmbedding returns a single vector for one string', async () => {
    const create = jest.fn().mockResolvedValue({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
    });
    const fakeClient = { embeddings: { create } } as any;

    const service = new EmbeddingsService(fakeClient, makeConfigStub());
    const vector = await service.generateEmbedding('hello world');

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ input: ['hello world'] }));
  });

  it('batches large input arrays instead of sending one request per chunk', async () => {
    const create = jest.fn().mockImplementation(async ({ input }: { input: string[] }) => ({
      data: input.map((_, i) => ({ index: i, embedding: [i] })),
    }));
    const fakeClient = { embeddings: { create } } as any;

    const service = new EmbeddingsService(fakeClient, makeConfigStub());
    const texts = Array.from({ length: 250 }, (_, i) => `chunk ${i}`);
    const vectors = await service.generateEmbeddings(texts);

    expect(vectors).toHaveLength(250);
    // 250 inputs at a max batch size of 100 => 3 requests, not 250.
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('preserves input order even if the API returns results out of order', async () => {
    const create = jest.fn().mockResolvedValue({
      data: [
        { index: 1, embedding: [1] },
        { index: 0, embedding: [0] },
      ],
    });
    const fakeClient = { embeddings: { create } } as any;

    const service = new EmbeddingsService(fakeClient, makeConfigStub());
    const vectors = await service.generateEmbeddings(['first', 'second']);

    expect(vectors).toEqual([[0], [1]]);
  });

  it('rejects empty text before calling the API', async () => {
    const create = jest.fn();
    const fakeClient = { embeddings: { create } } as any;
    const service = new EmbeddingsService(fakeClient, makeConfigStub());

    await expect(service.generateEmbeddings(['valid', '   '])).rejects.toBeInstanceOf(EmbeddingServiceException);
    expect(create).not.toHaveBeenCalled();
  });

  it('retries on a transient (retryable) failure and eventually succeeds', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [9] }] });
    const fakeClient = { embeddings: { create } } as any;

    const service = new EmbeddingsService(fakeClient, makeConfigStub());
    const vector = await service.generateEmbedding('retry me');

    expect(vector).toEqual([9]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws EmbeddingServiceException after exhausting retries', async () => {
    jest.useFakeTimers();
    const create = jest.fn().mockRejectedValue(new Error('network down'));
    const fakeClient = { embeddings: { create } } as any;
    const service = new EmbeddingsService(fakeClient, makeConfigStub());

    const promise = expect(service.generateEmbedding('will fail')).rejects.toBeInstanceOf(EmbeddingServiceException);
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();
  }, 10000);

  it('returns an empty array for an empty input array without calling the API', async () => {
    const create = jest.fn();
    const fakeClient = { embeddings: { create } } as any;
    const service = new EmbeddingsService(fakeClient, makeConfigStub());

    const result = await service.generateEmbeddings([]);
    expect(result).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
