import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ConversationNotFoundException } from '../common/exceptions/app.exceptions';
import { ConversationDetailDto, ConversationSummaryDto } from './dto/conversation-response.dto';
import { MessageSourceData } from './interfaces/message.interface';

const TITLE_MAX_LENGTH = 60;

function deriveTitle(question: string): string {
  return question.length > TITLE_MAX_LENGTH ? `${question.slice(0, TITLE_MAX_LENGTH - 1)}…` : question;
}

/**
 * ConversationsService — persistence for chat sessions (conversations,
 * their messages, and each assistant message's source citations).
 *
 * Why it exists: chat history used to live only in frontend React state,
 * lost on every page reload. Persisting it here is what lets the sidebar
 * show a list of past sessions and reload full history on demand — and,
 * since citations are snapshotted (filename/page/snippet frozen at answer
 * time, keyed by a plain documentId rather than a foreign key), old
 * conversations stay fully readable even after the document they cited has
 * since been deleted or re-processed.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(): Promise<ConversationSummaryDto> {
    const conversation = await this.prisma.conversation.create({ data: {} });
    this.logger.log(`Created conversation '${conversation.id}'`);
    return this.toSummaryDto(conversation);
  }

  async list(): Promise<ConversationSummaryDto[]> {
    const conversations = await this.prisma.conversation.findMany({ orderBy: { updatedAt: 'desc' } });
    return conversations.map((c) => this.toSummaryDto(c));
  }

  async findWithMessages(conversationId: string): Promise<ConversationDetailDto> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, include: { sources: true } } },
    });
    if (!conversation) throw new ConversationNotFoundException(conversationId);

    return {
      ...this.toSummaryDto(conversation),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.content,
        scopeDocumentIds: m.scopeDocumentIds,
        scopeCategory: m.scopeCategory,
        createdAt: m.createdAt.toISOString(),
        sources: m.sources.map((s) => ({
          documentId: s.documentId,
          filename: s.filename,
          pageNumber: s.pageNumber,
          chunkIndex: s.chunkIndex,
          snippetText: s.snippetText,
        })),
      })),
    };
  }

  async exists(conversationId: string): Promise<boolean> {
    const count = await this.prisma.conversation.count({ where: { id: conversationId } });
    return count > 0;
  }

  async delete(conversationId: string): Promise<void> {
    await this.prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {
      throw new ConversationNotFoundException(conversationId);
    });
  }

  async appendUserMessage(
    conversationId: string,
    content: string,
    scope: { documentIds?: string[]; category?: string },
  ): Promise<void> {
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'USER',
        content,
        scopeDocumentIds: scope.documentIds ?? [],
        scopeCategory: scope.category,
      },
    });

    // Set the conversation's title from its first question, if not already set.
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (conversation && conversation.title === null) {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { title: deriveTitle(content) },
      });
    }
  }

  async appendAssistantMessage(conversationId: string, content: string, sources: MessageSourceData[]): Promise<void> {
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content,
        sources: { create: sources },
      },
    });
    // Bump updatedAt so the sidebar's "most recently active" ordering reflects this turn.
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }

  private toSummaryDto(conversation: { id: string; title: string | null; createdAt: Date; updatedAt: Date }): ConversationSummaryDto {
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }
}
