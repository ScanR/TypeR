// Read-only: run Codex's CURRENT geometry (integrated source) on simple manga silhouettes and report false splits.
const fs = require("fs"), vm = require("vm"), path = require("path");
const SRC = path.join(__dirname, '..');
const ctx = { window: {} }; vm.createContext(ctx);
// GEOM=<fichier> : tester une copie corrigee de la geometrie (voir fixcheck.cjs) au lieu de la source de Codex
vm.runInContext(fs.readFileSync(process.env.GEOM || path.join(SRC, "app_src/doubleBubbleGeometry.js"), "utf8"), ctx);
const g = ctx.TypeRDoubleBubble;

const TAU = Math.PI * 2;
const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
const circle = (cx, cy, r, n = 128) => Array.from({ length: n }, (_, i) => pt(cx, cy, r, i * TAU / n));
const ellipse = (cx, cy, rx, ry, n = 128) => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos(i * TAU / n), cy + ry * Math.sin(i * TAU / n)]);
const regular = (cx, cy, r, k, rot = 0) => Array.from({ length: k }, (_, i) => pt(cx, cy, r, rot + i * TAU / k));
function star(cx, cy, R, ratio, spikes) { const p = []; for (let i = 0; i < spikes * 2; i++) p.push(pt(cx, cy, i % 2 ? R * ratio : R, i * Math.PI / spikes)); return p; }
function burstRounded(cx, cy, R, ratio, spikes, per = 6) { // spikes with a few intermediate points (hand-drawn burst)
  const p = []; for (let s = 0; s < spikes * 2; s++) for (let k = 0; k < per; k++) { const a = (s + k / per) * Math.PI / spikes; const r0 = s % 2 ? R * ratio : R, r1 = s % 2 ? R : R * ratio; p.push(pt(cx, cy, r0 + (r1 - r0) * k / per, a)); } return p; }
function cloud(cx, cy, R, bumps, amp) { return Array.from({ length: 360 }, (_, i) => { const a = i * TAU / 360; return pt(cx, cy, R * (1 + amp * Math.abs(Math.sin(bumps * a / 2)) - amp / 2), a); }); }
// circle + cone tail (apex at distance R*(1+len)), base half-angle from baseW (fraction of diameter)
function withTail(cx, cy, R, baseW, len, ang = Math.PI / 4, n = 256) {
  const half = Math.asin(Math.min(0.99, baseW / 2)), p = [];
  for (let i = 0; i < n; i++) { const a = i * TAU / n; let d = Math.atan2(Math.sin(a - ang), Math.cos(a - ang)); if (Math.abs(d) < half) continue; p.push(pt(cx, cy, R, a)); }
  // insert apex between the two base points, ordered by angle
  const apex = pt(cx, cy, R * (1 + len), ang);
  p.sort((u, v) => ((Math.atan2(u[1] - cy, u[0] - cx) - ang + 3 * Math.PI) % TAU) - ((Math.atan2(v[1] - cy, v[0] - cx) - ang + 3 * Math.PI) % TAU));
  const out = []; let inserted = false;
  for (let i = 0; i < p.length; i++) { out.push(p[i]); const a0 = Math.atan2(p[i][1] - cy, p[i][0] - cx), a1 = Math.atan2(p[(i + 1) % p.length][1] - cy, p[(i + 1) % p.length][0] - cx); const gap = ((a1 - a0 + TAU) % TAU); if (!inserted && gap > half) { out.push(apex); inserted = true; } }
  return out;
}
function roundedRect(cx, cy, w, h, r, n = 24) { const p = []; const c = [[cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2], [cx + w / 2 - r, cy + h / 2 - r, 0], [cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2], [cx - w / 2 + r, cy - h / 2 + r, Math.PI]]; c.forEach(([x, y, a0]) => { for (let i = 0; i <= n; i++) p.push(pt(x, y, r, a0 + i * (Math.PI / 2) / n)); }); return p; }
function bean(cx, cy, R, dent) { return Array.from({ length: 256 }, (_, i) => { const a = i * TAU / 256; return pt(cx, cy, R * (1 - dent * Math.exp(-Math.pow((((a - Math.PI / 2 + Math.PI) % TAU) - Math.PI) / 0.45, 2))), a); }); }
function lshape(s) { return [[0, 0], [s, 0], [s, s * 0.45], [s * 0.45, s * 0.45], [s * 0.45, s], [0, s]]; }
function union2(ax, ay, ar, bx, by, br, n = 720) { const cx = (ax + bx) / 2, cy = (ay + by) / 2; const p = circle(ax, ay, ar, n).filter(v => Math.hypot(v[0] - bx, v[1] - by) >= br - .01).concat(circle(bx, by, br, n).filter(v => Math.hypot(v[0] - ax, v[1] - ay) >= ar - .01)); return p.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); }

const cases = [];
const add = (name, expect, poly) => cases.push({ name, expect, poly });
add("cercle", 1, circle(300, 300, 200)); add("ellipse 2:1", 1, ellipse(300, 300, 300, 150)); add("ellipse 3:1", 1, ellipse(300, 300, 450, 150));
add("rect arrondi 3:2", 1, roundedRect(300, 300, 600, 400, 60)); add("rect arrondi 3:1", 1, roundedRect(300, 300, 900, 300, 50));
add("hexagone", 1, regular(300, 300, 200, 6)); add("octogone", 1, regular(300, 300, 200, 8)); add("carre", 1, regular(300, 300, 200, 4, Math.PI / 4));
add("haricot (creux 15%)", 1, bean(300, 300, 200, .15)); add("haricot (creux 30%)", 1, bean(300, 300, 200, .30));
add("forme en L", 1, lshape(500));
for (const [bw, len] of [[.12, .25], [.2, .3], [.3, .4], [.4, .5], [.5, .6]]) add(`cercle + queue (base ${bw * 100}% diam, long ${len * 100}% R)`, 1, withTail(300, 300, 200, bw, len));
for (const [bw, len] of [[.2, .4], [.4, .6]]) add(`ellipse 2:1 + queue (base ${bw * 100}%)`, 1, (() => { const e = withTail(0, 0, 1, bw, len); return e.map(p => [300 + p[0] * 300, 300 + p[1] * 150]); })());
for (const [sp, ratio] of [[5,.75],[5,.6],[6,.75],[6,.6],[8, .75], [8, .6], [12, .75], [12, .6], [16, .8], [16, .65], [20, .85]]) add(`explosion ${sp} pointes ratio ${ratio}`, 1, star(300, 300, 220, ratio, sp));
for (const [sp, ratio] of [[10, .7], [14, .8]]) add(`explosion main ${sp} pointes ratio ${ratio}`, 1, burstRounded(300, 300, 220, ratio, sp));
for (const [b, a] of [[4,.15],[5,.15],[5,.25],[6, .08], [8, .1], [10, .12], [12, .15]]) add(`nuage ${b} bosses amp ${a * 100}%`, 1, cloud(300, 300, 200, b, a));
add("8 vrai (egal, recouvrement 5%)", 2, union2(300, 300, 150, 300 + 285, 300, 150));
add("8 vrai (egal, recouvrement 25%)", 2, union2(300, 300, 150, 300 + 225, 300, 150));
add("8 vrai (egal, recouvrement 45%)", 2, union2(300, 300, 150, 300 + 165, 300, 150));
add("8 vrai (inegal 100/200, recouvrement 20%)", 2, union2(300, 300, 100, 300 + 240, 300, 200));
add("8 anguleux (2 hexagones fusionnes)", 2, (() => { const h = regular(300, 300, 170, 6, 0); const k = regular(300 + 270, 300, 170, 6, 0); return h.slice(0, 3).concat(k.slice(3).concat(k.slice(0, 0))).length ? [[130, 300], [215, 153], [385, 153], [470, 300], [555, 153], [725, 153], [810, 300], [725, 447], [555, 447], [470, 300], [385, 447], [215, 447]] : []; })());

let fp = 0, fn = 0;
console.log("cas".padEnd(52), "attendu", "obtenu", "split", "detail");
for (const c of cases) {
  let regs, err = "";
  try { regs = g.detect([c.poly]); } catch (e) { regs = []; err = e.message; }
  const n = regs.length, split = regs.some(r => r.split);
  const bad = (c.expect === 1 && split) || (c.expect === 2 && n < 2);
  if (c.expect === 1 && split) fp++; if (c.expect === 2 && n < 2) fn++;
  console.log((bad ? "!! " : "   ") + c.name.padEnd(49), String(c.expect).padEnd(7), String(n).padEnd(6), String(split).padEnd(5), err || (n > 1 ? regs.map(r => `[${r.bounds.left.toFixed(0)},${r.bounds.top.toFixed(0)}..${r.bounds.right.toFixed(0)},${r.bounds.bottom.toFixed(0)}]`).join(" ") : ""));
}
console.log(`\nFAUX POSITIFS (silhouette simple coupée) : ${fp} / ${cases.filter(c => c.expect === 1).length} | FAUX NEGATIFS (vrai 8 non coupé) : ${fn} / ${cases.filter(c => c.expect === 2).length}`);

if(fp || fn)throw new Error("False speech bubble split");
