import SpeechQueue, { SpeechCancelled } from "./speechQueue";

test("foreground joins an unfinished prefetch instead of reporting missing audio", async () => {
  const queue = new SpeechQueue<string>();
  let finish: (value: string) => void = () => {};
  const work = jest.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const prefetched = queue.request("sentence", work, false);
  const required = queue.request("sentence", work, true);
  expect(required).toBe(prefetched);
  expect(work).toHaveBeenCalledTimes(1);
  finish("audio.wav");
  await expect(required).resolves.toBe("audio.wav");
});

test("stop/start rejects old jobs and cannot overwrite the new sentence at index zero", async () => {
  const queue = new SpeechQueue<string>();
  let finish: (value: string) => void = () => {};
  const old = queue.request("0", () => new Promise<string>((resolve) => { finish = resolve; }));
  const oldRejected = expect(old).rejects.toBeInstanceOf(SpeechCancelled);
  queue.reset();
  const current = queue.request("0", async () => "new.wav");
  finish("old.wav");
  await oldRejected;
  await expect(current).resolves.toBe("new.wav");
  await expect(queue.request("0", async () => "incorrect.wav")).resolves.toBe("new.wav");
});

test("one worker runs even across cancellation and foreground is promoted", async () => {
  const queue = new SpeechQueue<number>();
  const order: number[] = [];
  let finish: () => void = () => {};
  const first = queue.request("first", () => new Promise<number>((resolve) => { finish = () => { order.push(0); resolve(0); }; }));
  const second = queue.request("second", async () => { order.push(2); return 2; }, false);
  const third = queue.request("third", async () => { order.push(3); return 3; }, false);
  queue.request("third", async () => 3, true);
  finish();
  await Promise.all([first, second, third]);
  expect(order).toEqual([0, 3, 2]);
});

test("failed synthesis is retryable and long reads keep a bounded cache", async () => {
  const queue = new SpeechQueue<number>();
  await expect(queue.request("bad", async () => { throw new Error("temporary"); })).rejects.toThrow("temporary");
  await expect(queue.request("bad", async () => 42)).resolves.toBe(42);
  for (let i = 0; i < 1500; i++) await expect(queue.request(String(i), async () => i)).resolves.toBe(i);
  expect((queue as any).cache.size).toBeLessThanOrEqual(32);
});
