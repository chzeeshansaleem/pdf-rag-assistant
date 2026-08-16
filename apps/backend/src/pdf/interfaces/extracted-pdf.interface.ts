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
