// Conditional refont: the text between two markers takes the font of
// another style (font, weight, faux styles and colour, never the size).
// Applied to TypeR's parsed rich text ({ text, richTextRuns }) before the
// paste, so the classic paste honours it too. Inspired by MD TYPER's
// conditional-refont.js.
//
// rule = { open, close, keepMarkers, styleId }; the panel turns styleId into
// textStyle (see refontTextStyle).

const FONT_FIELDS = ["fontPostScriptName", "fontName", "fontStyleName", "syntheticBold", "syntheticItalic"];

// The run override taken from a TypeR style: font fields and colour
export const refontTextStyle = (style) => {
  const source = style && style.textProps && style.textProps.layerText &&
    style.textProps.layerText.textStyleRange && style.textProps.layerText.textStyleRange[0] &&
    style.textProps.layerText.textStyleRange[0].textStyle;
  if (!source || !source.fontPostScriptName) return null;
  const out = {};
  for (let i = 0; i < FONT_FIELDS.length; i++) {
    if (typeof source[FONT_FIELDS[i]] !== "undefined") out[FONT_FIELDS[i]] = source[FONT_FIELDS[i]];
  }
  if (source.color) out.color = { ...source.color };
  return out;
};

export const normalizeRefontRules = (rules) => {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (let i = 0; i < rules.length && out.length < 16; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== "object") continue;
    const open = typeof rule.open === "string" ? rule.open.slice(0, 8) : "";
    const close = typeof rule.close === "string" ? rule.close.slice(0, 8) : "";
    if (!open || !close) continue;
    out.push({
      open,
      close,
      keepMarkers: rule.keepMarkers === true,
      styleId: typeof rule.styleId === "string" || typeof rule.styleId === "number" ? rule.styleId : null,
    });
  }
  return out;
};

const sameStyle = (a, b) => (a === b) || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

// applyRefont({ text, richTextRuns }, [{ open, close, keepMarkers, textStyle }])
export const applyRefont = (parsed, rules) => {
  const text = parsed && typeof parsed.text === "string" ? parsed.text : "";
  const active = (rules || []).filter((rule) => rule && rule.open && rule.close && rule.textStyle);
  if (!text || !active.length) return parsed;
  // Character attributes from the markdown runs
  const chars = [];
  const runs = parsed.richTextRuns;
  if (Array.isArray(runs) && runs.length) {
    for (let r = 0; r < runs.length; r++) {
      const run = runs[r] || {};
      const runText = String(run.text || "");
      for (let i = 0; i < runText.length; i++) {
        chars.push({ ch: runText.charAt(i), bold: !!run.bold, italic: !!run.italic, textStyle: run.textStyle || null });
      }
    }
  }
  if (chars.length !== text.length) {
    chars.length = 0;
    for (let i = 0; i < text.length; i++) chars.push({ ch: text.charAt(i), bold: false, italic: false, textStyle: null });
  }
  let changed = false;
  for (let r = 0; r < active.length; r++) {
    const rule = active[r];
    let at = 0;
    for (;;) {
      const current = chars.map((c) => c.ch).join("");
      const start = current.indexOf(rule.open, at);
      if (start < 0) break;
      const end = current.indexOf(rule.close, start + rule.open.length);
      if (end < 0) break;
      const innerFrom = start + rule.open.length;
      const styleFrom = rule.keepMarkers ? start : innerFrom;
      const styleTo = rule.keepMarkers ? end + rule.close.length : end;
      for (let i = styleFrom; i < styleTo; i++) chars[i].textStyle = rule.textStyle;
      if (!rule.keepMarkers) {
        chars.splice(end, rule.close.length);
        chars.splice(start, rule.open.length);
        at = end - rule.open.length;
      } else {
        at = end + rule.close.length;
      }
      changed = true;
    }
  }
  if (!changed) return parsed;
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const last = out[out.length - 1];
    if (last && last.bold === c.bold && last.italic === c.italic && sameStyle(last.textStyle || null, c.textStyle || null)) last.text += c.ch;
    else out.push({ text: c.ch, bold: c.bold, italic: c.italic, ...(c.textStyle ? { textStyle: c.textStyle } : {}) });
  }
  return { text: out.map((run) => run.text).join(""), richTextRuns: out };
};
