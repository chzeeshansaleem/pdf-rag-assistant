import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Persists the original uploaded PDF bytes to disk, keyed by documentId.
 *
 * Why it exists: the ingestion pipeline discards the multer buffer once a
 * document is processed, but the dashboard's "re-process" action (re-run
 * chunking/embedding on an already-succeeded document, e.g. after a
 * chunking config change) needs the original bytes again — there is no
 * other durable copy of the source PDF.
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name);

  constructor(private readonly configService: ConfigService) {}

  private get storageDir(): string {
    return this.configService.get<string>('upload.storageDir', { infer: true }) ?? './data/uploads';
  }

  private pathFor(documentId: string): string {
    return join(this.storageDir, `${documentId}.pdf`);
  }

  async save(documentId: string, buffer: Buffer): Promise<string> {
    await mkdir(this.storageDir, { recursive: true });
    const path = this.pathFor(documentId);
    await writeFile(path, buffer);
    return path;
  }

  async read(documentId: string): Promise<Buffer> {
    return readFile(this.pathFor(documentId));
  }

  async delete(documentId: string): Promise<void> {
    await unlink(this.pathFor(documentId)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete stored file for document '${documentId}': ${err.message}`);
      }
    });
  }
}
