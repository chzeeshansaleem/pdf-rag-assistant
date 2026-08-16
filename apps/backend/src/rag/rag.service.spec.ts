import { RagService } from './rag.service';
import { PromptService, NOT_FOUND_ANSWER } from './prompt.service';
import { LlmServiceException } from '../common/exceptions/app.exceptions';
import type { RetrievedChunk } from './retriever.service';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'openai.chatModel': 'gpt-4o-mini', ...overrides };
  return { get: (key: string) => values[key] } as any;
}

const sampleChunks: RetrievedChunk[] = [
  { text: 'PostgreSQL is used as the primary database.', filename: 'a.pdf', pageNumber: 5, chunkIndex: 12, score: 0.8 },
];

describe('RagService', () => {
  it('returns the "not found" answer without calling the LLM when no chunks are retrieved', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue([]) } as any;
    const promptService = new PromptService();
    const create = jest.fn();
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion('doc-1', 'unrelated question');

    expect(result.answer).toBe(NOT_FOUND_ANSWER);
    expect(result.sources).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('calls the LLM with the constructed prompt and returns a grounded answer with sources', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(sampleChunks) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'The architecture uses PostgreSQL (Page 5).' } }],
    });
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion('doc-1', 'What database is used?');

    expect(result.answer).toBe('The architecture uses PostgreSQL (Page 5).');
    expect(result.sources).toEqual([{ documentId: 'doc-1', filename: 'a.pdf', pageNumber: 5, chunkIndex: 12 }]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', temperature: 0 }),
    );
  });

  it('deduplicates sources that come from the same page', async () => {
    const chunksFromSamePage: RetrievedChunk[] = [
      { text: 'chunk A', filename: 'a.pdf', pageNumber: 5, chunkIndex: 1, score: 0.9 },
      { text: 'chunk B', filename: 'a.pdf', pageNumber: 5, chunkIndex: 2, score: 0.85 },
    ];
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(chunksFromSamePage) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'answer' } }] });
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion('doc-1', 'question');

    expect(result.sources).toHaveLength(1);
  });

  it('throws LlmServiceException when the OpenAI call ultimately fails', async () => {
    jest.useFakeTimers();
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(sampleChunks) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockRejectedValue(new Error('service unavailable'));
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const promise = expect(rag.answerQuestion('doc-1', 'question')).rejects.toBeInstanceOf(LlmServiceException);
    await jest.runAllTimersAsync();
    await promise;
    jest.useRealTimers();
  }, 10000);

  it('throws LlmServiceException when the OpenAI response has no content', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(sampleChunks) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    await expect(rag.answerQuestion('doc-1', 'question')).rejects.toBeInstanceOf(LlmServiceException);
  });
});
