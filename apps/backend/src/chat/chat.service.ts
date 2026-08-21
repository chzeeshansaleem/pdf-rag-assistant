import { Injectable, Logger } from '@nestjs/common';
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
 * have finished processing, and persists both sides of the exchange
 * (question + answer + citations) to the conversation so chat history
 * survives a reload.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly conversationsService: ConversationsService,
  ) {}

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

    await this.conversationsService.appendUserMessage(dto.conversationId, dto.question, scope);

    this.logger.log(`Question received for conversation '${dto.conversationId}' (scope=${JSON.stringify(scope)})`);
    const result = await this.ragService.answerQuestion(scope, dto.question);

    await this.conversationsService.appendAssistantMessage(dto.conversationId, result.answer, result.sources);

    return {
      conversationId: dto.conversationId,
      answer: result.answer,
      sources: result.sources,
    };
  }
}
