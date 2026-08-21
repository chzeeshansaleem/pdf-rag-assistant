import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationDetailDto, ConversationSummaryDto } from './dto/conversation-response.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async create(): Promise<ConversationSummaryDto> {
    return this.conversationsService.create();
  }

  @Get()
  async list(): Promise<ConversationSummaryDto[]> {
    return this.conversationsService.list();
  }

  @Get(':conversationId')
  async getWithMessages(@Param('conversationId') conversationId: string): Promise<ConversationDetailDto> {
    return this.conversationsService.findWithMessages(conversationId);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('conversationId') conversationId: string): Promise<void> {
    await this.conversationsService.delete(conversationId);
  }
}
