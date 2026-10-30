// Text graph for the smart paste: every possible line of the translation is
// an edge between two break points, with its own style runs and a measuring
// key. composeText turns the solver's choice back into Photoshop text
// parameters (point text, centred, at the chosen size and position).
// Ported from MD TYPER's legacy-text-core.js, with the author's permission.
//
// The payload is TypeR's own: { text, style: { textProps, stroke },
// richTextRuns: [{ text, bold, italic, textStyle }], direction }.


const clone = (value) => JSON.parse(JSON.stringify(value));

// Interned measuring keys: long serialized styles become short ids
let identityBuckets = {};
let identityCount = 0;
let identitySerial = 0;
const internKey = (value) => {
  const text = String(value);
  const bucketKey = "l" + text.length;
  let bucket = identityBuckets[bucketKey];
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) if (bucket[i].value === text) return bucket[i].key;
  }
  if (identityCount >= 32768) {
    identityBuckets = {};
    identityCount = 0;
    bucket = null;
  }
  if (!bucket) bucket = identityBuckets[bucketKey] = [];
  const key = "k" + ++identitySerial;
  bucket.push({ value: text, key });
  identityCount++;
  return key;
};

export const stableKey = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableKey).join(",") + "]";
  const keys = Object.keys(value).filter((key) => typeof value[key] !== "undefined").sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableKey(value[key])).join(",") + "}";
};

const setDirection = (params, direction, length) => {
  if (!direction) return;
  const ranges = params.layerText.paragraphStyleRange || [];
  for (let i = 0; i < ranges.length; i++) {
    const style = ranges[i].paragraphStyle || {};
    style.directionType = direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
    // Right-to-left needs the World-Ready composer; left-to-right keeps the style's
    if (direction === "rtl") style.textComposerEngine = "textOptycaComposer";
    ranges[i].paragraphStyle = style;
    ranges[i].from = typeof ranges[i].from === "number" ? ranges[i].from : 0;
    ranges[i].to = length;
  }
};

// Default rich-run styling when no font list is available: synthetic faces
const syntheticRunStyle = (base, run) => {
  const copy = clone(base);
  if (run.bold) copy.syntheticBold = true;
  if (run.italic) copy.syntheticItalic = true;
  return copy;
};

// One text style per character: the style's own ranges, then the rich runs
// (markdown bold/italic, conditional refont) on top
const characterStyles = (data, resolveRunStyle) => {
  const source = String(data.text || "");
  const layer = data.style.textProps.layerText;
  const base = layer.textStyleRange[0].textStyle;
  const out = [];
  for (let i = 0; i < source.length; i++) out.push(base);
  for (let i = 0; i < layer.textStyleRange.length; i++) {
    const r = layer.textStyleRange[i];
    for (let j = Math.max(0, r.from); j < Math.min(source.length, r.to); j++) out[j] = r.textStyle;
  }
  const runs = data.richTextRuns || [];
  let offset = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] || {};
    const from = typeof run.from === "number" ? run.from : offset;
    const to = typeof run.to === "number" ? run.to : from + String(run.text || "").length;
    offset = to;
    if (!run.bold && !run.italic && !run.textStyle && !run.noBreak) continue;
    let prior = null;
    let copy = null;
    for (let j = Math.max(0, from); j < Math.min(source.length, to); j++) {
      if (out[j] !== prior) {
        prior = out[j];
        copy = (resolveRunStyle || syntheticRunStyle)(prior, run);
        if (run.textStyle) {
          const extra = run.textStyle;
          for (const key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) copy[key] = extra[key];
        }
        if (run.noBreak) copy.noBreak = true;
      }
      out[j] = copy;
    }
  }
  return out;
};

const COMMON_OPENINGS = /^(Abandoning|Surveillance|Extraordinary|Unbelievable|Everything|Something|Information|Communication|Congratulations|Unfortunately|Nevertheless|Understanding|Remembering|Continuing|Unexpected|Incredible|Perhaps|Farewell|Tomorrow|Yesterday|Remember|Everyone|Somewhere|Anything|Nothing|Welcome|Together|However|Because|Another|Already|Always|Without|Between|Before|Afterward|Suddenly|Finally|Actually|Really|Please)$/;

// Names and acronyms are never hyphenated nor broken at their own hyphen. A
// capitalized word that opens a sentence is not taken for a name (TypeR:
// French scripts capitalize any first word)
const sentenceStart = (source, index) => {
  let i = index - 1;
  while (i >= 0 && /[ \t"'«“(\[]/.test(source.charAt(i))) i--;
  return i < 0 || /[.!?…\r\n]/.test(source.charAt(i));
};
const protectedCharacters = (source, styles, data) => {
  const out = [];
  for (let i = 0; i < source.length; i++) out[i] = styles[i].noBreak === true;
  const re = /https?:\/\/\S+|www\.\S+|\b[A-Z]{2,7}\b|\b[A-Z][a-z]+\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (/^[A-Z][a-z]+$/.test(m[0]) && (sentenceStart(source, m.index) || COMMON_OPENINGS.test(m[0]))) continue;
    for (let j = m.index; j < m.index + m[0].length; j++) out[j] = true;
  }
  const phrases = data.protectedPhrases || [];
  for (let i = 0; i < phrases.length; i++) {
    const phrase = String(phrases[i]);
    if (!phrase) continue;
    let start = 0;
    while ((start = source.indexOf(phrase, start)) >= 0) {
      for (let j = start; j < start + phrase.length; j++) out[j] = true;
      start += phrase.length;
    }
  }
  return out;
};

const LONG_WORD = /[A-Za-zÀ-ɏœŒ]{8,}/g;

// The whole-word text, plus up to two variants that each insert one hyphen
// in a long word (only when hyphenation is allowed)
const textVariants = (source, styles, data, maxHyphenVariants) => {
  const variants = [{ text: source, map: null, insertion: null }];
  if (!data.allowHyphen || typeof data.breakPoints !== "function" || /-[\r\n]/.test(source)) return variants;
  const candidates = [];
  LONG_WORD.lastIndex = 0;
  let match;
  while ((match = LONG_WORD.exec(source)) !== null) {
    const start = match.index;
    const word = match[0];
    let locked = false;
    for (let i = start; i < start + word.length; i++) {
      if (styles[i] && styles[i].noBreak) { locked = true; break; }
    }
    if (locked) continue;
    const points = data.breakPoints(word).slice();
    if (!points.length) continue;
    points.sort((a, b) => Math.abs(a - word.length / 2) - Math.abs(b - word.length / 2));
    candidates.push({ at: start + points[0], length: word.length });
  }
  candidates.sort((a, b) => b.length - a.length || a.at - b.at);
  const limit = Math.min(2, Math.max(0, maxHyphenVariants || 2));
  for (let i = 0; i < Math.min(limit, candidates.length); i++) {
    const at = candidates[i].at;
    const text = source.slice(0, at) + "-" + source.slice(at);
    const map = new Array(text.length);
    for (let j = 0; j < text.length; j++) map[j] = j < at ? j : j === at ? at - 1 : j - 1;
    variants.push({ text, map, insertion: { at, sourceAt: at } });
  }
  return variants;
};

const terminalMark = (s) => {
  const match = /(\.{2,}|…+|-)[ \t]*$/.exec(s);
  return match ? { at: match.index, end: match.index + match[1].length } : null;
};

// Every candidate line: from a break point to a later one, without an
// authored line break inside, without leading/trailing spaces
const lineEdges = (variant, styles, maxLineChars, countOnly, limit) => {
  const s = variant.text;
  const terminal = terminalMark(s);
  const n = terminal ? terminal.end : s.length;
  const starts = [0];
  const ends = [];
  const map = variant.map;
  for (let i = 0; i < n; i++) {
    const index = map ? map[i] : i;
    const next = map ? map[Math.min(n - 1, i + 1)] : i + 1;
    const locked = styles[index] && styles[index].noBreak && styles[next] && styles[next].noBreak;
    const ch = s.charAt(i);
    if (ch === "\r" || ch === "\n") {
      ends.push(i);
      starts.push(i + 1);
    } else if ((ch === " " || ch === "\t") && !locked) {
      ends.push(i);
      starts.push(i + 1);
    } else if (ch === "-" && i + 1 < n && !locked) {
      ends.push(i + 1);
      starts.push(i + 1);
    }
  }
  ends.push(n);
  const edges = [];
  let count = 0;
  for (let i = 0; i < starts.length; i++) {
    for (let j = i; j < ends.length; j++) {
      const from = starts[i];
      const to = ends[j];
      const blank = to === from && (s.charAt(from) === "\r" || s.charAt(from) === "\n" || from === n);
      if (to < from || (to === from && !blank)) continue;
      const text = s.substring(from, to);
      if (/[\r\n]/.test(text)) break;
      if ((!blank && !/\S/.test(text)) || /^\s|\s$/.test(text) || text.length > (maxLineChars || 180)) continue;
      // A final pause stays with the preceding words (unless authored alone)
      if (to === n && /^(\.{2,}|…+|-)$/.test(text) && from > 0 && s.charAt(from - 1) !== "\r" && s.charAt(from - 1) !== "\n") continue;
      // In a hyphen variant the inserted hyphen must be the chosen break
      if (variant.insertion && from <= variant.insertion.at && to > variant.insertion.at + 1) continue;
      if (countOnly) {
        if (++count > limit) return count;
        continue;
      }
      const indices = [];
      for (let k = from; k < to; k++) indices.push(map ? map[k] : k);
      edges.push({ from: i, to: j + 1, text, indices, start: from, end: to, blank });
    }
  }
  if (countOnly) return count;
  variant.nodes = starts.length + 1;
  variant.edges = edges;
  return edges;
};

const styleKey = (style) => {
  const c = clone(style);
  const stripColor = (value) => {
    delete value.color;
    delete value.strokeColor;
    if (value.baseParentStyle) stripColor(value.baseParentStyle);
  };
  stripColor(c);
  return internKey(stableKey(c));
};

// Layer-level fields that change glyph rendering
const measurementLayerKey = (layer) => {
  const warp = layer.warp || {};
  return stableKey({
    textGridding: layer.textGridding || "none",
    orientation: layer.orientation || "horizontal",
    antiAlias: layer.antiAlias || "antiAliasSharp",
    warp: {
      warpStyle: warp.warpStyle || "warpNone",
      warpValue: warp.warpValue || 0,
      warpPerspective: warp.warpPerspective || 0,
      warpPerspectiveOther: warp.warpPerspectiveOther || 0,
      warpRotate: warp.warpRotate || "horizontal",
    },
  });
};

// Style runs, kerning and the measuring key of one candidate line
const lineSpec = (edge, styles, baseSize, dpi, paragraph, kern) => {
  if (!styles._keys) {
    styles._keys = [];
    for (let i = 0; i < styles.length; i++) styles._keys.push(i && styles[i] === styles[i - 1] ? styles._keys[i - 1] : styleKey(styles[i]));
  }
  const ranges = [];
  const rangeKeys = [];
  let last = null;
  for (let i = 0; i < edge.indices.length; i++) {
    const source = styles[edge.indices[i]];
    if (!source) throw new Error("Missing style at " + edge.indices[i] + " in " + edge.text);
    const key = styles._keys[edge.indices[i]];
    if (key !== last) {
      ranges.push({ from: i, to: i + 1, textStyle: source });
      rangeKeys.push(key);
      last = key;
    } else ranges[ranges.length - 1].to = i + 1;
  }
  const kerning = [];
  const kernRanges = kern || [];
  for (let i = 0; i < kernRanges.length; i++) {
    const kr = kernRanges[i];
    for (let j = 0; j < edge.indices.length; j++) {
      if (edge.indices[j] === kr.from) {
        const copy = clone(kr);
        copy.from = j;
        copy.to = Math.min(edge.text.length, j + Math.max(1, kr.to - kr.from));
        kerning.push(copy);
      }
    }
  }
  let signature = "";
  for (let i = 0; i < ranges.length; i++) signature += ranges[i].from + ":" + ranges[i].to + ":" + rangeKeys[i] + "|";
  edge.spec = { ranges, kerning };
  if (!styles._paragraphKey) styles._paragraphKey = JSON.stringify(paragraph);
  edge.key = internKey(edge.text + "|" + baseSize + "|" + dpi + "|" + signature + "|" + JSON.stringify(kerning) + "|" +
    styles._paragraphKey + "|" + styles._measurementLayerKey);
  return edge;
};

const scaleStyle = (style, scale) => {
  const s = clone(style);
  const keys = ["size", "impliedFontSize", "leading", "baselineShift", "impliedBaselineShift"];
  for (let i = 0; i < keys.length; i++) if (typeof s[keys[i]] === "number") s[keys[i]] *= scale;
  return s;
};

const lineLeading = (edge, baseSize, paragraph) => {
  if (edge.blank) return paragraph.autoLeadingPercentage || 1.2;
  let lead = 0;
  for (let i = 0; i < edge.spec.ranges.length; i++) {
    const s = edge.spec.ranges[i].textStyle;
    const ratio = s.size / baseSize;
    lead = Math.max(lead, s.autoLeading === false && s.leading > 0 ? s.leading / baseSize : ratio * (paragraph.autoLeadingPercentage || 1.2));
  }
  return lead;
};

// White text (on a black bubble): the colour of every run
export const applyTextColor = (data, color) => {
  if (!color) return false;
  const ranges = data.style.textProps.layerText.textStyleRange;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].textStyle) ranges[i].textStyle.color = { red: color.red, green: color.green, blue: color.blue };
  }
  return true;
};

// Build the graph of one translation. options: { dpi, textColor,
// resolveRunStyle, allowHyphen, breakPoints, maxHyphenVariants }
export const compileGraph = (input, options) => {
  const dpi = options.dpi;
  const data = clone(input);
  data.allowHyphen = !!options.allowHyphen;
  data.breakPoints = options.breakPoints;
  const recolored = applyTextColor(data, options.textColor);
  // The stroke is applied after the text is placed: never measured
  const stroke = recolored ? null : data.style.stroke || null;
  data.style.stroke = null;
  const originalSource = String(data.text || "");
  const originalStyles = characterStyles(data, options.resolveRunStyle);
  const canonicalMap = [];
  let source = "";
  for (let i = 0; i < originalSource.length; i++) {
    const ch = originalSource.charAt(i);
    if (ch === "\n" && i && originalSource.charAt(i - 1) === "\r") continue;
    canonicalMap.push(i);
    source += ch === "\n" ? "\r" : ch;
  }
  data.text = source;
  if (!/\S/.test(source) || source.length > 1500) throw new Error("Unsupported text length");
  const styles = canonicalMap.map((i) => originalStyles[i]);
  styles._measurementLayerKey = measurementLayerKey(data.style.textProps.layerText);
  // Protected words get a no-break copy of their style
  const locks = protectedCharacters(source, styles, data);
  const original = [];
  const copies = [];
  for (let i = 0; i < locks.length; i++) {
    if (locks[i] && !styles[i].noBreak) {
      let at = original.indexOf(styles[i]);
      if (at < 0) {
        at = original.length;
        original.push(styles[i]);
        const copy = clone(styles[i]);
        copy.noBreak = true;
        copies.push(copy);
      }
      styles[i] = copies[at];
    }
  }
  const layer = data.style.textProps.layerText;
  const reverse = {};
  const kerning = [];
  for (let i = 0; i < canonicalMap.length; i++) reverse[canonicalMap[i]] = i;
  const kernRanges = layer.kerningRange || [];
  for (let i = 0; i < kernRanges.length; i++) {
    const item = kernRanges[i];
    if (typeof reverse[item.from] !== "number") continue;
    const k = clone(item);
    k.from = reverse[item.from];
    k.to = typeof reverse[item.to] === "number" ? reverse[item.to] : Math.min(source.length, k.from + Math.max(1, item.to - item.from));
    kerning.push(k);
  }
  layer.kerningRange = kerning;
  const savedSize = layer.textStyleRange[0].textStyle.size;
  if (!isFinite(savedSize) || savedSize <= 0) throw new Error("The style has no valid text size.");
  const baseSize = savedSize;
  const paragraph = layer.paragraphStyleRange[0].paragraphStyle;
  // Long translations: bound the number of candidate lines
  let variants = textVariants(source, styles, data, options.maxHyphenVariants);
  let edgeCount = 0;
  let overflow = false;
  if ((source.match(/\S+/g) || []).length >= 40) {
    for (let i = 0; i < variants.length; i++) {
      edgeCount += lineEdges(variants[i], styles, 180, true, 2400 - edgeCount);
      if (edgeCount > 2400) { overflow = true; break; }
    }
  }
  if (overflow) variants = textVariants(source, styles, data, 1);
  edgeCount = 0;
  let lists = variants.map((variant) => {
    const list = lineEdges(variant, styles, overflow ? 72 : 180);
    edgeCount += list.length;
    return list;
  });
  if (overflow && edgeCount > 2300) {
    variants = [variants[0]];
    lists = [lineEdges(variants[0], styles, 64)];
  }
  let total = 0;
  for (let i = 0; i < variants.length; i++) {
    for (let j = 0; j < lists[i].length; j++) {
      const edge = lists[i][j];
      lineSpec(edge, styles, baseSize, dpi, paragraph, kerning);
      edge.leading = lineLeading(edge, baseSize, paragraph);
      total++;
    }
  }
  const graph = { data, source, originalSource, canonicalMap, styles, baseSize, paragraph, variants, stroke, dpi };
  if (total + probesForGraph(graph).probes.length > 2400) {
    throw new Error("Too many layout candidates; shorten the translation or add line breaks.");
  }
  return graph;
};

// Font probes: "x" for the x-height and "x x" for the word space, per style
export const probesForGraph = (graph) => {
  const keys = {};
  const probes = [];
  const spaces = [];
  for (let i = 0; i < graph.styles.length; i++) {
    const probe = { text: "x", indices: [i] };
    lineSpec(probe, graph.styles, graph.baseSize, graph.dpi, graph.paragraph, []);
    if (keys[probe.key]) continue;
    keys[probe.key] = true;
    probes.push(probe);
    const space = { text: "x x", indices: [i, i, i] };
    lineSpec(space, graph.styles, graph.baseSize, graph.dpi, graph.paragraph, []);
    spaces.push(space);
  }
  return { probes, spaces };
};

// The chosen lines as Photoshop text parameters: point text, centred on the
// axis, first baseline at the chosen height. page = { width, height, resolution }
export const composeText = (graph, choice, page) => {
  if (!choice) throw new Error("No layout choice");
  const variant = graph.variants[choice.variant];
  if (!variant) throw new Error("Invalid layout variant");
  const params = clone(graph.data.style.textProps);
  const lt = params.layerText;
  const scale = (choice.size * 72) / page.resolution / graph.baseSize;
  let text = "";
  const map = [];
  for (let i = 0; i < choice.lines.length; i++) {
    const edge = variant.edges[choice.lines[i].edge];
    if (!edge) throw new Error("Invalid text edge");
    if (i) {
      text += "\r";
      map.push(-1);
    }
    text += edge.text;
    for (let j = 0; j < edge.indices.length; j++) {
      let index = edge.indices[j];
      if (variant.insertion && edge.start + j === variant.insertion.at) index = -2;
      map.push(index);
    }
  }
  const ranges = [];
  const scaled = {};
  let last = null;
  for (let i = 0; i < map.length; i++) {
    let at = map[i];
    if (at < 0) {
      let before = i - 1;
      while (before >= 0 && map[before] < 0) before--;
      at = before >= 0 ? map[before] : 0;
    }
    at = Math.max(0, at);
    const key = graph.styles._keys ? graph.styles._keys[at] : styleKey(graph.styles[at]);
    let style = scaled[key];
    if (!style) {
      style = scaleStyle(graph.styles[at], scale);
      delete style.noBreak;
      scaled[key] = style;
    }
    if (key !== last) {
      ranges.push({ from: i, to: i + 1, textStyle: style });
      last = key;
    } else ranges[ranges.length - 1].to = i + 1;
  }
  const kerning = [];
  const originalKerning = lt.kerningRange || [];
  for (let i = 0; i < originalKerning.length; i++) {
    const r = originalKerning[i];
    for (let j = 0; j < map.length; j++) {
      if (map[j] === r.from) {
        const kr = clone(r);
        kr.from = j;
        kr.to = Math.min(text.length, j + Math.max(1, r.to - r.from));
        kerning.push(kr);
      }
    }
  }
  const p = clone(lt.paragraphStyleRange[0].paragraphStyle);
  p.alignment = "center";
  p.hyphenate = false;
  p.spaceBefore = 0;
  p.spaceAfter = 0;
  p.startIndent = 0;
  p.endIndent = 0;
  p.firstLineIndent = 0;
  lt.textKey = text;
  lt.textStyleRange = ranges;
  lt.kerningRange = kerning;
  lt.paragraphStyleRange = [{ from: 0, to: text.length, paragraphStyle: p }];
  lt.textShape = [{ textType: "point", orientation: "horizontal" }];
  lt.textClickPoint = {
    horizontal: (choice.axis / page.width) * 100,
    vertical: (choice.lines[0].baseline / page.height) * 100,
  };
  setDirection(params, graph.data.direction, text.length);
  return { params, renderedText: text, sourceMap: map };
};

export const textGraphInternals = { lineEdges, textVariants, characterStyles, scaleStyle, protectedCharacters };
