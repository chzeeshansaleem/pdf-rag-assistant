import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PdfProcessor } from './pdf.processor';
import { PdfParsingException } from '../common/exceptions/app.exceptions';

const fixture = (name: string) => join(__dirname, '..', '..', 'test', 'fixtures', name);

describe('PdfProcessor', () => {
  const processor = new PdfProcessor();

  it('extracts text per page with page numbers preserved', async () => {
    const buffer = readFileSync(fixture('aws-architecture.pdf'));
    const result = await processor.extract(buffer);

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[1].pageNumber).toBe(2);
    expect(result.pages[0].text).toContain('PostgreSQL');
    expect(result.pages[1].text).toContain('Redis');
  });

  it('returns an empty-text page for a PDF with no extractable text', async () => {
    const buffer = readFileSync(fixture('empty-text.pdf'));
    const result = await processor.extract(buffer);
    expect(result.pages.every((p) => p.text.trim().length === 0)).toBe(true);
  });

  it('throws PdfParsingException for a corrupted/invalid PDF', async () => {
    const buffer = readFileSync(fixture('corrupted.pdf'));
    await expect(processor.extract(buffer)).rejects.toBeInstanceOf(PdfParsingException);
  });
});
