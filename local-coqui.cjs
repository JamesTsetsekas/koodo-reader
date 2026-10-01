const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const axios = require("axios");

function validWav(file) {
  try {
    const data = fs.readFileSync(file);
    return data.length > 44 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE";
  } catch { return false; }
}

// All renderer windows share one worker. This also deduplicates voice previews.
function createCoquiGenerator(uploads) {
  const directory = path.join(uploads, "tts-local");
  const pending = new Map();
  let tail = Promise.resolve();
  return ({ text, speed, config = {} }) => {
    const url = config.url || "http://127.0.0.1:5002/api/tts";
    const rate = Math.max(0.25, Math.min(8, ((Number(speed) || 0) + 100) / 100));
    const options = { text, speaker_id: config.speaker_id || "p225", language_id: config.language_id || "", style_wav: config.style_wav || "" };
    const originalHash = crypto.createHash("sha256").update(JSON.stringify([url, options])).digest("hex");
    const original = path.join(directory, originalHash + ".base.wav");
    const hash = crypto.createHash("sha256").update(JSON.stringify([originalHash, rate])).digest("hex");
    const file = path.join(directory, hash + ".wav");
    if (pending.has(hash)) return pending.get(hash);
    if (validWav(file)) { fs.utimesSync(file, new Date(), new Date()); return Promise.resolve(file); }
    const work = tail.catch(() => {}).then(async () => {
      fs.mkdirSync(directory, { recursive: true });
      if (!validWav(original)) {
        const response = await axios.get(url, { params: options, responseType: "arraybuffer", timeout: 90000 });
        const buffer = Buffer.from(response.data);
        if (buffer.length <= 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
          throw new Error("Coqui did not return a valid WAV");
        }
        fs.writeFileSync(original + ".part", buffer);
        fs.renameSync(original + ".part", original);
      }
      fs.utimesSync(original, new Date(), new Date());
      const temporary = file + ".part.wav";
      try {
        if (rate === 1) fs.copyFileSync(original, temporary);
        else {
          await new Promise((resolve, reject) => execFile("/usr/bin/sox", [original, temporary, "tempo", "-s", String(rate)], { timeout: 30000 }, (error) => error ? reject(error) : resolve()));
          if (!validWav(temporary)) throw new Error("Speed conversion returned invalid audio");
        }
        fs.renameSync(temporary, file);
        // Keep a bounded disk cache for whole-book sessions. Recently used files
        // are retained, including the tiny playback/prefetch window.
        const files = fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}(\.base)?\.wav$/.test(name));
        if (files.length > 512) {
          const oldest = files.map((name) => ({ name, age: fs.statSync(path.join(directory, name)).mtimeMs })).sort((a, b) => a.age - b.age);
          for (const item of oldest.slice(0, files.length - 512)) {
            if (Date.now() - item.age > 3600000) fs.unlinkSync(path.join(directory, item.name));
          }
        }
        return file;
      } catch (error) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        throw error;
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    });
    pending.set(hash, work);
    tail = work.catch(() => {});
    void work.finally(() => pending.delete(hash)).catch(() => {});
    return work;
  };
}
module.exports = { createCoquiGenerator, validWav };
