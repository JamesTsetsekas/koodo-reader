import React, { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";
import "./highlightPalette.css";

interface Props {
  label: string;
  value: string;
  presets: readonly string[];
  onChange: (color: string) => void;
  allowOriginal?: boolean;
}

/** Independent, immediately saved highlight colors; never changes the UI theme. */
export default function HighlightPalette({ label, value, presets, onChange, allowOriginal = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "#000000");
  useEffect(() => { setDraft(value || "#000000"); }, [value]);
  const select = (color: string) => { onChange(color); setOpen(false); };
  return (
    <div className="highlight-palette" role="group" aria-label={label}>
      <div className="highlight-palette-label">{label}</div>
      <div className="highlight-palette-swatches">
        {allowOriginal && <button type="button" className="highlight-palette-original" aria-pressed={!value}
          onClick={() => select("")}>Original text</button>}
        {presets.map((color) => <button type="button" key={color}
          className="highlight-palette-swatch" style={{ backgroundColor: color }}
          title={color} aria-label={`${label} ${color}`} aria-pressed={value.toUpperCase() === color.toUpperCase()}
          onClick={() => select(color)} />)}
        <button type="button" className="highlight-palette-custom" aria-label={`Custom ${label.toLowerCase()}`}
          aria-expanded={open} onClick={() => setOpen(!open)}>Custom…</button>
        <span className="highlight-palette-value">{value || "Original"}</span>
      </div>
      {open && <div className="highlight-palette-picker">
        <HexColorPicker color={value || "#000000"} onChange={onChange} />
        <label className="highlight-palette-hex">Hex color
          <input aria-label={`${label} hex color`} value={draft} spellCheck={false} maxLength={7}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              if (/^#[a-f0-9]{6}$/i.test(next)) onChange(next.toUpperCase());
            }} onBlur={() => setDraft(value || "#000000")} />
        </label>
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>}
    </div>
  );
}
