import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PageText, TextChunk, ChunkingOptions } from './interfaces/text-chunk.interface';

/**
 * ChunkingService — splits page text into overlapping, LLM-sized pieces.
 *
 * Why this exists: embeddings and LLM context windows both have token
 * limits, and retrieval quality depends on each chunk being topically
 * coherent. A single "PDF's worth" of text is too big to embed meaningfully
 * (its vector would represent an unhelpful average of everything in the
 * document) — retrieval needs many small, focused vectors instead.
 *
 * Why overlap: without overlap, a fact that happens to sit right at a chunk
 * boundary gets its sentence torn in half, so the surrounding context needed
 * to answer a question about it can end up in neither chunk. A ~100-150
 * token overlap means boundary content still appears whole in at least one
 * chunk.
 *
 * Why sentence-aware splitting: splitting on a raw character/token count
 * would cut mid-sentence, which both hurts embedding quality (partial
 * sentences are ambiguous) and produces context that reads awkwardly when
 * shown to the LLM or the user as a citation.
 *
 * This service is intentionally independent of PdfProcessor — it only knows
 * about `{ pageNumber, text }` pairs, so it can chunk text pulled from any
 * source (a future DOCX/HTML importer, for example) without modification.
 *
 * What enters: cleaned page text.
 * What leaves: an ordered list of chunks, each tagged with the page it came
 * from and a document-wide chunkIndex used later for citations.
 */
@Injectable()
export class ChunkingService {
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  private defaultOptions(): ChunkingOptions {
    return {
      chunkSize: this.configService.get<number>('chunking.chunkSize', { infer: true }) ?? 700,
      chunkOverlap: this.configService.get<number>('chunking.chunkOverlap', { infer: true }) ?? 120,
    };
  }

  chunkPages(pages: PageText[], options?: Partial<ChunkingOptions>): TextChunk[] {
    const opts: ChunkingOptions = { ...this.defaultOptions(), ...options };
    const chunks: TextChunk[] = [];
    let chunkIndex = 0;

    for (const page of pages) {
      const pageChunks = this.chunkSingleText(page.text, opts);
      for (const chunk of pageChunks) {
        chunks.push({
          text: chunk.text,
          pageNumber: page.pageNumber,
          chunkIndex: chunkIndex++,
          tokenCount: chunk.tokenCount,
        });
      }
    }

    return chunks;
  }

  /**
   * Approximates token count without a tokenizer dependency. ~4 characters
   * per token is a well-known rule of thumb for English text with OpenAI
   * models, close enough for sizing decisions (it does not need to be exact —
   * only consistent enough to keep chunks in the right ballpark).
   */
  estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private splitIntoSentences(text: string): string[] {
    if (!text.trim()) return [];
    // Split into paragraphs first (on the double-newlines cleanText()
    // preserves as real paragraph breaks), then sentence-split each
    // paragraph independently on a single line of text. Doing this on
    // paragraph-free text is what guarantees the sentence regex below can
    // never fail to match a run of text and silently drop it — every
    // paragraph is single-line by this point, so there's no "\n" left for a
    // fragment to get stranded across.
    const paragraphs = text.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);

    const sentences: string[] = [];
    for (const paragraph of paragraphs) {
      // Split after sentence-ending punctuation followed by whitespace;
      // anything left over (no terminal punctuation) is still captured via
      // the second alternative rather than being dropped.
      const matches = paragraph.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g);
      for (const m of matches ?? [paragraph]) {
        const trimmed = m.trim();
        if (trimmed) sentences.push(trimmed);
      }
    }
    return sentences;
  }

  private chunkSingleText(text: string, opts: ChunkingOptions): Array<{ text: string; tokenCount: number }> {
    const sentences = this.splitIntoSentences(text);
    if (sentences.length === 0) return [];

    const result: Array<{ text: string; tokenCount: number }> = [];
    let current: string[] = [];
    let currentTokens = 0;

    const flush = () => {
      if (current.length === 0) return;
      const joined = current.join(' ').trim();
      if (joined) {
        result.push({ text: joined, tokenCount: this.estimateTokens(joined) });
      }
    };

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      // A single sentence larger than the whole chunk budget (rare — e.g. a
      // giant unbroken run of text): hard-split it by character count rather
      // than let it blow past the target indefinitely.
      if (sentenceTokens > opts.chunkSize) {
        flush();
        current = [];
        currentTokens = 0;
        const hardChunks = this.hardSplit(sentence, opts.chunkSize);
        result.push(...hardChunks.map((t) => ({ text: t, tokenCount: this.estimateTokens(t) })));
        continue;
      }

      if (currentTokens + sentenceTokens > opts.chunkSize && current.length > 0) {
        flush();
        current = this.takeOverlapTail(current, opts.chunkOverlap);
        currentTokens = current.reduce((sum, s) => sum + this.estimateTokens(s), 0);
      }

      current.push(sentence);
      currentTokens += sentenceTokens;
    }

    flush();
    return result;
  }

  private takeOverlapTail(sentences: string[], overlapTokens: number): string[] {
    if (overlapTokens <= 0) return [];
    const tail: string[] = [];
    let tokens = 0;
    for (let i = sentences.length - 1; i >= 0; i--) {
      const t = this.estimateTokens(sentences[i]);
      if (tokens + t > overlapTokens && tail.length > 0) break;
      tail.unshift(sentences[i]);
      tokens += t;
    }
    return tail;
  }

  private hardSplit(text: string, chunkSizeTokens: number): string[] {
    const maxChars = chunkSizeTokens * 4;
    const pieces: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      pieces.push(text.slice(i, i + maxChars).trim());
    }
    return pieces.filter(Boolean);
  }
}
