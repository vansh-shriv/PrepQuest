/**
 * Runs background work in-process (resume parsing, scorecard generation) and lets tests await it.
 * Jobs persist their own status in the database, so a crash leaves a retryable row instead of a lost
 * job; a BullMQ worker takes over when `apps/worker` exists (doc 08 §3.6).
 */
export class BackgroundRunner {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly onError: (name: string, err: unknown) => void = () => undefined) {}

  run(name: string, job: () => Promise<void>): void {
    const p = job()
      .catch((err: unknown) => this.onError(name, err))
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  /** Resolves when every job started so far (and any it started) has finished. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }
}
