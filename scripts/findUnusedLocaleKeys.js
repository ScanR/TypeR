#!/usr/bin/env node
// Reports locale keys (locale/messages.properties) that no source file reads.
//
// A key counts as used when any scanned file contains:
//   - a static access: locale.KEY, locale?.KEY, locale["KEY"], locale['KEY']
//   - the key as a full string literal ("KEY", 'KEY', `KEY`), which covers keys
//     passed around by name (label: "shortcut_add", labelKey: "...", arrays of
//     key names, test assertions such as /^shortcut_keepTextSize=/)
//   - a bare-word mention in a shell/batch/PowerShell script (locale_value KEY)
//   - a dynamic access whose static prefix/suffix matches it, e.g.
//     locale[`shortcut_${id}Descr`] or locale["helpQuick" + x]. Any dynamic
//     access that is not a plain literal is reported, and every key matching
//     its static parts is conservatively kept.
//
// Usage: node scripts/findUnusedLocaleKeys.js [--json] [--delete]
//   --delete removes the unused keys from every locale file, preserving line
//   endings, encoding and the order of the remaining lines.
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const EXTENSIONS = new Set([".js", ".jsx", ".jsxinc", ".cjs", ".mjs", ".psjs", ".html", ".xml", ".json", ".m", ".ts", ".tsx", ".sh", ".cmd", ".bat", ".ps1", ".py"]);
// Source folders plus every script at the repo root: the standalone updaters
// (update_typer_mac.sh, update_typer_win.cmd) read updater* keys by name.
const SCAN = [
  "app_src", "uxp-src", "scripts", "validation", "CSXS",
  ...fs.readdirSync(rootDir).filter((name) => EXTENSIONS.has(path.extname(name)) && name !== "package-lock.json"),
];
const SELF = path.resolve(__filename);

const listFiles = (entry) => {
  const full = path.resolve(rootDir, entry);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return EXTENSIONS.has(path.extname(full)) && full !== SELF ? [full] : [];
  return fs.readdirSync(full).flatMap((name) => (name === "node_modules" ? [] : listFiles(path.join(entry, name))));
};

const localeFiles = () => [
  path.join(rootDir, "locale", "messages.properties"),
  ...fs.readdirSync(path.join(rootDir, "locale"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(rootDir, "locale", e.name, "messages.properties"))
    .filter((f) => fs.existsSync(f)),
];

const keyOf = (line) => {
  if (!line || line.startsWith("#") || line.startsWith("!") || /^\s/.test(line)) return null;
  const i = line.indexOf("=");
  return i > 0 ? line.slice(0, i).trim() : null;
};

const readKeys = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).map(keyOf).filter(Boolean);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const analyze = () => {
  const keys = readKeys(localeFiles()[0]);
  const keySet = new Set(keys);
  const usedBy = new Map(); // key -> Set(files)
  const dynamic = []; // { file, line, expr, regex }
  const mark = (key, file) => {
    if (!keySet.has(key)) return;
    if (!usedBy.has(key)) usedBy.set(key, new Set());
    usedBy.get(key).add(path.relative(rootDir, file));
  };

  for (const file of SCAN.flatMap(listFiles)) {
    const src = fs.readFileSync(file, "utf8");
    // Static member access.
    for (const m of src.matchAll(/\blocale\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) mark(m[1], file);
    // String literals that are exactly a key.
    for (const m of src.matchAll(/(["'`])([A-Za-z_$][\w$]*)\1/g)) mark(m[2], file);
    // Shell scripts look keys up by bare word (locale_value updaterTitle ...).
    if (/\.(sh|cmd|bat|ps1|py)$/.test(file)) for (const m of src.matchAll(/[A-Za-z_][\w]*/g)) mark(m[0], file);
    // Bracket access: literal or dynamic.
    for (const m of src.matchAll(/\blocale\s*(?:\?\.)?\[([^\]]+)\]/g)) {
      const expr = m[1].trim();
      const literal = expr.match(/^(["'`])([\w$]+)\1$/);
      if (literal) { mark(literal[2], file); continue; }
      // Build a regex from the static parts of a template or concatenation.
      let pattern = null;
      const tpl = expr.match(/^`(.*)`$/s);
      if (tpl) {
        pattern = tpl[1].split(/\$\{[^}]*\}/).map(escapeRe).join("[\\w$]*");
      } else if (/["'`]/.test(expr) && expr.includes("+")) {
        pattern = expr.split("+").map((part) => {
          const p = part.trim().match(/^(["'`])([^"'`]*)\1$/);
          return p ? escapeRe(p[2]) : "[\\w$]*";
        }).join("");
      }
      // Pure variable (locale[x.label]): the names flow in as string literals,
      // which the literal scan above already counts.
      const lineNo = src.slice(0, m.index).split("\n").length;
      dynamic.push({ file: path.relative(rootDir, file), line: lineNo, expr, regex: pattern ? new RegExp(`^${pattern}$`) : null });
    }
  }

  for (const d of dynamic) {
    if (!d.regex) continue;
    d.matched = keys.filter((k) => d.regex.test(k));
    d.matched.forEach((k) => mark(k, path.join(rootDir, d.file)));
  }

  const unused = keys.filter((k) => !usedBy.has(k));
  const testOnly = keys.filter((k) => usedBy.has(k) && [...usedBy.get(k)].every((f) => /(^scripts\/test|\.test\.js$)/.test(f)));
  return { keys, unused, testOnly, dynamic };
};

const deleteKeys = (unused) => {
  const drop = new Set(unused);
  for (const file of localeFiles()) {
    const raw = fs.readFileSync(file);
    const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    const text = raw.toString("utf8");
    // Split keeping each line's own terminator so mixed endings survive.
    const parts = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter((p, i, a) => p !== "" || i < a.length - 1);
    const kept = parts.filter((p) => !drop.has(keyOf(p.replace(/^\uFEFF/, "").replace(/[\r\n]+$/, ""))));
    let out = kept.join("");
    if (bom && !out.startsWith("\uFEFF")) out = "\uFEFF" + out;
    fs.writeFileSync(file, out, "utf8");
  }
};

if (require.main === module) {
  const result = analyze();
  const args = process.argv.slice(2);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ ...result, dynamic: result.dynamic.map(({ regex, ...d }) => ({ ...d, regex: regex && String(regex) })) }, null, 2));
  } else {
    console.log(`Keys: ${result.keys.length}, unused: ${result.unused.length}`);
    console.log("\nDynamic locale accesses:");
    result.dynamic.forEach((d) => console.log(`  ${d.file}:${d.line} locale[${d.expr}]${d.regex ? ` -> ${d.regex} (${d.matched.length} keys kept)` : " -> names come from string literals"}`));
    console.log("\nUsed only by tests:");
    result.testOnly.forEach((k) => console.log(`  ${k}`));
    console.log("\nUnused:");
    result.unused.forEach((k) => console.log(`  ${k}`));
  }
  if (args.includes("--delete") && result.unused.length) {
    deleteKeys(result.unused);
    console.log(`\nDeleted ${result.unused.length} keys from ${localeFiles().length} locale files.`);
  }
}

module.exports = { analyze };
