import { QueryRewriterService } from './query-rewriter.service';
import type { ConversationMemory } from '../conversations/interfaces/conversation-memory.interface';

function makeConfigStub() {
  return { get: () => 'gpt-4o-mini' } as any;
}

function makeOpenAiStub(content: string | null = 'rewritten query') {
  return {
    chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } },
  } as any;
}

const emptyMemory: ConversationMemory = { summary: null, recentMessages: [] };

describe('QueryRewriterService', () => {
  it('skips the LLM call entirely when there is no history to resolve against', async () => {
    const client = makeOpenAiStub();
    const service = new QueryRewriterService(makeConfigStub(), client);

    const result = await service.rewrite('What is the password policy?', emptyMemory);

    expect(result).toBe('What is the password policy?');
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it('calls the LLM with the conversation summary and recent messages when memory is present', async () => {
    const client = makeOpenAiStub('Explain the access control security control mentioned in Security.pdf.');
    const service = new QueryRewriterService(makeConfigStub(), client);
    const memory: ConversationMemory = {
      summary: null,
      recentMessages: [
        { role: 'user', content: 'What security controls are mentioned in Security.pdf?' },
        { role: 'assistant', content: 'The document mentions MFA, access control, and encryption.' },
      ],
    };

    const result = await service.rewrite('Explain the second one.', memory);

    expect(result).toBe('Explain the access control security control mentioned in Security.pdf.');
    const call = client.chat.completions.create.mock.calls[0][0];
    expect(call.messages[0].role).toBe('system');
    const userContent = call.messages[1].content as string;
    expect(userContent).toContain('What security controls are mentioned in Security.pdf?');
    expect(userContent).toContain('MFA, access control, and encryption');
    expect(userContent).toContain('Explain the second one.');
  });

  it('includes the rolling summary in the prompt when present', async () => {
    const client = makeOpenAiStub('rewritten');
    const service = new QueryRewriterService(makeConfigStub(), client);
    const memory: ConversationMemory = {
      summary: 'The user discussed Finance.pdf and learned approval limits are $5,000 for managers.',
      recentMessages: [],
    };

    await service.rewrite('What about directors?', memory);

    const userContent = client.chat.completions.create.mock.calls[0][0].messages[1].content as string;
    expect(userContent).toContain('Finance.pdf');
    expect(userContent).toContain('What about directors?');
  });

  it('falls back to the raw question when the LLM returns an empty response', async () => {
    const client = makeOpenAiStub(null);
    const service = new QueryRewriterService(makeConfigStub(), client);
    const memory: ConversationMemory = { summary: 'something', recentMessages: [] };

    const result = await service.rewrite('follow-up question', memory);

    expect(result).toBe('follow-up question');
  });

  it('falls back to the raw question when the LLM call throws', async () => {
    const client = { chat: { completions: { create: jest.fn().mockRejectedValue(new Error('down')) } } } as any;
    const service = new QueryRewriterService(makeConfigStub(), client);
    const memory: ConversationMemory = { summary: 'something', recentMessages: [] };

    const result = await service.rewrite('follow-up question', memory);

    expect(result).toBe('follow-up question');
  });
});
