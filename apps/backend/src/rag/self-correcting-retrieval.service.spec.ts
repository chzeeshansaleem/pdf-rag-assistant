import { SelfCorrectingRetrievalService } from './self-correcting-retrieval.service';
import type { RetrievedChunk } from './interfaces/retrieved-chunk.interface';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'rag.maxRetries': 2, ...overrides };
  return { get: (key: string) => values[key] } as any;
}

const chunksA: RetrievedChunk[] = [
  { documentId: 'doc-1', text: 'chunk A', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, score: 0.6 },
];
const chunksB: RetrievedChunk[] = [
  { documentId: 'doc-1', text: 'chunk B', filename: 'a.pdf', pageNumber: 2, chunkIndex: 1, score: 0.7 },
];
const chunksC: RetrievedChunk[] = [
  { documentId: 'doc-1', text: 'chunk C', filename: 'a.pdf', pageNumber: 3, chunkIndex: 2, score: 0.65 },
];

describe('SelfCorrectingRetrievalService', () => {
  it('returns after a single attempt when the evaluator judges the first retrieval sufficient', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(chunksA) } as any;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({ sufficient: true, reason: 'covers it' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result).toEqual({ chunks: chunksA, sufficient: true, reason: 'covers it', finalQuery: 'initial query', attempts: 1 });
    expect(retrieverService.retrieve).toHaveBeenCalledTimes(1);
    expect(retrieverService.retrieve).toHaveBeenCalledWith({ documentIds: ['doc-1'] }, 'initial query');
  });

  it('retries with the refined query when the first attempt is judged insufficient, then succeeds', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValueOnce(chunksA).mockResolvedValueOnce(chunksB) } as any;
    const contextEvaluatorService = {
      evaluate: jest
        .fn()
        .mockResolvedValueOnce({ sufficient: false, reason: 'missing detail', refinedQuery: 'refined query' })
        .mockResolvedValueOnce({ sufficient: true, reason: 'now covers it' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result).toEqual({ chunks: chunksB, sufficient: true, reason: 'now covers it', finalQuery: 'refined query', attempts: 2 });
    expect(retrieverService.retrieve).toHaveBeenNthCalledWith(1, { documentIds: ['doc-1'] }, 'initial query');
    expect(retrieverService.retrieve).toHaveBeenNthCalledWith(2, { documentIds: ['doc-1'] }, 'refined query');
  });

  it('stops after maxRetries+1 attempts and reports insufficient when the evaluator never approves and each retry finds different chunks', async () => {
    // Each attempt retrieves a genuinely DIFFERENT chunk, so the
    // identical-chunk-set early stop never triggers and the loop must run
    // all the way to maxAttempts before giving up.
    const chunkVariants = [chunksA, chunksB, chunksC];
    const retrieverService = { retrieve: jest.fn().mockImplementation(() => Promise.resolve(chunkVariants.shift())) } as any;
    let call = 0;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockImplementation(() => {
        call++;
        return Promise.resolve({ sufficient: false, reason: 'still missing', refinedQuery: `refined query ${call}` });
      }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub({ 'rag.maxRetries': 2 }));

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.sufficient).toBe(false);
    expect(result.attempts).toBe(3); // initial attempt + 2 retries
    expect(retrieverService.retrieve).toHaveBeenCalledTimes(3);
  });

  it('stops early and falls through with sufficient=true when a refined query retrieves the identical chunk set as the previous attempt', async () => {
    // Same single chunk every time — nothing new for the query refinement
    // to find, e.g. a small/single-chunk document being asked a vague
    // conversational follow-up.
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(chunksA) } as any;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({ sufficient: false, reason: 'still missing', refinedQuery: 'a more specific query' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.sufficient).toBe(true);
    expect(result.chunks).toEqual(chunksA);
    expect(result.attempts).toBe(2);
    // Only evaluated once — the second attempt short-circuits before
    // calling the evaluator again, since it already knows nothing changed.
    expect(contextEvaluatorService.evaluate).toHaveBeenCalledTimes(1);
    expect(retrieverService.retrieve).toHaveBeenCalledTimes(2);
  });

  it('stops early when the evaluator gives no refinedQuery', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue([]) } as any;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({ sufficient: false, reason: 'no chunks' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.attempts).toBe(1);
    expect(retrieverService.retrieve).toHaveBeenCalledTimes(1);
  });

  it('stops early when the refinedQuery is the same as the query just tried (case-insensitive)', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(chunksA) } as any;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({ sufficient: false, reason: 'still missing', refinedQuery: 'Initial Query' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.attempts).toBe(1);
    expect(retrieverService.retrieve).toHaveBeenCalledTimes(1);
  });

  it('reports insufficient when the final attempt still has zero chunks even though the evaluator said sufficient', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue([]) } as any;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockResolvedValue({ sufficient: true, reason: 'no chunks but marked sufficient' }),
    } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, makeConfigStub());

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.sufficient).toBe(false);
    expect(result.chunks).toEqual([]);
  });

  it('falls back to the default max retries when config returns undefined', async () => {
    const chunkVariants = [chunksA, chunksB, chunksC];
    const retrieverService = { retrieve: jest.fn().mockImplementation(() => Promise.resolve(chunkVariants.shift())) } as any;
    let call = 0;
    const contextEvaluatorService = {
      evaluate: jest.fn().mockImplementation(() => {
        call++;
        return Promise.resolve({ sufficient: false, reason: 'x', refinedQuery: `refined query ${call}` });
      }),
    } as any;
    const configStub = { get: () => undefined } as any;
    const service = new SelfCorrectingRetrievalService(retrieverService, contextEvaluatorService, configStub);

    const result = await service.retrieveWithSelfCorrection({ documentIds: ['doc-1'] }, 'initial query');

    expect(result.attempts).toBe(3); // default DEFAULT_MAX_RETRIES = 2 -> 3 attempts total
  });
});
