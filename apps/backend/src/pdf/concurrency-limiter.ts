/**
 * Bounds how many async tasks run at once. Without this, uploading a large
 * batch of PDFs fires one concurrent processing chain per file — each doing
 * its own embedding calls and Qdrant upserts — which can overwhelm the
 * vector store or hit provider rate limits under a big enough batch. There's
 * no job queue (BullMQ/Redis) in this stack by design, so this is the
 * lightweight in-process substitute: a fixed-size pool that queues excess
 * work rather than firing it all at once.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}
