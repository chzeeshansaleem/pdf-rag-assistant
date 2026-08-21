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

    expect(systemContent).toMatch(/only.{0,15}(the )?retrieved document context/i);
    expect(systemContent).toMatch(/never use outside knowledge/i);
    expect(systemContent).toContain(NOT_FOUND_ANSWER);
  });

  it('system prompt instructs the model not to treat conversation history as a source of facts', () => {
    const messages = service.buildMessages(chunks, 'question');
    const systemContent = String(messages[0].content);

    expect(systemContent).toMatch(/(never|not)\s.{0,20}(a )?source of (facts|truth)/i);
    expect(systemContent).toMatch(/do not treat.{0,40}previous assistant answer.{0,20}authoritative/i);
  });

  it('includes a conversation-history block when memory is provided', () => {
    const memory = {
      summary: 'The user previously discussed Security.pdf and learned about MFA.',
      recentMessages: [
        { role: 'user' as const, content: 'What security controls are listed?' },
        { role: 'assistant' as const, content: 'MFA, encryption, and access control.' },
      ],
    };
    const messages = service.buildMessages(chunks, 'Explain the second one.', memory);
    const userContent = String(messages[1].content);

    expect(userContent).toContain('CONVERSATION HISTORY');
    expect(userContent).toContain('Security.pdf and learned about MFA');
    expect(userContent).toContain('User: What security controls are listed?');
    expect(userContent).toContain('Assistant: MFA, encryption, and access control.');
    // History must appear before DOCUMENT CONTEXT so retrieval stays the final say.
    expect(userContent.indexOf('CONVERSATION HISTORY')).toBeLessThan(userContent.indexOf('DOCUMENT CONTEXT'));
  });

  it('omits the conversation-history block entirely when there is no memory', () => {
    const messages = service.buildMessages(chunks, 'question');
    expect(String(messages[1].content)).not.toContain('CONVERSATION HISTORY');
  });

  it('omits the conversation-history block when memory has neither a summary nor recent messages', () => {
    const messages = service.buildMessages(chunks, 'question', { summary: null, recentMessages: [] });
    expect(String(messages[1].content)).not.toContain('CONVERSATION HISTORY');
  });
});
