import { ConversationsService } from './conversations.service';
import { ConversationNotFoundException } from '../common/exceptions/app.exceptions';

function makePrismaStub() {
  return {
    conversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function makeConfigStub() {
  return { get: () => 'gpt-4o-mini' } as any;
}

function makeOpenAiStub(content = 'updated summary') {
  return { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [{ message: { content } }] }) } } } as any;
}

const now = new Date('2026-01-01T00:00:00.000Z');

describe('ConversationsService', () => {
  it('create() returns a summary DTO for the new conversation', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.create.mockResolvedValue({ id: 'c1', title: null, createdAt: now, updatedAt: now });
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    const result = await service.create();

    expect(result).toEqual({ id: 'c1', title: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  });

  it('exists() reflects whether a conversation row is present', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.count.mockResolvedValue(1);
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    expect(await service.exists('c1')).toBe(true);

    prisma.conversation.count.mockResolvedValue(0);
    expect(await service.exists('missing')).toBe(false);
  });

  it('findWithMessages() throws ConversationNotFoundException for an unknown id', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue(null);
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    await expect(service.findWithMessages('missing')).rejects.toBeInstanceOf(ConversationNotFoundException);
  });

  it('findWithMessages() maps Prisma roles/messages/sources into the DTO shape', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'My chat',
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: 'm1',
          role: 'USER',
          content: 'question',
          scopeDocumentIds: ['d1'],
          scopeCategory: 'HR',
          createdAt: now,
          sources: [],
        },
        {
          id: 'm2',
          role: 'ASSISTANT',
          content: 'answer',
          scopeDocumentIds: [],
          scopeCategory: null,
          createdAt: now,
          sources: [{ documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'text' }],
        },
      ],
    });
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    const result = await service.findWithMessages('c1');

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1].role).toBe('assistant');
    expect(result.messages[1].sources).toEqual([
      { documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'text' },
    ]);
  });

  it('appendUserMessage() sets the conversation title from the first question only', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', title: null });
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    await service.appendUserMessage('c1', 'What is the remote work policy?', {});

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: 'c1', role: 'USER' }) }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { title: 'What is the remote work policy?' },
    });
  });

  it('appendUserMessage() does not overwrite an existing title', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', title: 'Already set' });
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    await service.appendUserMessage('c1', 'a follow-up question', {});

    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('appendUserMessage() truncates a long question for the derived title', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', title: null });
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());
    const longQuestion = 'x'.repeat(100);

    await service.appendUserMessage('c1', longQuestion, {});

    const updateCall = prisma.conversation.update.mock.calls[0][0];
    expect(updateCall.data.title.length).toBeLessThanOrEqual(60);
    expect(updateCall.data.title.endsWith('…')).toBe(true);
  });

  it('appendAssistantMessage() creates the message with nested sources and bumps updatedAt', async () => {
    const prisma = makePrismaStub();
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());
    const sources = [{ documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'text' }];

    await service.appendAssistantMessage('c1', 'the answer', sources);

    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'c1',
        role: 'ASSISTANT',
        content: 'the answer',
        sources: { create: sources },
      },
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
  });

  it('delete() throws ConversationNotFoundException when the row does not exist', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.delete.mockRejectedValue(new Error('not found'));
    const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

    await expect(service.delete('missing')).rejects.toBeInstanceOf(ConversationNotFoundException);
  });

  describe('getContextForPrompt()', () => {
    it('returns the summary and up to maxRecent messages, in chronological order', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: 'earlier discussion' });
      // Prisma returns them ordered desc (newest first); the service must flip them back to chronological order.
      prisma.message.findMany.mockResolvedValue([
        { role: 'ASSISTANT', content: 'second answer' },
        { role: 'USER', content: 'second question' },
        { role: 'ASSISTANT', content: 'first answer' },
        { role: 'USER', content: 'first question' },
      ]);
      const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

      const memory = await service.getContextForPrompt('c1', 4);

      expect(memory.summary).toBe('earlier discussion');
      expect(memory.recentMessages).toEqual([
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
        { role: 'assistant', content: 'second answer' },
      ]);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 'c1' }, orderBy: { createdAt: 'desc' }, take: 4 }),
      );
    });

    it('returns null summary when the conversation has none yet', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: null });
      const service = new ConversationsService(prisma, makeConfigStub(), makeOpenAiStub());

      const memory = await service.getContextForPrompt('c1', 10);

      expect(memory.summary).toBeNull();
      expect(memory.recentMessages).toEqual([]);
    });
  });

  describe('maybeSummarize()', () => {
    it('does nothing when the conversation still fits entirely in the recent window', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: null, summarizedThroughMessageId: null });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'q1' },
        { id: 'm2', role: 'ASSISTANT', content: 'a1' },
      ]);
      const openai = makeOpenAiStub();
      const service = new ConversationsService(prisma, makeConfigStub(), openai);

      await service.maybeSummarize('c1', 10);

      expect(openai.chat.completions.create).not.toHaveBeenCalled();
      expect(prisma.conversation.update).not.toHaveBeenCalled();
    });

    it('summarizes only the messages that aged out beyond the recent window', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: null, summarizedThroughMessageId: null });
      // 3 messages, recent window = 1 -> the first 2 (m1, m2) have aged out and need summarizing.
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'q1' },
        { id: 'm2', role: 'ASSISTANT', content: 'a1' },
        { id: 'm3', role: 'USER', content: 'q2' },
      ]);
      const openai = makeOpenAiStub('condensed summary');
      const service = new ConversationsService(prisma, makeConfigStub(), openai);

      await service.maybeSummarize('c1', 1);

      expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
      const userMessage = openai.chat.completions.create.mock.calls[0][0].messages[1].content as string;
      expect(userMessage).toContain('User: q1');
      expect(userMessage).toContain('Assistant: a1');
      expect(userMessage).not.toContain('q2'); // still inside the recent window, not summarized yet

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { summary: 'condensed summary', summarizedThroughMessageId: 'm2' },
      });
    });

    it('on a later call, only summarizes messages newer than the previous summarizedThroughMessageId', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: 'summary so far', summarizedThroughMessageId: 'm2' });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'q1' },
        { id: 'm2', role: 'ASSISTANT', content: 'a1' },
        { id: 'm3', role: 'USER', content: 'q2' },
        { id: 'm4', role: 'ASSISTANT', content: 'a2' },
        { id: 'm5', role: 'USER', content: 'q3' },
      ]);
      const openai = makeOpenAiStub('newer condensed summary');
      const service = new ConversationsService(prisma, makeConfigStub(), openai);

      await service.maybeSummarize('c1', 1); // recent window = 1 -> prefix = m1..m4, already summarized through m2

      const userMessage = openai.chat.completions.create.mock.calls[0][0].messages[1].content as string;
      expect(userMessage).toContain('summary so far');
      expect(userMessage).toContain('User: q2');
      expect(userMessage).toContain('Assistant: a2');
      expect(userMessage).not.toContain('q1'); // already folded in previously, not resent
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { summary: 'newer condensed summary', summarizedThroughMessageId: 'm4' },
      });
    });

    it('swallows summarization errors rather than throwing', async () => {
      const prisma = makePrismaStub();
      prisma.conversation.findUnique.mockResolvedValue({ summary: null, summarizedThroughMessageId: null });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm1', role: 'USER', content: 'q1' },
        { id: 'm2', role: 'ASSISTANT', content: 'a1' },
      ]);
      const openai = { chat: { completions: { create: jest.fn().mockRejectedValue(new Error('LLM down')) } } } as any;
      const service = new ConversationsService(prisma, makeConfigStub(), openai);

      await expect(service.maybeSummarize('c1', 0)).resolves.toBeUndefined();
    });
  });
});
