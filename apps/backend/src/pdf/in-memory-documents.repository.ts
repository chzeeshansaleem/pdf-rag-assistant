import { Injectable } from '@nestjs/common';
import { DocumentsRepository } from './documents.repository';
import { DocumentMetadata } from './interfaces/document-metadata.interface';

/**
 * Default DocumentsRepository implementation for the MVP: an in-process Map.
 * Sufficient for a single backend instance; the README documents how to
 * replace this with a Postgres-backed repository (the `documents` table
 * from section 15) without touching PdfService, since callers only depend
 * on the DocumentsRepository abstraction.
 */
@Injectable()
export class InMemoryDocumentsRepository extends DocumentsRepository {
  private readonly store = new Map<string, DocumentMetadata>();

  async create(doc: DocumentMetadata): Promise<void> {
    this.store.set(doc.id, doc);
  }

  async findById(id: string): Promise<DocumentMetadata | undefined> {
    return this.store.get(id);
  }

  async update(id: string, patch: Partial<DocumentMetadata>): Promise<void> {
    const existing = this.store.get(id);
    if (!existing) return;
    this.store.set(id, { ...existing, ...patch, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async list(): Promise<DocumentMetadata[]> {
    return Array.from(this.store.values());
  }
}
