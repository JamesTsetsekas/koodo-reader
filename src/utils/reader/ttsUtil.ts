import { Howl } from "howler";
import PluginModel from "../../models/Plugin";
import { getAllVoices, getFormatFromAudioPath } from "../common";
import { getTTSAudio } from "../request/reader";
import SpeechQueue, { SpeechCancelled } from "./speechQueue";

type AudioNode = { text: string; voiceName: string; voiceEngine: string };

class TTSUtil {
  static player: any;
  static audioPaths: { index: number; audioPath: string }[] = [];
  static isPaused = false;
  static pausedMidSentence = false;
  static processingIndexes = new Set<number>();
  private static queue = new SpeechQueue<string>();
  private static nodes: AudioNode[] | null = null;
  private static speed: number | null = null;
  private static session = 0;
  private static settlePlayback: ((result: string) => void) | null = null;
  private static playerPath = "";

  static async readAloud(currentIndex: number, onPlay?: () => void) {
    const audioPath = this.audioPaths.find((item) => item.index === currentIndex)?.audioPath;
    if (!audioPath) return "loaderror";
    const resume = this.pausedMidSentence && this.playerPath === audioPath;
    this.cancelPlayback(false);
    if (!resume && this.player) this.player.unload();
    this.pausedMidSentence = false;
    this.isPaused = false;
    const session = this.session;
    return new Promise<string>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let finished = false;
      const finish = (result: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        sound.off("end", end);
        sound.off("play", play);
        sound.off("loaderror", failed);
        sound.off("playerror", failed);
        if (this.settlePlayback === finish) this.settlePlayback = null;
        resolve(result);
      };
      const end = () => finish("end");
      const failed = (_id?: number, error?: any) => {
        console.error("TTS playback failed", error);
        finish("loaderror");
      };
      const play = () => {
        if (session !== this.session || this.isPaused) {
          sound.pause();
          finish("cancelled");
          return;
        }
        clearTimeout(timer);
        onPlay?.();
        const remaining = sound.duration() - (Number(sound.seek()) || 0);
        timer = setTimeout(() => finish("loaderror"), Math.max(30000, remaining * 1000 + 15000));
      };
      const sound = resume ? this.player : new Howl({
        src: [audioPath],
        format: [getFormatFromAudioPath(audioPath)],
        preload: false,
      });
      this.player = sound;
      this.playerPath = audioPath;
      this.settlePlayback = finish;
      sound.once("end", end);
      sound.on("play", play);
      sound.once("loaderror", failed);
      sound.once("playerror", failed);
      timer = setTimeout(() => finish("loaderror"), 60000);
      if (sound.state() === "loaded") sound.play();
      else {
        sound.once("load", () => {
          if (!finished && session === this.session && !this.isPaused) sound.play();
        });
        sound.load();
      }
    });
  }

  static async cacheAudio(
    startIndex: number, speed: number, plugins: PluginModel[], nodes: AudioNode[],
    targetCacheCount: number, isFirst: boolean, _isOfficialAIVoice: boolean
  ) {
    if (this.nodes !== nodes || this.speed !== speed) {
      this.setAudioPaths();
      this.nodes = nodes;
      this.speed = speed;
    }
    const session = this.session;
    const ensure = async (index: number, foreground: boolean) => {
      const node = nodes[index];
      if (!node || node.voiceEngine === "system") return;
      const key = JSON.stringify([index, node.text, node.voiceName, node.voiceEngine, speed]);
      const path = await this.queue.request(key, async () => {
        const plugin = plugins.find((item) => item.key === node.voiceEngine);
        const voice = (plugin?.voiceList as any[])?.find((item) => item.name === node.voiceName);
        if (!plugin || !voice) throw new Error("TTS voice is missing");
        let lastError: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (session !== this.session) throw new SpeechCancelled();
          try {
            const audioPath = await this.getAudioPath(node.text, speed, node.voiceEngine, plugin, voice, isFirst);
            if (!audioPath) throw new Error("TTS returned no audio");
            return audioPath;
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        throw lastError;
      }, foreground);
      if (session !== this.session) throw new SpeechCancelled();
      this.audioPaths = this.audioPaths.filter((item) => item.index !== index && item.index >= startIndex - 2);
      this.audioPaths.push({ index, audioPath: path });
    };
    try {
      if (targetCacheCount > 0) await ensure(startIndex, true);
      for (let i = startIndex + 1; i < Math.min(nodes.length, startIndex + 3); i++) {
        void ensure(i, false).catch((error) => {
          if (!(error instanceof SpeechCancelled)) console.warn("TTS prefetch will retry on demand", error);
        });
      }
      return session === this.session ? "ready" : "cancelled";
    } catch (error) {
      if (error instanceof SpeechCancelled) return "cancelled";
      console.error("TTS synthesis failed", error);
      return "error";
    }
  }

  private static cancelPlayback(pause: boolean) {
    this.settlePlayback?.("cancelled");
    this.settlePlayback = null;
    if (pause && this.player) this.player.pause();
  }
  static async pauseAudio() {
    this.pausedMidSentence = !!this.player && this.player.state() === "loaded";
    this.isPaused = true;
    this.cancelPlayback(true);
  }
  static resumeAudio(): boolean { return false; }
  static async stopAudio() {
    this.cancelPlayback(true);
    if (this.player) this.player.unload();
    this.player = null;
    this.playerPath = "";
    this.setAudioPaths();
    this.isPaused = true;
  }
  // Content-addressed files must not be erased by an old playback session.
  static async clearAudioPaths() {}
  static getAudioPaths() { return this.audioPaths; }
  static async getAudioPath(text: string, speed: number, engine: string, plugin, voice, isFirst: boolean) {
    if (engine === "official-ai-voice-plugin") {
      const res = await getTTSAudio(text, voice.language, voice.name, (speed + 100) / 100, 1, isFirst);
      return res?.data?.audio_base64 || "";
    }
    return window.require("electron").ipcRenderer.invoke("generate-tts", {
      text, speed, plugin, config: voice.config,
    });
  }
  static setAudioPaths() {
    this.session++;
    this.cancelPlayback(true);
    this.queue.reset();
    this.audioPaths = [];
    this.processingIndexes.clear();
    this.nodes = null;
    this.speed = null;
    this.pausedMidSentence = false;
    this.isPaused = false;
  }
  static getPlayer() { return this.player; }
  static getVoiceList(plugins: PluginModel[]) { return getAllVoices(plugins); }
}
export default TTSUtil;
