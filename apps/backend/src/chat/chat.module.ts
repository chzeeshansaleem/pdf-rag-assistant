import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RagModule } from '../rag/rag.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [RagModule, PdfModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
