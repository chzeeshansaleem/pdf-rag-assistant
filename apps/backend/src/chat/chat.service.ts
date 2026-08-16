import { Injectable, Logger } from '@nestjs/common';
import { RagService } from '../rag/rag.service';
import { DocumentsRepository } from '../pdf/documents.repository';
import { DocumentNotFoundException, DocumentNotReadyException } from '../common/exceptions/app.exceptions';
import { AskQuestionDto } from './dto/ask-question.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

/**
 * ChatService — the entry point for section 9's "RAG Query Flow".
 *
 * Its only job beyond delegating to RagService is validating that the
 * target document actually exists and has finished processing — asking a
 * question against a document that is still embedding (or failed to) is a
 * user-facing error case (section 18), not something RagService should have
 * to know about.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly documentsRepository: DocumentsRepository,
  ) {}

  async ask(dto: AskQuestionDto): Promise<ChatResponseDto> {
    const document = await this.documentsRepository.findById(dto.documentId);
    if (!document) {
      throw new DocumentNotFoundException(dto.documentId);
    }
    if (document.status !== 'processed') {
      throw new DocumentNotReadyException(document.status);
    }

    this.logger.log(`Question received for document '${dto.documentId}'`);
    const result = await this.ragService.answerQuestion(dto.documentId, dto.question);

    return {
      answer: result.answer,
      sources: result.sources,
    };
  }
}
