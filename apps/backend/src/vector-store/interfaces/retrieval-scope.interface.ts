/**
 * Narrows a similarity search to a subset of documents. Both fields are
 * optional and combine with AND semantics; an empty scope (`{}`) means
 * "search every document" — the Qdrant filter is simply omitted rather than
 * enumerating every processed document ID.
 */
export interface RetrievalScope {
  documentIds?: string[];
  category?: string;
}
