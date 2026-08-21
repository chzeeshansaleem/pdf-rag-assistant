import { DocumentListFilter, DocumentMetadata } from './interfaces/document-metadata.interface';

/**
 * Abstraction over document metadata storage.
 *
 * Why it exists: section 15 of the spec calls for Qdrant to be the primary
 * store for the MVP while keeping a clean seam to introduce a relational
 * database later (for multi-user auth, conversation history, etc. — see
 * README "Future Improvements"). Every other service depends on this
 * interface, not on a concrete storage technology, so swapping the
 * `InMemoryDocumentsRepository` below for a Postgres-backed implementation
 * is a one-file change.
 */
export abstract class DocumentsRepository {
  abstract create(doc: DocumentMetadata): Promise<void>;
  abstract findById(id: string): Promise<DocumentMetadata | undefined>;
  abstract update(id: string, patch: Partial<DocumentMetadata>): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract list(filter?: DocumentListFilter): Promise<DocumentMetadata[]>;
}
