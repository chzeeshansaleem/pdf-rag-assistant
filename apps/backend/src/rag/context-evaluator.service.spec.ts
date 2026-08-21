import { ContextEvaluatorService } from './context-evaluator.service';
import { PromptService } from './prompt.service';
import type { RetrievedChunk } from './interfaces/retrieved-chunk.interface';

function makeConfigStub(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { 'openai.chatModel': 'gpt-4o-mini', ...overrides };
  return { get: (key: string) => values[key] } as any;
}

const sampleChunks: RetrievedChunk[] = [
  { documentId: 'doc-1', text: 'Employees accrue 1.5 days of leave per month.', filename: 'hr.pdf', pageNumber: 2, chunkIndex: 3, score: 0.8 },
];

function makeService(create: jest.Mock) {
  const promptService = new PromptService();
  const fakeClient = { chat: { completions: { create } } } as any;
  return new ContextEvaluatorService(promptService, makeConfigStub(), fakeClient);
}

describe('ContextEvaluatorService', () => {
  it('returns insufficient without calling the LLM when no chunks were retrieved', async () => {
    const create = jest.fn();
    const service = makeService(create);

    const result = await service.evaluate('What is the leave policy?', []);

    expect(result).toEqual({ sufficient: false, reason: 'No chunks were retrieved.', refinedQuery: 'What is the leave policy?' });
    expect(create).not.toHaveBeenCalled();
  });

  it('parses a sufficient=true JSON response', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"sufficient": true, "reason": "covers the question fully"}' } }],
    });
    const service = makeService(create);

    const result = await service.evaluate('How much leave do employees accrue?', sampleChunks);

    expect(result).toEqual({ sufficient: true, reason: 'covers the question fully', refinedQuery: undefined });
  });

  it('parses a sufficient=false JSON response with a refinedQuery', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: '{"sufficient": false, "reason": "carry-forward not covered", "refinedQuery": "leave carry-forward / unused leave rollover policy"}',
        },
      }],
    });
    const service = makeService(create);

    const result = await service.evaluate('Can leave be carried over?', sampleChunks);

    expect(result).toEqual({
      sufficient: false,
      reason: 'carry-forward not covered',
      refinedQuery: 'leave carry-forward / unused leave rollover policy',
    });
  });

  it('strips a markdown code fence around the JSON response', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '```json\n{"sufficient": true, "reason": "ok"}\n```' } }],
    });
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result).toEqual({ sufficient: true, reason: 'ok', refinedQuery: undefined });
  });

  it('fails open to sufficient=true when the response is not valid JSON', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'sure, that looks fine' } }],
    });
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result.sufficient).toBe(true);
    expect(result.reason).toMatch(/not valid JSON/);
  });

  it('fails open to sufficient=true when the JSON is missing the "sufficient" field', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"reason": "no sufficient field here"}' } }],
    });
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result.sufficient).toBe(true);
  });

  it('fails open to sufficient=true when the LLM response has no content', async () => {
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result.sufficient).toBe(true);
    expect(result.reason).toMatch(/no response/);
  });

  it('fails open to sufficient=true when the OpenAI call throws', async () => {
    const create = jest.fn().mockRejectedValue(new Error('network error'));
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result.sufficient).toBe(true);
    expect(result.reason).toMatch(/call failed/);
  });

  it('ignores a non-string refinedQuery and an empty-string refinedQuery', async () => {
    const create = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '{"sufficient": false, "reason": "x", "refinedQuery": "   "}' } }],
    });
    const service = makeService(create);

    const result = await service.evaluate('question', sampleChunks);

    expect(result.refinedQuery).toBeUndefined();
  });
});
