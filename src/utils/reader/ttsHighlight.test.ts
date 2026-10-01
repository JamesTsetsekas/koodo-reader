jest.mock("../../assets/lib/kookit-extra-browser.min", () => {
  const values: Record<string, string> = { ttsHighlightTextColor: "#000000", searchHighlightTextColor: "#000000" };
  return {
    ConfigService: { getReaderConfig: (key: string) => values[key] },
    HighlightUtil: class {
      getTtsHighlightValue() { return { styleType: "background", color: "#FF9900" }; }
      buildTtsHighlightStyle() { return "background: #FF9900;"; }
      getSearchHighlightValue() { return { styleType: "background", color: "#D8D8D8" }; }
      buildSearchHighlightStyle() { return "background: #D8D8D8;"; }
    },
  };
});
import SpeechHighlighter, { ttsHighlightStyle, searchHighlightStyle, findVisibleSpeechIndex } from "./ttsHighlight";

beforeEach(() => {
  document.body.innerHTML = "";
  (Range.prototype as any).getBoundingClientRect = () => ({ left: 1, right: 10, top: 1, bottom: 10 });
});

test("orange background and dark text override the night-mode theme", () => {
  expect(ttsHighlightStyle()).toContain("background-color: #FF9900 !important");
  expect(ttsHighlightStyle()).toContain("color: #000000 !important");
  expect(ttsHighlightStyle()).toContain("-webkit-text-fill-color: #000000 !important");
});

test("search highlight background and text colors are independently applied", () => {
  expect(searchHighlightStyle()).toContain("background-color: #D8D8D8 !important");
  expect(searchHighlightStyle()).toContain("color: #000000 !important");
  expect(searchHighlightStyle(true)).not.toContain("-webkit-text-fill-color");
});

test("highlights sentences across inline markup and retains formatting", () => {
  document.body.innerHTML = "<p>Before. The <b>orange</b> fox jumps. After.</p>";
  const highlighter = new SpeechHighlighter();
  highlighter.highlight({ getDocument: () => document }, "The orange fox jumps.", false, 0);
  expect(Array.from(document.querySelectorAll("[data-koodo-tts]")).map((el) => el.textContent).join("")).toBe("The orange fox jumps.");
  expect(document.querySelector("b [data-koodo-tts]")?.textContent).toBe("orange");
  highlighter.clear();
  expect(document.querySelector("b")?.textContent).toBe("orange");
  expect(document.body.textContent).toBe("Before. The orange fox jumps. After.");
});

test("repeated sentences follow document order and resume does not skip", () => {
  document.body.innerHTML = "<p>Yes.</p><p>Yes.</p><p>Done.</p>";
  const highlighter = new SpeechHighlighter();
  const rendition = { getDocument: () => document };
  highlighter.highlight(rendition, "Yes.", false, 0);
  expect(document.querySelector("p:first-child [data-koodo-tts]")).not.toBeNull();
  highlighter.highlight(rendition, "Yes.", false, 1);
  expect(document.querySelector("p:nth-child(2) [data-koodo-tts]")).not.toBeNull();
  highlighter.highlight(rendition, "Yes.", false, 1);
  expect(document.querySelector("p:nth-child(2) [data-koodo-tts]")).not.toBeNull();
});

test("a tall scrolled iframe starts at the visible sentence, not the chapter heading", () => {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = "<p>Heading.</p><p>Earlier text.</p><p>Visible text.</p><p>Later text.</p>";
  iframe.getBoundingClientRect = () => ({ top: -1800, bottom: 4200, left: 0, right: 800, width: 800, height: 6000, x: 0, y: -1800, toJSON() {} });
  Object.defineProperty(doc.defaultView, "innerHeight", { value: 6000 });
  (doc.defaultView as any).Range.prototype.getClientRects = function () {
    const text = this.startContainer.textContent;
    const top = text === "Visible text." ? 1850 : text === "Later text." ? 5000 : 20;
    return [{ top, bottom: top + 30, left: 10, right: 300 }];
  };
  expect(findVisibleSpeechIndex({ getDocument: () => doc }, ["Heading.", "Earlier text.", "Visible text.", "Later text."])).toBe(2);
  expect(findVisibleSpeechIndex({ getDocument: () => doc }, ["Heading.", "Earlier text.", "Visible text.", "Later text."], true)).toBe(2);
});
