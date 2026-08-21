import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RetrieverService } from './retriever.service';
import { PromptService } from './prompt.service';
import { QueryRewriterService } from './query-rewriter.service';
import { ChitchatService } from './chitchat.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { OpenAiClientProvider } from '../common/openai-client.provider';

@Module({
  imports: [EmbeddingsModule, VectorStoreModule],
  providers: [RagService, RetrieverService, PromptService, QueryRewriterService, ChitchatService, OpenAiClientProvider],
  exports: [RagService],
})
export class RagModule {}
