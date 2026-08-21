import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { PdfProcessor } from './pdf.processor';
import { ChunkingService } from './chunking.service';
import { FileStorageService } from './file-storage.service';
import { StuckProcessingSweeperService } from './stuck-processing-sweeper.service';
import { DocumentsRepository } from './documents.repository';
import { PrismaDocumentsRepository } from './prisma-documents.repository';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';

@Module({
  imports: [
    EmbeddingsModule,
    VectorStoreModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: configService.get<number>('upload.maxFileSize', { infer: true }) ?? 20 * 1024 * 1024,
        },
      }),
    }),
  ],
  controllers: [PdfController],
  providers: [
    PdfService,
    PdfProcessor,
    ChunkingService,
    FileStorageService,
    StuckProcessingSweeperService,
    { provide: DocumentsRepository, useClass: PrismaDocumentsRepository },
  ],
  exports: [DocumentsRepository, ChunkingService],
})
export class PdfModule {}
