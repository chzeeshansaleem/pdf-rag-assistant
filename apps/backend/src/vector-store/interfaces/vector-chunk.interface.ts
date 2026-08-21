/**
 * Payload stored alongside every vector in Qdrant. This is what a similarity
 * search returns in addition to the raw score — it is how a retrieved chunk
 * gets traced back to a filename, page number, and position in the source
 * document.
 */
export interface ChunkPayload {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  category?: string;
  createdAt: string;
}

export interface VectorChunk {
  id: string;
  vector: number[];
  payload: ChunkPayload;
}

export interface SearchResult {
  score: number;
  payload: ChunkPayload;
}
