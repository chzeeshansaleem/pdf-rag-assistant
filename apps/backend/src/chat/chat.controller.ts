import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async ask(@Body() dto: AskQuestionDto): Promise<ChatResponseDto> {
    return this.chatService.ask(dto);
  }
}
