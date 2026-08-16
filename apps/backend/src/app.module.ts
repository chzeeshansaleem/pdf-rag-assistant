import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { HealthModule } from './health/health.module';
import { PdfModule } from './pdf/pdf.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { VectorStoreModule } from './vector-store/vector-store.module';
import { RagModule } from './rag/rag.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    HealthModule,
    PdfModule,
    EmbeddingsModule,
    VectorStoreModule,
    RagModule,
    ChatModule,
  ],
})
export class AppModule {}
