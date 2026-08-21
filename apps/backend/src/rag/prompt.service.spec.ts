import { PromptService, NOT_FOUND_ANSWER } from './prompt.service';
import type { RetrievedChunk } from './interfaces/retrieved-chunk.interface';

describe('PromptService', () => {
  const service = new PromptService();

  const chunks: RetrievedChunk[] = [
    { documentId: 'doc-1', text: 'PostgreSQL is used as the primary database.', filename: 'a.pdf', pageNumber: 5, chunkIndex: 12, score: 0.8 },
    { documentId: 'doc-1', text: 'Redis is used for caching.', filename: 'a.pdf', pageNumber: 6, chunkIndex: 13, score: 0.7 },
  ];

  it('labels each chunk in the context with its filename and page number', () => {
    const context = service.buildContext(chunks);
    expect(context).toContain('[a.pdf, Page 5]');
    expect(context).toContain('[a.pdf, Page 6]');
    expect(context).toContain('PostgreSQL is used as the primary database.');
    expect(context).toContain('Redis is used for caching.');
  });

  it('distinguishes chunks from different documents that share a page number', () => {
    const multiDocChunks: RetrievedChunk[] = [
      { documentId: 'doc-1', text: 'from doc A', filename: 'a.pdf', pageNumber: 3, chunkIndex: 0, score: 0.9 },
      { documentId: 'doc-2', text: 'from doc B', filename: 'b.pdf', pageNumber: 3, chunkIndex: 0, score: 0.9 },
    ];
    const context = service.buildContext(multiDocChunks);
    expect(context).toContain('[a.pdf, Page 3]');
    expect(context).toContain('[b.pdf, Page 3]');
  });

  it('builds a system + user message pair for the chat completion request', () => {
    const messages = service.buildMessages(chunks, 'What database is used?');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(String(messages[1].content)).toContain('What database is used?');
    expect(String(messages[1].content)).toContain('DOCUMENT CONTEXT');
  });

  it('system prompt instructs the model to ground answers only in provided context', () => {
    const messages = service.buildMessages(chunks, 'question');
    const systemContent = String(messages[0].content);

    expect(systemContent).toMatch(/only the provided document context/i);
    expect(systemContent).toContain(NOT_FOUND_ANSWER);
  });
});
