jest.mock("../common", () => ({ getAllVoices: () => [], getFormatFromAudioPath: () => "wav" }));
jest.mock("../request/reader", () => ({ getTTSAudio: jest.fn() }));
jest.mock("howler", () => ({
  Howl: class {
    events: Record<string, { fn: (...args: any[]) => void; once: boolean }[]> = {};
    loaded = false;
    on(name: string, fn: (...args: any[]) => void) { (this.events[name] ||= []).push({ fn, once: false }); }
    once(name: string, fn: (...args: any[]) => void) { (this.events[name] ||= []).push({ fn, once: true }); }
    off(name: string, fn: (...args: any[]) => void) { this.events[name] = (this.events[name] || []).filter((handler) => handler.fn !== fn); }
    emit(name: string) { for (const handler of [...(this.events[name] || [])]) { if (handler.once) this.off(name, handler.fn); handler.fn(); } }
    state() { return this.loaded ? "loaded" : "unloaded"; }
    load() { this.loaded = true; void Promise.resolve().then(() => this.emit("load")); }
    play() { this.emit("play"); void Promise.resolve().then(() => this.emit("end")); }
    duration() { return 0.001; }
    seek() { return 0; }
    pause() {}
    unload() {}
  },
}));
import TTSUtil from "./ttsUtil";

const plugin: any = { key: "local", voiceList: [{ name: "test", config: {} }] };
const nodes = (count: number) => Array.from({ length: count }, (_, index) => ({ text: String(index), voiceName: "test", voiceEngine: "local" }));
const invoke = jest.fn();
beforeEach(async () => {
  await TTSUtil.stopAudio();
  invoke.mockReset();
  (window as any).require = () => ({ ipcRenderer: { invoke } });
});

test("starts with one ready sentence and waits for pending second sentence", async () => {
  let finishSecond: (path: string) => void = () => {};
  invoke.mockImplementation((_channel, request) => request.text === "1" ? new Promise((resolve) => { finishSecond = resolve; }) : Promise.resolve(request.text + ".wav"));
  const list = nodes(20);
  expect(await TTSUtil.cacheAudio(0, 0, [plugin], list, 10, true, false)).toBe("ready");
  expect(invoke.mock.calls.length).toBeLessThanOrEqual(2);
  const onPlay = jest.fn();
  expect(await TTSUtil.readAloud(0, onPlay)).toBe("end");
  expect(onPlay).toHaveBeenCalledTimes(1);
  const second = TTSUtil.cacheAudio(1, 0, [plugin], list, 1, false, false);
  finishSecond("1.wav");
  expect(await second).toBe("ready");
  expect(await TTSUtil.readAloud(1)).toBe("end");
});

test("transient synthesis failure retries and a 400-sentence reading remains bounded", async () => {
  let failed = false;
  invoke.mockImplementation((_channel, request) => {
    if (request.text === "4" && !failed) { failed = true; return Promise.reject(new Error("temporary disconnect")); }
    return Promise.resolve(request.text + ".wav");
  });
  const list = nodes(400);
  for (let index = 0; index < list.length; index++) {
    expect(await TTSUtil.cacheAudio(index, 25, [plugin], list, 1, false, false)).toBe("ready");
    expect(await TTSUtil.readAloud(index)).toBe("end");
    expect(TTSUtil.audioPaths.length).toBeLessThanOrEqual(6);
  }
  expect(failed).toBe(true);
});

test("late audio from an old book is cancelled before a restarted book plays", async () => {
  let finish: (path: string) => void = () => {};
  invoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockImplementation((_channel, request) => Promise.resolve(request.text + ".wav"));
  const old = TTSUtil.cacheAudio(0, 0, [plugin], nodes(2), 1, true, false);
  await TTSUtil.stopAudio();
  const currentNodes = [{ text: "new chapter", voiceName: "test", voiceEngine: "local" }];
  const current = TTSUtil.cacheAudio(0, 0, [plugin], currentNodes, 1, true, false);
  finish("old chapter.wav");
  expect(await old).toBe("cancelled");
  expect(await current).toBe("ready");
  expect(TTSUtil.audioPaths[0].audioPath).toBe("new chapter.wav");
});
