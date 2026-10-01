export class SpeechCancelled extends Error {}

/** One synthesis worker. Foreground requests join/promote pending prefetches. */
export default class SpeechQueue<T> {
  private generation = 0;
  private running = false;
  private jobs: {
    key: string;
    generation: number;
    work: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
  }[] = [];
  private pending = new Map<string, Promise<T>>();
  private cache = new Map<string, T>();

  reset() {
    this.generation++;
    this.jobs.splice(0).forEach((job) => job.reject(new SpeechCancelled()));
    this.pending.clear();
    this.cache.clear();
  }

  request(key: string, work: () => Promise<T>, foreground = true): Promise<T> {
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key)!);
    const existing = this.pending.get(key);
    if (existing) {
      if (foreground) {
        const index = this.jobs.findIndex((job) => job.key === key);
        if (index > 0) this.jobs.unshift(this.jobs.splice(index, 1)[0]);
      }
      return existing;
    }
    const generation = this.generation;
    const promise = new Promise<T>((resolve, reject) => {
      const job = { key, generation, work, resolve, reject };
      if (foreground) this.jobs.unshift(job);
      else this.jobs.push(job);
    });
    this.pending.set(key, promise);
    void this.pump();
    return promise;
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        try {
          if (job.generation !== this.generation) throw new SpeechCancelled();
          const value = await job.work();
          if (job.generation !== this.generation) throw new SpeechCancelled();
          this.cache.set(job.key, value);
          if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
          job.resolve(value);
        } catch (error) {
          job.reject(error);
        } finally {
          if (job.generation === this.generation) this.pending.delete(job.key);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
