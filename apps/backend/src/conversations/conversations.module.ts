import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { OpenAiClientProvider } from '../common/openai-client.provider';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, OpenAiClientProvider],
  exports: [ConversationsService],
})
export class ConversationsModule {}
