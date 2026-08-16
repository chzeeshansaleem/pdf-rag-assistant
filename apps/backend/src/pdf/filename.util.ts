/**
 * Strips directory components and disallowed characters from a
 * client-supplied filename before it is stored or displayed. Multer already
 * keeps the upload off the filesystem path traversal-wise (buffer storage,
 * not disk), but the filename is still attacker-controlled input that ends
 * up in JSON responses and, eventually, the UI — so it is sanitized rather
 * than trusted.
 */
export function sanitizeFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? 'document.pdf';
  const cleaned = base.replace(/[^a-zA-Z0-9 ._-]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : 'document.pdf';
}
