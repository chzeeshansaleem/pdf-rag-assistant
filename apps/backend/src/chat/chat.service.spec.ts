import { ChatService } from './chat.service';
import { ConversationNotFoundException, DocumentNotFoundException, DocumentNotReadyException } from '../common/exceptions/app.exceptions';
import type { AskQuestionDto } from './dto/ask-question.dto';

const emptyMemory = { summary: null, recentMessages: [] };

function makeDeps(overrides: {
  conversationExists?: boolean;
  documents?: Record<string, { status: string } | undefined>;
  answer?: { answer: string; sources: any[] };
  memory?: { summary: string | null; recentMessages: any[] };
} = {}) {
  const ragService = {
    answerQuestion: jest.fn().mockResolvedValue(overrides.answer ?? { answer: 'the answer', sources: [] }),
  } as any;
  const documentsRepository = {
    findById: jest.fn(async (id: string) => overrides.documents?.[id]),
  } as any;
  const conversationsService = {
    exists: jest.fn().mockResolvedValue(overrides.conversationExists ?? true),
    appendUserMessage: jest.fn().mockResolvedValue(undefined),
    appendAssistantMessage: jest.fn().mockResolvedValue(undefined),
    getContextForPrompt: jest.fn().mockResolvedValue(overrides.memory ?? emptyMemory),
    maybeSummarize: jest.fn().mockResolvedValue(undefined),
  } as any;
  const configService = { get: () => 10 } as any;
  return { ragService, documentsRepository, conversationsService, configService };
}

describe('ChatService', () => {
  it('throws ConversationNotFoundException when the conversation does not exist', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps({ conversationExists: false });
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    await expect(
      service.ask({ conversationId: 'missing', question: 'q' } as AskQuestionDto),
    ).rejects.toBeInstanceOf(ConversationNotFoundException);
  });

  it('throws DocumentNotFoundException when a named documentId does not exist', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps({ documents: {} });
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    await expect(
      service.ask({ conversationId: 'c1', documentIds: ['missing-doc'], question: 'q' } as AskQuestionDto),
    ).rejects.toBeInstanceOf(DocumentNotFoundException);
  });

  it('throws DocumentNotReadyException when a named document has not finished processing', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps({
      documents: { 'doc-1': { status: 'processing' } },
    });
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    await expect(
      service.ask({ conversationId: 'c1', documentIds: ['doc-1'], question: 'q' } as AskQuestionDto),
    ).rejects.toBeInstanceOf(DocumentNotReadyException);
  });

  it('does not validate individual documents when scoping by category only', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps();
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    await service.ask({ conversationId: 'c1', category: 'HR', question: 'q' } as AskQuestionDto);

    expect(documentsRepository.findById).not.toHaveBeenCalled();
    expect(ragService.answerQuestion).toHaveBeenCalledWith({ documentIds: undefined, category: 'HR' }, 'q', emptyMemory);
  });

  it('resolves to an empty scope (search everything) when neither documentIds nor category is given', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps();
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    await service.ask({ conversationId: 'c1', question: 'q' } as AskQuestionDto);

    expect(ragService.answerQuestion).toHaveBeenCalledWith({ documentIds: undefined, category: undefined }, 'q', emptyMemory);
  });

  it('loads conversation memory before persisting the new user message, and passes it to RagService', async () => {
    const priorMemory = { summary: 'The user discussed Security.pdf.', recentMessages: [{ role: 'user', content: 'earlier q' }] };
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps({ memory: priorMemory });
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    const callOrder: string[] = [];
    conversationsService.getContextForPrompt.mockImplementation(async () => {
      callOrder.push('getContextForPrompt');
      return priorMemory;
    });
    conversationsService.appendUserMessage.mockImplementation(async () => {
      callOrder.push('appendUserMessage');
    });

    await service.ask({ conversationId: 'c1', question: 'explain the second one' } as AskQuestionDto);

    expect(callOrder).toEqual(['getContextForPrompt', 'appendUserMessage']);
    expect(ragService.answerQuestion).toHaveBeenCalledWith(
      { documentIds: undefined, category: undefined },
      'explain the second one',
      priorMemory,
    );
  });

  it('persists the user message before answering and the assistant message with sources after, then summarizes', async () => {
    const { ragService, documentsRepository, conversationsService, configService } = makeDeps({
      answer: { answer: 'grounded answer', sources: [{ documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'x' }] },
    });
    const service = new ChatService(ragService, documentsRepository, conversationsService, configService);

    const result = await service.ask({ conversationId: 'c1', question: 'q' } as AskQuestionDto);

    expect(conversationsService.appendUserMessage).toHaveBeenCalledWith('c1', 'q', { documentIds: undefined, category: undefined });
    expect(conversationsService.appendAssistantMessage).toHaveBeenCalledWith(
      'c1',
      'grounded answer',
      [{ documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'x' }],
    );
    expect(conversationsService.maybeSummarize).toHaveBeenCalledWith('c1', 10);
    expect(result).toEqual({
      conversationId: 'c1',
      answer: 'grounded answer',
      sources: [{ documentId: 'd1', filename: 'a.pdf', pageNumber: 1, chunkIndex: 0, snippetText: 'x' }],
    });
  });
});
