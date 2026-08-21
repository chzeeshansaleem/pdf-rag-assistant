import { RagService } from './rag.service';
import { PromptService, NOT_FOUND_ANSWER } from './prompt.service';
import { LlmServiceException } from '../common/exceptions/app.exceptions';
import type { RetrievedChunk } from './interfaces/retrieved-chunk.interface';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'openai.chatModel': 'gpt-4o-mini', ...overrides };
  return { get: (key: string) => values[key] } as any;
}

const sampleChunks: RetrievedChunk[] = [
  { documentId: 'doc-1', text: 'PostgreSQL is used as the primary database.', filename: 'a.pdf', pageNumber: 5, chunkIndex: 12, score: 0.8 },
];

describe('RagService', () => {
  it('returns the "not found" answer without calling the LLM when no chunks are retrieved', async () => {
    const retrieverService = { retrieve: jest.fn().mockResolvedValue([]) } as any;
    const promptService = new PromptService();
    const create = jest.fn();
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion({ documentIds: ['doc-1'] }, 'unrelated question');

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
    const result = await rag.answerQuestion({ documentIds: ['doc-1'] }, 'What database is used?');

    expect(result.answer).toBe('The architecture uses PostgreSQL (Page 5).');
    expect(result.sources).toEqual([
      {
        documentId: 'doc-1',
        filename: 'a.pdf',
        pageNumber: 5,
        chunkIndex: 12,
        snippetText: 'PostgreSQL is used as the primary database.',
      },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', temperature: 0 }),
    );
  });

  it('deduplicates sources that come from the same document and page', async () => {
    const chunksFromSamePage: RetrievedChunk[] = [
      { documentId: 'doc-1', text: 'chunk A', filename: 'a.pdf', pageNumber: 5, chunkIndex: 1, score: 0.9 },
      { documentId: 'doc-1', text: 'chunk B', filename: 'a.pdf', pageNumber: 5, chunkIndex: 2, score: 0.85 },
    ];
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(chunksFromSamePage) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'answer' } }] });
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion({ documentIds: ['doc-1'] }, 'question');

    expect(result.sources).toHaveLength(1);
  });

  it('does not deduplicate the same page number across two different documents', async () => {
    const sharedPageDifferentDocs: RetrievedChunk[] = [
      { documentId: 'doc-1', text: 'chunk A', filename: 'a.pdf', pageNumber: 3, chunkIndex: 1, score: 0.9 },
      { documentId: 'doc-2', text: 'chunk B', filename: 'b.pdf', pageNumber: 3, chunkIndex: 4, score: 0.85 },
    ];
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(sharedPageDifferentDocs) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'answer' } }] });
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const result = await rag.answerQuestion({}, 'question');

    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((s) => s.documentId).sort()).toEqual(['doc-1', 'doc-2']);
  });

  it('throws LlmServiceException when the OpenAI call ultimately fails', async () => {
    jest.useFakeTimers();
    const retrieverService = { retrieve: jest.fn().mockResolvedValue(sampleChunks) } as any;
    const promptService = new PromptService();
    const create = jest.fn().mockRejectedValue(new Error('service unavailable'));
    const fakeClient = { chat: { completions: { create } } } as any;

    const rag = new RagService(retrieverService, promptService, makeConfigStub(), fakeClient);
    const promise = expect(rag.answerQuestion({ documentIds: ['doc-1'] }, 'question')).rejects.toBeInstanceOf(LlmServiceException);
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
    await expect(rag.answerQuestion({ documentIds: ['doc-1'] }, 'question')).rejects.toBeInstanceOf(LlmServiceException);
  });
});
