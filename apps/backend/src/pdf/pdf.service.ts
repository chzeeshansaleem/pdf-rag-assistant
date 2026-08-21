import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PdfProcessor } from './pdf.processor';
import { ChunkingService } from './chunking.service';
import { cleanText } from './text-cleaner.util';
import { sanitizeFilename } from './filename.util';
import { DocumentsRepository } from './documents.repository';
import { DocumentListFilter, DocumentMetadata } from './interfaces/document-metadata.interface';
import { UploadedFile } from './interfaces/uploaded-file.interface';
import { DocumentResponseDto } from './dto/document-response.dto';
import { UploadDocumentResponseDto } from './dto/upload-document-response.dto';
import { FileStorageService } from './file-storage.service';
import { ConcurrencyLimiter } from './concurrency-limiter';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService } from '../vector-store/qdrant.service';
import { VectorChunk } from '../vector-store/interfaces/vector-chunk.interface';
import {
  DocumentNotFoundException,
  EmptyDocumentException,
  FileTooLargeException,
  InvalidDocumentStateException,
  InvalidFileException,
} from '../common/exceptions/app.exceptions';

/**
 * PdfService — orchestrates the full document ingestion pipeline described
 * in the README's architecture diagram:
 *
 *   upload -> extract text -> clean -> chunk -> embed -> store in Qdrant
 *
 * Ingestion is split into two phases so uploads don't block the HTTP
 * request: `createQueuedDocument` does the cheap, synchronous part
 * (validate + persist the row + persist the original bytes) and returns
 * immediately with status 'queued'; `processDocumentAsync` does the
 * expensive part (extract/chunk/embed/upsert) and is invoked without being
 * awaited by the controller, updating the document's status as it goes.
 * That work runs through a small ConcurrencyLimiter so a large batch upload
 * doesn't fire dozens of embedding/Qdrant calls at once — there's no job
 * queue in this stack, so this in-process cap is what keeps a bulk upload
 * from overwhelming the vector store or the embedding provider's rate limit.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private readonly processingLimiter = new ConcurrencyLimiter(4);

  constructor(
    private readonly pdfProcessor: PdfProcessor,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingsService: EmbeddingsService,
    private readonly qdrantService: QdrantService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly fileStorageService: FileStorageService,
    private readonly configService: ConfigService,
  ) {}

  async createQueuedDocument(file: UploadedFile | undefined, category?: string): Promise<UploadDocumentResponseDto> {
    this.validateFile(file);
    const validFile = file!;

    const documentId = randomUUID();
    const filename = sanitizeFilename(validFile.originalname);
    const now = new Date().toISOString();
    const storagePath = await this.fileStorageService.save(documentId, validFile.buffer);

    const metadata: DocumentMetadata = {
      id: documentId,
      filename,
      fileSize: validFile.size,
      pageCount: 0,
      chunkCount: 0,
      status: 'queued',
      category,
      storagePath,
      createdAt: now,
      updatedAt: now,
    };
    await this.documentsRepository.create(metadata);
    this.logger.log(`Queued document '${documentId}' (${filename})`);

    return {
      documentId,
      filename,
      status: 'queued',
      category,
      pageCount: 0,
      chunkCount: 0,
    };
  }

  async processDocumentAsync(documentId: string): Promise<void> {
    // Admission to the limiter (not the call itself) gates when real work
    // starts — a document can sit at 'queued' behind other in-flight work
    // for a while on a big batch upload, which is expected and visible to
    // the client via polling, rather than firing everything at once.
    return this.processingLimiter.run(() => this.processDocument(documentId));
  }

  private async processDocument(documentId: string): Promise<void> {
    const doc = await this.documentsRepository.findById(documentId);
    if (!doc) {
      this.logger.error(`Cannot process unknown document '${documentId}'`);
      return;
    }

    await this.documentsRepository.update(documentId, { status: 'processing' });

    try {
      this.logger.log(`Processing document '${documentId}' (${doc.filename})`);

      const buffer = await this.fileStorageService.read(documentId);
      const extracted = await this.pdfProcessor.extract(buffer);

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
          filename: doc.filename,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          category: doc.category,
          createdAt,
        },
      }));
      await this.qdrantService.upsertChunks(vectorChunks);

      await this.documentsRepository.update(documentId, {
        status: 'processed',
        pageCount: extracted.pageCount,
        chunkCount: chunks.length,
        errorMessage: undefined,
      });

      this.logger.log(`Document '${documentId}' processed successfully`);
    } catch (error) {
      await this.documentsRepository.update(documentId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during processing',
      });
      this.logger.error(`Document '${documentId}' failed to process: ${error instanceof Error ? error.message : error}`);
    }
  }

  async retryDocument(documentId: string): Promise<DocumentResponseDto> {
    const doc = await this.documentsRepository.findById(documentId);
    if (!doc) throw new DocumentNotFoundException(documentId);
    if (doc.status !== 'failed') {
      throw new InvalidDocumentStateException(`Document '${documentId}' is not in a failed state (status: ${doc.status})`);
    }
    await this.documentsRepository.update(documentId, { status: 'queued', errorMessage: undefined });
    void this.processDocumentAsync(documentId);
    return this.toDto((await this.documentsRepository.findById(documentId))!);
  }

  async reprocessDocument(documentId: string): Promise<DocumentResponseDto> {
    const doc = await this.documentsRepository.findById(documentId);
    if (!doc) throw new DocumentNotFoundException(documentId);
    if (doc.status !== 'processed' && doc.status !== 'failed') {
      throw new InvalidDocumentStateException(
        `Document '${documentId}' cannot be re-processed while status is '${doc.status}'`,
      );
    }
    await this.qdrantService.deleteDocument(documentId);
    await this.documentsRepository.update(documentId, {
      status: 'queued',
      errorMessage: undefined,
      pageCount: 0,
      chunkCount: 0,
    });
    void this.processDocumentAsync(documentId);
    return this.toDto((await this.documentsRepository.findById(documentId))!);
  }

  async listDocuments(filter?: DocumentListFilter): Promise<DocumentResponseDto[]> {
    const docs = await this.documentsRepository.list(filter);
    return docs.map((doc) => this.toDto(doc));
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
    await this.fileStorageService.delete(documentId);
    this.logger.log(`Deleted document '${documentId}'`);
  }

  private validateFile(file: UploadedFile | undefined): void {
    if (!file) {
      throw new InvalidFileException('No file was uploaded. Attach one or more PDFs using the "files" field.');
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
      category: doc.category,
      errorMessage: doc.errorMessage,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
