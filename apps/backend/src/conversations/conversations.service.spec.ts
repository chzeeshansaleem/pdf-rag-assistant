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
    },
  } as any;
}

const now = new Date('2026-01-01T00:00:00.000Z');

describe('ConversationsService', () => {
  it('create() returns a summary DTO for the new conversation', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.create.mockResolvedValue({ id: 'c1', title: null, createdAt: now, updatedAt: now });
    const service = new ConversationsService(prisma);

    const result = await service.create();

    expect(result).toEqual({ id: 'c1', title: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  });

  it('exists() reflects whether a conversation row is present', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.count.mockResolvedValue(1);
    const service = new ConversationsService(prisma);

    expect(await service.exists('c1')).toBe(true);

    prisma.conversation.count.mockResolvedValue(0);
    expect(await service.exists('missing')).toBe(false);
  });

  it('findWithMessages() throws ConversationNotFoundException for an unknown id', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue(null);
    const service = new ConversationsService(prisma);

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
    const service = new ConversationsService(prisma);

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
    const service = new ConversationsService(prisma);

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
    const service = new ConversationsService(prisma);

    await service.appendUserMessage('c1', 'a follow-up question', {});

    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('appendUserMessage() truncates a long question for the derived title', async () => {
    const prisma = makePrismaStub();
    prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', title: null });
    const service = new ConversationsService(prisma);
    const longQuestion = 'x'.repeat(100);

    await service.appendUserMessage('c1', longQuestion, {});

    const updateCall = prisma.conversation.update.mock.calls[0][0];
    expect(updateCall.data.title.length).toBeLessThanOrEqual(60);
    expect(updateCall.data.title.endsWith('…')).toBe(true);
  });

  it('appendAssistantMessage() creates the message with nested sources and bumps updatedAt', async () => {
    const prisma = makePrismaStub();
    const service = new ConversationsService(prisma);
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
    const service = new ConversationsService(prisma);

    await expect(service.delete('missing')).rejects.toBeInstanceOf(ConversationNotFoundException);
  });
});
