import { ConfigService, HighlightUtil } from "../../assets/lib/kookit-extra-browser.min";

const presets = ["#F3C9C9", "#FEF3CD", "#CEFACD", "#CDE9FA", "#FF9900", "#D8D8D8", "#FFFFFF"];
export const ttsBackgroundPresets = presets;
export const highlightHelper = new HighlightUtil(ConfigService);
function customHighlightStyle(kind: "tts" | "search", isPdf: boolean) {
  const value = kind === "tts" ? highlightHelper.getTtsHighlightValue() : highlightHelper.getSearchHighlightValue();
  let style = kind === "tts" ? highlightHelper.buildTtsHighlightStyle(isPdf) : highlightHelper.buildSearchHighlightStyle(isPdf);
  const foreground = ConfigService.getReaderConfig(`${kind}HighlightTextColor`);
  if (foreground && /^#[a-f0-9]{6}$/i.test(foreground) && !isPdf) {
    // Reader theme colors use !important; the speaking text must override them.
    style += `color: ${foreground} !important; -webkit-text-fill-color: ${foreground} !important; text-shadow: none !important;`;
  }
  if (value.styleType === "background" && !isPdf) style += `background-color: ${value.color} !important;`;
  return style;
}
export const ttsHighlightStyle = (isPdf = false) => customHighlightStyle("tts", isPdf);
export const searchHighlightStyle = (isPdf = false) => customHighlightStyle("search", isPdf);

// Scroll-mode iframes can be as tall as an entire chapter. innerHeight alone
// therefore treats off-screen paragraphs as visible. Include the parent clip.
function visibleBounds(doc: Document) {
  const view = doc.defaultView;
  let left = 0, top = 0, right = view?.innerWidth || 0, bottom = view?.innerHeight || 0;
  const iframe = view?.frameElement;
  if (iframe) {
    const rect = iframe.getBoundingClientRect();
    const parent = iframe.ownerDocument.defaultView;
    left = Math.max(left, -rect.left); top = Math.max(top, -rect.top);
    right = Math.min(right, (parent?.innerWidth || right) - rect.left);
    bottom = Math.min(bottom, (parent?.innerHeight || bottom) - rect.top);
    for (let ancestor = iframe.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = parent?.getComputedStyle(ancestor);
      if (!style || !/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
      const clip = ancestor.getBoundingClientRect();
      left = Math.max(left, clip.left - rect.left); top = Math.max(top, clip.top - rect.top);
      right = Math.min(right, clip.right - rect.left); bottom = Math.min(bottom, clip.bottom - rect.top);
    }
  }
  return { left, top, right, bottom };
}

function textIndex(doc: Document) {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  let raw = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("script,style,rt,[hidden],[aria-hidden=true],.kookit-translator")) continue;
    nodes.push({ node, start: raw.length, end: raw.length + node.length }); raw += node.data;
  }
  const offsets: number[] = [];
  let normalized = "";
  for (let i = 0; i < raw.length; i++) {
    const char = /\s/.test(raw[i]) ? " " : raw[i];
    if (char === " " && normalized.endsWith(" ")) continue;
    normalized += char; offsets.push(i);
  }
  return { nodes, offsets, normalized };
}

export function findVisibleSpeechIndex(rendition: any, sentences: string[], last = false) {
  const doc: Document = rendition.getDocument();
  if (!doc) return -1;
  const { nodes, offsets, normalized } = textIndex(doc);
  const bounds = visibleBounds(doc);
  let cursor = 0, result = -1;
  for (let index = 0; index < sentences.length; index++) {
    const needle = sentences[index].replace(/\s+/g, " ").trim();
    if (!needle) continue;
    const start = normalized.indexOf(needle, cursor);
    if (start < 0) continue;
    cursor = start + needle.length;
    const from = nodes.find(part => part.start <= offsets[start] && part.end > offsets[start]);
    const end = offsets[start + needle.length - 1] + 1;
    const to = nodes.find(part => part.start < end && part.end >= end);
    if (!from || !to) continue;
    const range = doc.createRange();
    range.setStart(from.node, offsets[start] - from.start); range.setEnd(to.node, end - to.start);
    if (Array.from(range.getClientRects()).some(rect => rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom)) {
      if (!last) return index;
      result = index;
    }
  }
  return result;
}

/** Match normalized text in document order, including inline markup. */
export default class SpeechHighlighter {
  private document: Document | null = null;
  private cursor = 0;
  private lastText = "";
  private lastStart = 0;
  private lastIndex = -1;
  reset() { this.clear(); this.cursor = 0; this.lastText = ""; this.lastIndex = -1; }
  clear() {
    this.document?.querySelectorAll("span[data-koodo-tts]").forEach((span) => {
      span.replaceWith(...Array.from(span.childNodes));
    });
  }
  highlight(rendition: any, text: string, isPdf: boolean, index = 0) {
    if (isPdf) { rendition.highlightAudioNode(text, ttsHighlightStyle(true)); return; }
    const doc: Document = rendition.getDocument();
    if (!doc) return;
    if (doc !== this.document) { this.reset(); this.document = doc; }
    this.clear();
    const { nodes, offsets, normalized } = textIndex(doc);
    const bounds = visibleBounds(doc);
    const needle = text.replace(/\s+/g, " ").trim();
    let start = normalized.indexOf(needle, text === this.lastText && index === this.lastIndex ? this.lastStart : this.cursor);
    if (this.lastIndex === -1 && start >= 0) {
      // A chapter can contain the same sentence more than once. Prefer an
      // occurrence on the current visible page when starting halfway through.
      for (let candidate = start; candidate >= 0; candidate = normalized.indexOf(needle, candidate + 1)) {
        const part = nodes.find((part) => part.start <= offsets[candidate] && part.end > offsets[candidate]);
        if (!part) continue;
        const range = doc.createRange();
        range.setStart(part.node, offsets[candidate] - part.start);
        range.setEnd(part.node, Math.min(part.node.length, offsets[candidate] - part.start + 1));
        const rect = range.getBoundingClientRect();
        if (rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom) { start = candidate; break; }
      }
    }
    // Do not jump to an earlier repeated sentence; preserve the reading position.
    if (start < 0 || !needle) return;
    this.lastText = text;
    this.lastIndex = index;
    this.lastStart = start;
    this.cursor = start + needle.length;
    const from = offsets[start], to = offsets[start + needle.length - 1] + 1;
    for (const part of nodes.reverse()) {
      const left = Math.max(0, from - part.start), right = Math.min(part.node.length, to - part.start);
      if (right <= left) continue;
      const range = doc.createRange();
      range.setStart(part.node, left); range.setEnd(part.node, right);
      const span = doc.createElement("span");
      span.setAttribute("data-koodo-tts", "true");
      span.setAttribute("style", ttsHighlightStyle());
      range.surroundContents(span);
    }
  }
}
