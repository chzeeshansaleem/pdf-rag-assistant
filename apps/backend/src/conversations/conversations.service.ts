import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../database/prisma.service';
import { OPENAI_CLIENT } from '../common/openai-client.provider';
import { ConversationNotFoundException } from '../common/exceptions/app.exceptions';
import { ConversationDetailDto, ConversationSummaryDto } from './dto/conversation-response.dto';
import { MessageSourceData } from './interfaces/message.interface';
import { ConversationMemory, MemoryMessage } from './interfaces/conversation-memory.interface';

const TITLE_MAX_LENGTH = 60;

const SUMMARY_SYSTEM_PROMPT = `You maintain a running summary of an ongoing conversation between a user and a document Q&A assistant.

Given the existing summary (if any) and a batch of new messages that are aging out of short-term memory, produce an updated summary.

Preserve:
- Topics and documents/files discussed
- Important entities and facts the user has asked about
- Important questions asked and conclusions reached
- Any references the user might still refer back to (e.g. "that policy", "the second one")

Be concise (a few sentences, not a transcript). Do not include conversational filler, greetings, or meta-commentary. Output ONLY the updated summary text.`;

function deriveTitle(question: string): string {
  return question.length > TITLE_MAX_LENGTH ? `${question.slice(0, TITLE_MAX_LENGTH - 1)}…` : question;
}

/**
 * ConversationsService — persistence for chat sessions (conversations,
 * their messages, and each assistant message's source citations) plus the
 * conversation-memory maintenance that feeds multi-turn context back into
 * the RAG pipeline (see rag/query-rewriter.service.ts and
 * rag/prompt.service.ts, which consume `ConversationMemory`).
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
  private readonly summaryModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(OPENAI_CLIENT) private readonly client: OpenAI,
  ) {
    this.summaryModel = this.configService.get<string>('openai.chatModel', { infer: true }) ?? 'gpt-4o-mini';
  }

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

  /**
   * Loads what a new question should see of this conversation's past: the
   * rolling summary (everything older than the recent window, already
   * condensed) plus the most recent `maxRecent` messages verbatim. Called
   * BEFORE the new user message is persisted, so it never includes the
   * question currently being answered.
   */
  async getContextForPrompt(conversationId: string, maxRecent: number): Promise<ConversationMemory> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { summary: true },
    });

    const recent = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: maxRecent,
      select: { role: true, content: true },
    });
    recent.reverse(); // back to chronological order

    const recentMessages: MemoryMessage[] = recent.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    return { summary: conversation?.summary ?? null, recentMessages };
  }

  /**
   * Folds messages that have aged out of the recent window into the
   * conversation's rolling summary, so a long conversation never sends its
   * full history to the LLM. Incremental: only summarizes messages newer
   * than `summarizedThroughMessageId` from the last run, not the whole
   * prefix again each time. Safe to call after every turn — it no-ops
   * once the conversation is short enough that nothing has aged out yet.
   *
   * Best-effort: a summarization failure is logged and swallowed rather
   * than failing the chat request — memory quality degrading slightly is
   * far better than an answer the user was waiting on failing outright.
   */
  async maybeSummarize(conversationId: string, maxRecent: number): Promise<void> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { summary: true, summarizedThroughMessageId: true },
      });
      if (!conversation) return;

      const messages = await this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true },
      });

      const prefixCount = messages.length - maxRecent;
      if (prefixCount <= 0) return; // conversation still fits entirely in the recent window

      const prefix = messages.slice(0, prefixCount);
      const markerIndex = conversation.summarizedThroughMessageId
        ? prefix.findIndex((m) => m.id === conversation.summarizedThroughMessageId)
        : -1;
      const newlyAgedOut = markerIndex >= 0 ? prefix.slice(markerIndex + 1) : prefix;
      if (newlyAgedOut.length === 0) return; // already caught up

      const updatedSummary = await this.summarize(conversation.summary, newlyAgedOut);

      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { summary: updatedSummary, summarizedThroughMessageId: prefix[prefix.length - 1].id },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to update conversation summary for '${conversationId}': ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async summarize(
    existingSummary: string | null,
    newMessages: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>,
  ): Promise<string> {
    const transcript = newMessages.map((m) => `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const userPrompt = `Existing summary:\n${existingSummary ?? 'None yet.'}\n\nNew messages to fold in:\n${transcript}\n\nUpdated summary:`;

    const response = await this.client.chat.completions.create({
      model: this.summaryModel,
      temperature: 0,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    return content || existingSummary || '';
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
