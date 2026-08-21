import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DocumentsRepository } from './documents.repository';

const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Since document processing is fire-and-forget with no job queue/watchdog,
 * a backend crash or restart mid-processing leaves a document stuck in
 * 'processing' forever with nothing to retry it. On boot, reset any row
 * that's been 'processing' for longer than a crash could plausibly take
 * back to 'queued' so it picks up on the next processing pass (e.g. a
 * manual retry, or a future scheduler) instead of silently hanging.
 */
@Injectable()
export class StuckProcessingSweeperService implements OnModuleInit {
  private readonly logger = new Logger(StuckProcessingSweeperService.name);

  constructor(private readonly documentsRepository: DocumentsRepository) {}

  async onModuleInit(): Promise<void> {
    const processing = await this.documentsRepository.list({ status: 'processing' });
    const cutoff = Date.now() - STUCK_THRESHOLD_MS;
    const stuck = processing.filter((doc) => new Date(doc.updatedAt).getTime() < cutoff);

    for (const doc of stuck) {
      await this.documentsRepository.update(doc.id, { status: 'queued' });
      this.logger.warn(`Reset stuck document '${doc.id}' (${doc.filename}) from 'processing' back to 'queued'`);
    }
  }
}
