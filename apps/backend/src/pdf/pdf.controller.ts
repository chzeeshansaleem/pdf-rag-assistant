import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PdfService } from './pdf.service';
import { UploadDocumentResponseDto } from './dto/upload-document-response.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { InvalidFileException } from '../common/exceptions/app.exceptions';
import { CATEGORIES } from './constants/categories';

const MAX_FILES_PER_UPLOAD = 20;

/**
 * Thin HTTP layer for document lifecycle endpoints. All actual work
 * (validation, parsing, chunking, embedding, storage) happens in
 * PdfService — this controller only translates HTTP <-> service calls.
 *
 * Upload returns as soon as each file's row is persisted (status
 * 'queued') — the expensive extract/chunk/embed work runs in the
 * background via a fire-and-forget call, so a batch of PDFs never blocks
 * the response. Clients poll `GET /documents` to observe status changes.
 */
@Controller('documents')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD))
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('category') category?: string,
  ): Promise<UploadDocumentResponseDto[]> {
    if (!files || files.length === 0) {
      throw new InvalidFileException('No files were uploaded. Attach one or more PDFs using the "files" field.');
    }
    if (category !== undefined && !(CATEGORIES as readonly string[]).includes(category)) {
      throw new InvalidFileException(`Invalid category '${category}'. Must be one of: ${CATEGORIES.join(', ')}`);
    }

    const created = await Promise.all(files.map((file) => this.pdfService.createQueuedDocument(file, category)));
    for (const doc of created) {
      void this.pdfService.processDocumentAsync(doc.documentId);
    }
    return created;
  }

  @Get()
  async listDocuments(@Query() query: ListDocumentsQueryDto): Promise<DocumentResponseDto[]> {
    return this.pdfService.listDocuments({
      status: query.status,
      category: query.category,
      ids: query.ids,
    });
  }

  @Get(':documentId')
  async getDocument(@Param('documentId') documentId: string): Promise<DocumentResponseDto> {
    return this.pdfService.getDocument(documentId);
  }

  @Post(':documentId/retry')
  async retryDocument(@Param('documentId') documentId: string): Promise<DocumentResponseDto> {
    return this.pdfService.retryDocument(documentId);
  }

  @Post(':documentId/reprocess')
  async reprocessDocument(@Param('documentId') documentId: string): Promise<DocumentResponseDto> {
    return this.pdfService.reprocessDocument(documentId);
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(@Param('documentId') documentId: string): Promise<void> {
    await this.pdfService.deleteDocument(documentId);
  }
}
