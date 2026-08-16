export interface PageText {
  pageNumber: number;
  text: string;
}

export interface TextChunk {
  text: string;
  pageNumber: number;
  chunkIndex: number;
  tokenCount: number;
}

export interface ChunkingOptions {
  chunkSize: number;
  chunkOverlap: number;
}
