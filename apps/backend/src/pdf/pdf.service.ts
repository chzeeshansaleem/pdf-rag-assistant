import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PdfProcessor } from './pdf.processor';
import { ChunkingService } from './chunking.service';
import { cleanText } from './text-cleaner.util';
import { sanitizeFilename } from './filename.util';
import { DocumentMetadata, DocumentsRepository } from './documents.repository';
import { DocumentResponseDto } from './dto/document-response.dto';
import { UploadDocumentResponseDto } from './dto/upload-document-response.dto';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService, VectorChunk } from '../vector-store/qdrant.service';
import { DocumentNotFoundException, EmptyDocumentException, FileTooLargeException, InvalidFileException } from '../common/exceptions/app.exceptions';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * PdfService — orchestrates the full document ingestion pipeline described
 * in the README's architecture diagram:
 *
 *   upload -> extract text -> clean -> chunk -> embed -> store in Qdrant
 *
 * It intentionally contains no PDF-parsing, chunking, embedding, or
 * vector-store logic itself — those live in their own single-purpose
 * services. PdfService's only job is sequencing them and keeping document
 * metadata (status, page/chunk counts) in sync with what actually happened.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly pdfProcessor: PdfProcessor,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly configService: ConfigService,
  ) {}

  async processUpload(file: UploadedFile | undefined): Promise<UploadDocumentResponseDto> {
    this.validateFile(file);
    const validFile = file!;

    const documentId = randomUUID();
    const filename = sanitizeFilename(validFile.originalname);
    const now = new Date().toISOString();

    const metadata: DocumentMetadata = {
      id: documentId,
      filename,
      fileSize: validFile.size,
      pageCount: 0,
      chunkCount: 0,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
    };
    await this.documentsRepository.create(metadata);

    try {
      this.logger.log(`Processing document '${documentId}' (${filename})`);

      const extracted = await this.pdfProcessor.extract(validFile.buffer);

      const cleanedPages = extracted.pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: cleanText(page.text),
      }));
      const hasText = cleanedPages.some((p) => p.text.length > 0);
      if (!hasText) {
        throw new EmptyDocumentException();
      }

      const chunks = this.chunkingService.chunkPages(cleanedPages);
      if (chunks.length === 0) {
        throw new EmptyDocumentException();
      }
      this.logger.log(`Chunked document '${documentId}' into ${chunks.length} chunk(s)`);

      const vectors = await this.embeddingsService.generateEmbeddings(chunks.map((c) => c.text));
      this.logger.log(`Generated ${vectors.length} embedding(s) for document '${documentId}'`);

      const createdAt = new Date().toISOString();
      const vectorChunks: VectorChunk[] = chunks.map((chunk, i) => ({
        id: this.qdrantService.generatePointId(),
        vector: vectors[i],
        payload: {
          documentId,
          filename,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          createdAt,
        },
      }));
      await this.qdrantService.upsertChunks(vectorChunks);

      await this.documentsRepository.update(documentId, {
        status: 'processed',
        pageCount: extracted.pageCount,
        chunkCount: chunks.length,
      });

      this.logger.log(`Document '${documentId}' processed successfully`);

      return {
        documentId,
        filename,
        status: 'processed',
        pageCount: extracted.pageCount,
        chunkCount: chunks.length,
      };
    } catch (error) {
      await this.documentsRepository.update(documentId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during processing',
      });
      throw error;
    }
  }

  async getDocument(documentId: string): Promise<DocumentResponseDto> {
    const doc = await this.documentsRepository.findById(documentId);
    if (!doc) throw new DocumentNotFoundException(documentId);
    return this.toDto(doc);
  }

  async deleteDocument(documentId: string): Promise<void> {
    const doc = await this.documentsRepository.findById(documentId);
    if (!doc) throw new DocumentNotFoundException(documentId);

    await this.qdrantService.deleteDocument(documentId);
    await this.documentsRepository.delete(documentId);
    this.logger.log(`Deleted document '${documentId}'`);
  }

  private validateFile(file: UploadedFile | undefined): void {
    if (!file) {
      throw new InvalidFileException('No file was uploaded. Attach a PDF using the "file" field.');
    }
    if (file.mimetype !== 'application/pdf' || !file.originalname.toLowerCase().endsWith('.pdf')) {
      throw new InvalidFileException('Only PDF files are supported.');
    }
    if (!file.buffer || file.size === 0) {
      throw new InvalidFileException('The uploaded file is empty.');
    }
    const maxFileSize = this.configService.get<number>('upload.maxFileSize', { infer: true }) ?? 20 * 1024 * 1024;
    if (file.size > maxFileSize) {
      throw new FileTooLargeException(maxFileSize);
    }
  }

  private toDto(doc: DocumentMetadata): DocumentResponseDto {
    return {
      documentId: doc.id,
      filename: doc.filename,
      fileSize: doc.fileSize,
      pageCount: doc.pageCount,
      chunkCount: doc.chunkCount,
      status: doc.status,
      errorMessage: doc.errorMessage,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
