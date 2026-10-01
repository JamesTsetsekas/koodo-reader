import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import HighlightPalette from "./component";

test("custom picker sits beside presets, saves a full hex color and supports original text", () => {
  const host = document.createElement("div");
  const onChange = jest.fn();
  act(() => { ReactDOM.render(<HighlightPalette label="TTS highlighted text color" value="#000000"
    presets={["#000000", "#FFFFFF"]} onChange={onChange} allowOriginal />, host); });
  const custom = host.querySelector<HTMLButtonElement>('[aria-label="Custom tts highlighted text color"]')!;
  expect(custom.parentElement?.querySelectorAll(".highlight-palette-swatch").length).toBe(2);
  act(() => { custom.click(); });
  expect(host.querySelector(".react-colorful")).not.toBeNull();
  const input = host.querySelector<HTMLInputElement>("input")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "#123ABC");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("#123ABC");
  act(() => { host.querySelector<HTMLButtonElement>(".highlight-palette-original")!.click(); });
  expect(onChange).toHaveBeenLastCalledWith("");
  act(() => { ReactDOM.unmountComponentAtNode(host); });
});
