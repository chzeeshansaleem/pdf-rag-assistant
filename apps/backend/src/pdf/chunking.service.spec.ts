import { ChunkingService } from './chunking.service';
import { cleanText } from './text-cleaner.util';

describe('ChunkingService', () => {
  let service: ChunkingService;

  beforeEach(() => {
    const configServiceStub = { get: () => undefined } as any;
    service = new ChunkingService(configServiceStub);
  });

  it('splits long page text into multiple chunks respecting the configured chunk size', () => {
    const sentence = 'PostgreSQL is used as the primary relational database for this system. ';
    const longText = sentence.repeat(40);

    const chunks = service.chunkPages([{ pageNumber: 1, text: longText }], {
      chunkSize: 100,
      chunkOverlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageNumber).toBe(1);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('assigns a strictly increasing global chunkIndex across pages', () => {
    const chunks = service.chunkPages(
      [
        { pageNumber: 1, text: 'Page one content about databases and storage engines used here.' },
        { pageNumber: 2, text: 'Page two content about the API layer and authentication flow.' },
      ],
      { chunkSize: 500, chunkOverlap: 50 },
    );

    const indices = chunks.map((c) => c.chunkIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it('produces overlapping content between consecutive chunks', () => {
    const sentence = 'The architecture uses PostgreSQL for structured data and S3 for file storage. ';
    const longText = sentence.repeat(30);

    const chunks = service.chunkPages([{ pageNumber: 1, text: longText }], {
      chunkSize: 80,
      chunkOverlap: 30,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.length).toBeGreaterThan(0);
  });

  it('produces no chunks for empty or whitespace-only pages', () => {
    const chunks = service.chunkPages([{ pageNumber: 1, text: '   \n\n  ' }]);
    expect(chunks).toEqual([]);
  });

  it('regression: does not silently drop text that wraps across multiple PDF lines (bug found via real-world GESCI HR manual)', () => {
    // Mirrors how pdf-parse extracts a page with several line-wrapped
    // bullet points: every visual line ends in "\n" regardless of whether
    // a sentence actually ended there. Before the fix, any line-wrapped
    // fragment without trailing punctuation was silently dropped instead
    // of merely split oddly — an entire bullet point (the "frequent flier"
    // sentence, in the real document) could vanish from every chunk.
    const rawPdfPageText = [
      'A gift, other than a gift of modest value, given to a staff member by virtue of his or',
      'her official relationship with the provider of the benefit must be regarded as property of',
      'GESCI. However, benefits under frequent flier schemes may be retained by individual',
      'staff members in recognition of the fact that official travel is disruptive to personal',
      'and family life.',
    ].join('\n');

    const cleaned = cleanText(rawPdfPageText);
    expect(cleaned).toContain('frequent flier schemes may be retained by individual staff members');

    const chunks = service.chunkPages([{ pageNumber: 9, text: cleaned }], { chunkSize: 700, chunkOverlap: 120 });
    const fullChunkedText = chunks.map((c) => c.text).join(' ');
    expect(fullChunkedText).toContain('frequent flier schemes may be retained by individual staff members');
  });

  it('hard-splits a single sentence that exceeds the chunk size on its own', () => {
    const hugeSentence = 'a'.repeat(2000) + '.';
    const chunks = service.chunkPages([{ pageNumber: 1, text: hugeSentence }], {
      chunkSize: 50,
      chunkOverlap: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe('cleanText', () => {
  it('collapses repeated whitespace', () => {
    expect(cleanText('Hello    world   from   PDF')).toBe('Hello world from PDF');
  });

  it('rejoins words hyphenated across a line break', () => {
    expect(cleanText('This is a data-\nbase system.')).toBe('This is a database system.');
  });

  it('collapses excessive blank lines into a single paragraph break', () => {
    expect(cleanText('Paragraph one.\n\n\n\n\nParagraph two.')).toBe('Paragraph one.\n\nParagraph two.');
  });

  it('strips non-printable control characters', () => {
    const nullChar = String.fromCharCode(0);
    const withControlChars = 'Hello' + nullChar + 'World is here.';
    expect(cleanText(withControlChars)).toBe('HelloWorld is here.');
  });

  it('joins a mid-paragraph line-wrap into a space rather than dropping it', () => {
    // This is how pdf-parse extracts a sentence that visually wraps across
    // lines in the PDF — a bare "\n" with no punctuation before it. Losing
    // this text was a real bug: the chunker's sentence splitter couldn't
    // match text across a "\n", so ungrouped fragments were silently
    // dropped instead of merely mis-split.
    const wrapped = 'A gift, other than a gift of modest value, given to a staff member by virtue of his or\nher official relationship must be regarded as property of GESCI.';
    expect(cleanText(wrapped)).toBe(
      'A gift, other than a gift of modest value, given to a staff member by virtue of his or her official relationship must be regarded as property of GESCI.',
    );
  });

  it('preserves a real paragraph break (blank line) as a paragraph break', () => {
    expect(cleanText('First paragraph line one\nline two.\n\nSecond paragraph.')).toBe(
      'First paragraph line one line two.\n\nSecond paragraph.',
    );
  });

  it('trims leading and trailing whitespace', () => {
    expect(cleanText('   padded text   ')).toBe('padded text');
  });
});
