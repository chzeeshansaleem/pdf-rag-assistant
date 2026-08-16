import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';
import { UploadDocumentResponseDto } from './dto/upload-document-response.dto';
import { DocumentResponseDto } from './dto/document-response.dto';

/**
 * Thin HTTP layer for document lifecycle endpoints. All actual work
 * (validation, parsing, chunking, embedding, storage) happens in
 * PdfService — this controller only translates HTTP <-> service calls.
 */
@Controller('documents')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File): Promise<UploadDocumentResponseDto> {
    return this.pdfService.processUpload(file);
  }

  @Get(':documentId')
  async getDocument(@Param('documentId') documentId: string): Promise<DocumentResponseDto> {
    return this.pdfService.getDocument(documentId);
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(@Param('documentId') documentId: string): Promise<void> {
    await this.pdfService.deleteDocument(documentId);
  }
}
