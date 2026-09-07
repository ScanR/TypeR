import { makeBuffer, allocateBuffer, homeDirectory } from "./nodeCompat";
// Export styles JSON together with the matching installed font files
// (.ttf/.otf/.ttc) into a single .zip archive. Runs on the CEP Node runtime
// (--enable-nodejs in the manifest); every entry point returns an error
// result instead of throwing when Node is unavailable.

const getNode = () => {
  const nodeRequire =
    (window.cep_node && window.cep_node.require) ||
    (typeof window.require === "function" ? window.require : null);
  if (!nodeRequire) return null;
  try {
    return {
      fs: nodeRequire("fs"),
      path: nodeRequire("path"),
      os: nodeRequire("os"),
      env: nodeRequire("process").env,
      zlib: nodeRequire("zlib"),
      Buffer: nodeRequire("buffer").Buffer,
    };
  } catch (e) {
    return null;
  }
};

const isWindows = () => !!navigator.platform && navigator.platform.indexOf("Win") === 0;

const getFontDirs = (node) => {
  if (isWindows()) {
    const env = (window.cep_node && window.cep_node.process && window.cep_node.process.env) || {};
    return [
      node.path.join(env.WINDIR || "C:\\Windows", "Fonts"),
      node.path.join(homeDirectory(node.os, node.env), "AppData", "Local", "Microsoft", "Windows", "Fonts"),
    ];
  }
  return [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    node.path.join(homeDirectory(node.os, node.env), "Library", "Fonts"),
  ];
};

const FONT_EXT_RE = /\.(ttf|otf|ttc|otc)$/i;

const listFontFiles = (node, dir, depth, out) => {
  let entries;
  try {
    entries = node.fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  entries.forEach((name) => {
    const full = node.path.join(dir, name);
    let stat;
    try {
      stat = node.fs.statSync(full);
    } catch (e) {
      return;
    }
    if (stat.isDirectory()) {
      if (depth < 3) listFontFiles(node, full, depth + 1, out);
    } else if (FONT_EXT_RE.test(name)) {
      out.push(full);
    }
  });
};

const readAt = (node, fd, position, length) => {
  const buf = allocateBuffer(node.Buffer, length);
  const bytes = node.fs.readSync(fd, buf, 0, length, position);
  return bytes === length ? buf : buf.slice(0, bytes);
};

const utf16beToString = (buf) => {
  let out = "";
  for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode(buf.readUInt16BE(i));
  return out;
};

// Collect name-table records (family, subfamily, full and PostScript names)
// of the sfnt starting at `base`. Table offsets are absolute file positions,
// which also holds for fonts inside a .ttc collection.
const parseSfntNames = (node, fd, base, names) => {
  const header = readAt(node, fd, base, 12);
  if (header.length < 12) return;
  const numTables = header.readUInt16BE(4);
  if (!numTables || numTables > 512) return;
  const tableDir = readAt(node, fd, base + 12, numTables * 16);
  for (let i = 0; i < numTables; i++) {
    const rec = i * 16;
    if (rec + 16 > tableDir.length) return;
    if (tableDir.toString("ascii", rec, rec + 4) !== "name") continue;
    const tableOffset = tableDir.readUInt32BE(rec + 8);
    const tableLength = tableDir.readUInt32BE(rec + 12);
    if (tableLength < 6 || tableLength > 500000) return;
    const table = readAt(node, fd, tableOffset, tableLength);
    if (table.length < 6) return;
    const count = table.readUInt16BE(2);
    const stringOffset = table.readUInt16BE(4);
    for (let j = 0; j < count; j++) {
      const r = 6 + j * 12;
      if (r + 12 > table.length) break;
      const platformID = table.readUInt16BE(r);
      const nameID = table.readUInt16BE(r + 6);
      if (nameID !== 1 && nameID !== 2 && nameID !== 4 && nameID !== 6) continue;
      const length = table.readUInt16BE(r + 8);
      const offset = table.readUInt16BE(r + 10);
      const start = stringOffset + offset;
      if (start + length > table.length) continue;
      const raw = table.slice(start, start + length);
      const value = platformID === 1 ? raw.toString("latin1") : utf16beToString(raw);
      if (value) names.push({ nameID, value });
    }
    return;
  }
};

const readFontNames = (node, file) => {
  const names = [];
  let fd;
  try {
    fd = node.fs.openSync(file, "r");
    const magic = readAt(node, fd, 0, 12);
    if (magic.length < 12) return names;
    const tag = magic.toString("ascii", 0, 4);
    if (tag === "ttcf") {
      const numFonts = Math.min(magic.readUInt32BE(8), 64);
      const offsets = readAt(node, fd, 12, numFonts * 4);
      for (let i = 0; i * 4 + 4 <= offsets.length; i++) {
        parseSfntNames(node, fd, offsets.readUInt32BE(i * 4), names);
      }
    } else if (magic.readUInt32BE(0) === 0x00010000 || tag === "OTTO" || tag === "true") {
      parseSfntNames(node, fd, 0, names);
    }
  } catch (e) {
    // Unreadable or corrupt font file: skip it
  } finally {
    if (fd !== undefined) {
      try {
        node.fs.closeSync(fd);
      } catch (e) {}
    }
  }
  return names;
};

const normalize = (value) => (value || "").toLowerCase().replace(/[\s\-_.,]+/g, "");

const buildFontIndex = (node) => {
  const files = [];
  getFontDirs(node).forEach((dir) => listFontFiles(node, dir, 0, files));
  const index = [];
  files.forEach((file) => {
    const names = readFontNames(node, file);
    if (!names.length) return;
    const entry = { file, postScript: new Set(), full: new Set(), familyStyle: new Set() };
    const families = [];
    const subfamilies = [];
    names.forEach(({ nameID, value }) => {
      const norm = normalize(value);
      if (!norm) return;
      if (nameID === 6) entry.postScript.add(norm);
      else if (nameID === 4) entry.full.add(norm);
      else if (nameID === 1) families.push(norm);
      else if (nameID === 2) subfamilies.push(norm);
    });
    families.forEach((family) => {
      subfamilies.forEach((sub) => entry.familyStyle.add(family + "|" + sub));
    });
    index.push(entry);
  });
  return index;
};

const matchFontRef = (index, ref) => {
  const ps = normalize(ref.postScriptName);
  if (ps) {
    const hit = index.find((entry) => entry.postScript.has(ps));
    if (hit) return hit.file;
  }
  const family = normalize(ref.fontName);
  if (!family) return null;
  const style = normalize(ref.fontStyleName) || "regular";
  let hit = index.find((entry) => entry.familyStyle.has(family + "|" + style));
  if (hit) return hit.file;
  const full = normalize((ref.fontName || "") + (ref.fontStyleName || ""));
  hit = index.find((entry) => entry.full.has(full) || entry.full.has(family));
  return hit ? hit.file : null;
};

let crcTable = null;
const getCrcTable = () => {
  if (crcTable) return crcTable;
  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  return crcTable;
};

const crc32 = (buf) => {
  const table = getCrcTable();
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
};

const toDosDateTime = (date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  day: (Math.max(date.getFullYear() - 1980, 0) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
});

const buildZip = (node, entries) => {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, day } = toDosDateTime(new Date());
  entries.forEach((entry) => {
    const nameBuf = makeBuffer(node.Buffer, entry.name, "utf8");
    const crc = crc32(entry.data);
    let method = 8;
    let compressed = node.zlib.deflateRawSync(entry.data);
    if (compressed.length >= entry.data.length) {
      method = 0;
      compressed = entry.data;
    }
    const local = allocateBuffer(node.Buffer, 30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const header = allocateBuffer(node.Buffer, 46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(node.Buffer.concat([header, nameBuf]));
    parts.push(local, nameBuf, compressed);
    offset += local.length + nameBuf.length + compressed.length;
  });
  const centralBuf = node.Buffer.concat(central);
  const eocd = allocateBuffer(node.Buffer, 22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  parts.push(centralBuf, eocd);
  return node.Buffer.concat(parts);
};

// One deduplicated font reference per font used by the given styles
const collectFontRefs = (styles) => {
  const map = new Map();
  (styles || []).forEach((style) => {
    const textStyle = style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
    const key =
      textStyle.fontPostScriptName ||
      [textStyle.fontName, textStyle.fontStyleName].filter(Boolean).join(" / ");
    if (!key || map.has(key)) return;
    const name = textStyle.fontName || textStyle.fontPostScriptName || "Unknown font";
    map.set(key, {
      postScriptName: textStyle.fontPostScriptName || "",
      fontName: textStyle.fontName || "",
      fontStyleName: textStyle.fontStyleName || "",
      label: textStyle.fontStyleName ? `${name} · ${textStyle.fontStyleName}` : name,
    });
  });
  return Array.from(map.values());
};

const exportZipWithFonts = ({ zipPath, jsonFileName, jsonString, fontRefs }) => {
  const node = getNode();
  if (!node) return { ok: false, error: "Node runtime unavailable" };
  try {
    const index = buildFontIndex(node);
    const missing = [];
    const files = [];
    const seenFiles = new Set();
    (fontRefs || []).forEach((ref) => {
      const file = matchFontRef(index, ref);
      if (!file) missing.push(ref.label);
      else if (!seenFiles.has(file)) {
        seenFiles.add(file);
        files.push(file);
      }
    });
    const entries = [{ name: jsonFileName, data: makeBuffer(node.Buffer, jsonString, "utf8") }];
    const usedNames = new Set();
    files.forEach((file) => {
      const base = node.path.basename(file);
      const ext = node.path.extname(base);
      let candidate = base;
      for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) {
        candidate = base.slice(0, base.length - ext.length) + "-" + n + ext;
      }
      usedNames.add(candidate.toLowerCase());
      entries.push({ name: "fonts/" + candidate, data: node.fs.readFileSync(file) });
    });
    const target = /\.zip$/i.test(zipPath) ? zipPath : zipPath + ".zip";
    node.fs.writeFileSync(target, buildZip(node, entries));
    return { ok: true, missing, fontCount: files.length };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
};

export { collectFontRefs, exportZipWithFonts };
