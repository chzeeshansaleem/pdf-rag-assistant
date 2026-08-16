import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { OpenAiClientProvider } from '../common/openai-client.provider';

@Module({
  providers: [EmbeddingsService, OpenAiClientProvider],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
