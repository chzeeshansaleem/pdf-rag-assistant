import { Injectable, Logger } from '@nestjs/common';
import type { PDFParse as PDFParseType } from 'pdf-parse';
import { PdfParsingException } from '../common/exceptions/app.exceptions';

/**
 * pdf-parse (via pdfjs-dist) tries to polyfill DOMMatrix/ImageData/Path2D
 * using the optional native `@napi-rs/canvas` package, for its canvas
 * rendering features (getScreenshot/getImage). When that native binding
 * can't load for the current platform/arch (e.g. inside certain container
 * images), pdfjs-dist still references these globals at module-load time,
 * crashing the process before we ever get a chance to call anything.
 *
 * We only ever use getText() — no rendering — so a minimal stub is enough
 * to satisfy the reference and let the module load; it is never actually
 * exercised.
 */
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
  if (typeof (globalThis as Record<string, unknown>)[name] === 'undefined') {
    (globalThis as Record<string, unknown>)[name] = class {};
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse') as typeof import('pdf-parse');

/**
 * Raw text extracted from a single PDF page, before cleaning/chunking.
 */
export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPage[];
}

/**
 * PdfProcessor — the only component in the app that knows how to read raw
 * PDF bytes.
 *
 * Why it exists: PDF parsing is a distinct concern from chunking or
 * embedding, and isolating it here means we could swap the underlying
 * parsing library (or add OCR for scanned PDFs — see README "Future
 * Improvements") without touching anything downstream.
 *
 * What enters: a PDF file's raw Buffer.
 * What leaves: plain text per page, with page numbers preserved so every
 * downstream chunk can cite exactly where it came from.
 */
@Injectable()
export class PdfProcessor {
  private readonly logger = new Logger(PdfProcessor.name);

  async extract(buffer: Buffer): Promise<ExtractedPdf> {
    let parser: PDFParseType | undefined;
    try {
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();

      const pages: ExtractedPage[] = result.pages.map((page) => ({
        pageNumber: page.num,
        text: page.text ?? '',
      }));

      this.logger.log(`Parsed PDF: ${result.total} page(s)`);

      return { pageCount: result.total, pages };
    } catch (error) {
      this.logger.error(`PDF parsing failed: ${error instanceof Error ? error.message : error}`);
      throw new PdfParsingException();
    } finally {
      await parser?.destroy();
    }
  }
}
