import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DocumentsRepository } from './documents.repository';
import { DocumentListFilter, DocumentMetadata, DocumentStatus } from './interfaces/document-metadata.interface';
import { Document as PrismaDocument, DocumentStatus as PrismaDocumentStatus } from '@prisma/client';

const STATUS_TO_PRISMA: Record<DocumentStatus, PrismaDocumentStatus> = {
  queued: 'QUEUED',
  processing: 'PROCESSING',
  processed: 'PROCESSED',
  failed: 'FAILED',
};

const STATUS_FROM_PRISMA: Record<PrismaDocumentStatus, DocumentStatus> = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
};

function toDomain(doc: PrismaDocument): DocumentMetadata {
  return {
    id: doc.id,
    filename: doc.filename,
    fileSize: doc.fileSize,
    pageCount: doc.pageCount,
    chunkCount: doc.chunkCount,
    status: STATUS_FROM_PRISMA[doc.status],
    category: doc.category ?? undefined,
    storagePath: doc.storagePath ?? undefined,
    errorMessage: doc.errorMessage ?? undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

@Injectable()
export class PrismaDocumentsRepository extends DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(doc: DocumentMetadata): Promise<void> {
    await this.prisma.document.create({
      data: {
        id: doc.id,
        filename: doc.filename,
        fileSize: doc.fileSize,
        pageCount: doc.pageCount,
        chunkCount: doc.chunkCount,
        status: STATUS_TO_PRISMA[doc.status],
        category: doc.category,
        storagePath: doc.storagePath,
        errorMessage: doc.errorMessage,
      },
    });
  }

  async findById(id: string): Promise<DocumentMetadata | undefined> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    return doc ? toDomain(doc) : undefined;
  }

  async update(id: string, patch: Partial<DocumentMetadata>): Promise<void> {
    await this.prisma.document.update({
      where: { id },
      data: {
        ...(patch.filename !== undefined && { filename: patch.filename }),
        ...(patch.fileSize !== undefined && { fileSize: patch.fileSize }),
        ...(patch.pageCount !== undefined && { pageCount: patch.pageCount }),
        ...(patch.chunkCount !== undefined && { chunkCount: patch.chunkCount }),
        ...(patch.status !== undefined && { status: STATUS_TO_PRISMA[patch.status] }),
        ...(patch.category !== undefined && { category: patch.category }),
        ...(patch.storagePath !== undefined && { storagePath: patch.storagePath }),
        ...(patch.errorMessage !== undefined && { errorMessage: patch.errorMessage }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.document.delete({ where: { id } }).catch(() => undefined);
  }

  async list(filter?: DocumentListFilter): Promise<DocumentMetadata[]> {
    const docs = await this.prisma.document.findMany({
      where: {
        ...(filter?.status && { status: STATUS_TO_PRISMA[filter.status] }),
        ...(filter?.category && { category: filter.category }),
        ...(filter?.ids && { id: { in: filter.ids } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(toDomain);
  }
}
