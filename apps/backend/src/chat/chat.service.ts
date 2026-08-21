import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagService } from '../rag/rag.service';
import { DocumentsRepository } from '../pdf/documents.repository';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationNotFoundException, DocumentNotFoundException, DocumentNotReadyException } from '../common/exceptions/app.exceptions';
import { AskQuestionDto } from './dto/ask-question.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

/**
 * ChatService — the entry point for asking a question.
 *
 * Beyond delegating to RagService, it: resolves the requested retrieval
 * scope (specific documents, a category, or the whole library when neither
 * is given), validates any explicitly named documents actually exist and
 * have finished processing, loads that conversation's memory so multi-turn
 * references can be resolved, and persists both sides of the exchange
 * (question + answer + citations) so chat history survives a reload.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly maxRecentMessages: number;

  constructor(
    private readonly ragService: RagService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly conversationsService: ConversationsService,
    private readonly configService: ConfigService,
  ) {
    this.maxRecentMessages = this.configService.get<number>('rag.maxRecentMessages', { infer: true }) ?? 10;
  }

  async ask(dto: AskQuestionDto): Promise<ChatResponseDto> {
    if (!(await this.conversationsService.exists(dto.conversationId))) {
      throw new ConversationNotFoundException(dto.conversationId);
    }

    if (dto.documentIds?.length) {
      for (const documentId of dto.documentIds) {
        const document = await this.documentsRepository.findById(documentId);
        if (!document) throw new DocumentNotFoundException(documentId);
        if (document.status !== 'processed') throw new DocumentNotReadyException(document.status);
      }
    }

    const scope = { documentIds: dto.documentIds, category: dto.category };

    // Load memory BEFORE persisting the new user message, so it reflects
    // only prior turns — the question being answered isn't "history" yet.
    const memory = await this.conversationsService.getContextForPrompt(dto.conversationId, this.maxRecentMessages);

    await this.conversationsService.appendUserMessage(dto.conversationId, dto.question, scope);

    this.logger.log(`Question received for conversation '${dto.conversationId}' (scope=${JSON.stringify(scope)})`);
    const result = await this.ragService.answerQuestion(scope, dto.question, memory);

    await this.conversationsService.appendAssistantMessage(dto.conversationId, result.answer, result.sources);

    // Best-effort housekeeping: fold any messages that just aged out of the
    // recent window into the rolling summary. Never blocks the response.
    await this.conversationsService.maybeSummarize(dto.conversationId, this.maxRecentMessages);

    return {
      conversationId: dto.conversationId,
      answer: result.answer,
      sources: result.sources,
    };
  }
}
