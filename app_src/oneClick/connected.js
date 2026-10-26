// Connected bubbles: the chambers of a double or triple bubble receive the
// next script lines. Ported from MD TYPER's double-paste-plan.js and
// triple-paste-plan.js (closed bubbles), with the author's permission.
//
// Every chamber is rebuilt by the single-bubble planner on the same captured
// outline; nothing here reads Photoshop. Any doubt returns null and the paste
// falls back to the clicked chamber alone.

import { area, bodyBounds, box, clipToSide, contains, findCut, flatten, polygonContour, simplify } from "./geometry";
import { buildBubblePlan, contoursAt } from "./bubblePlan";

// The 2 px work path tolerance allows a slightly offset equivalent cut
export const sameNeck = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return false;
  const d = (x, y) => Math.sqrt((x[0] - y[0]) * (x[0] - y[0]) + (x[1] - y[1]) * (x[1] - y[1]));
  return Math.min(Math.max(d(a[0], b[0]), d(a[1], b[1])), Math.max(d(a[0], b[1]), d(a[1], b[0]))) <= 2;
};

const sideOf = (neck, point) =>
  (neck[1][0] - neck[0][0]) * (point.y - neck[0][1]) - (neck[1][1] - neck[0][1]) * (point.x - neck[0][0]);

const withinBounds = (bounds, point) => !!(bounds && point &&
  point.x >= bounds.left && point.x < bounds.right && point.y >= bounds.top && point.y < bounds.bottom);

// A seed in the chamber across the neck
const oppositeSeed = (plan) => {
  if (!plan || !plan.neck || !plan.contour || !plan.click) return null;
  const full = flatten(plan.contour);
  const side = sideOf(plan.neck, plan.click);
  if (!isFinite(side) || Math.abs(side) < 1e-6) return null;
  const sibling = clipToSide(full, plan.neck[0], plan.neck[1], side > 0 ? -1 : 1);
  if (sibling.length < 3) return null;
  const body = bodyBounds(sibling, box(sibling));
  const seed = { x: body.xMid, y: body.yMid };
  if (area(sibling) < 400 || !contains(sibling, seed) || contains(plan.cleanPolygon, seed)) return null;
  return seed;
};

// A chamber must not hold yet another neck
const containsFurtherChamber = (plan) => {
  if (!plan || !plan.cleanPolygon || !plan.click) return true;
  const cut = findCut([polygonContour(plan.cleanPolygon)], plan.click, box(plan.cleanPolygon), false);
  return !!(cut && (!cut.neck || !sameNeck(cut.neck, plan.neck)));
};

const verifiedPair = (first, second) => !!(first && second &&
  first.connected && second.connected &&
  sameNeck(first.neck, second.neck) &&
  first.documentId === second.documentId &&
  contains(first.cleanPolygon, first.click) &&
  contains(second.cleanPolygon, second.click) &&
  !contains(first.cleanPolygon, second.click) &&
  !contains(second.cleanPolygon, first.click) &&
  !containsFurtherChamber(first) &&
  !containsFurtherChamber(second));

// The second chamber of a double bubble, or null
export const deriveDoubleSibling = (input, plan, subpaths, options = {}) => {
  if (!plan || !plan.connected || !plan.neck || plan.source !== "wand") return null;
  try {
    const seed = oppositeSeed(plan);
    if (!seed || !withinBounds(input.selectionBounds, seed)) return null;
    const sibling = buildBubblePlan(input, { autoClean: options.autoClean, subpaths, click: seed });
    return verifiedPair(plan, sibling) ? sibling : null;
  } catch (uncertain) {
    return null;
  }
};

const polygonValid = (poly) => Array.isArray(poly) && poly.length >= 3 && poly.length <= 4096 && area(poly) >= 400;

const seedsFor = (poly, preferred) => {
  const body = bodyBounds(poly, box(poly));
  const out = preferred ? [preferred] : [{ x: body.xMid, y: body.yMid }];
  if (!preferred) {
    const fractions = [0.35, 0.65, 0.2, 0.8];
    for (let y = 0; y < fractions.length; y++) {
      for (let x = 0; x < fractions.length; x++) {
        out.push({ x: body.left + body.width * fractions[x], y: body.top + body.height * fractions[y] });
      }
    }
  }
  return out.filter((p) => contains(poly, p));
};

const lineContour = (poly) => {
  const simple = simplify(poly, 0.3);
  if (simple.length > 256) throw new Error("Triple chamber exceeds the path budget");
  return polygonContour(simple);
};

const findPartitionCut = (node, preferred) => {
  const seeds = seedsFor(node.polygon, preferred);
  for (let i = 0; i < seeds.length; i++) {
    const cut = findCut([node.contour], seeds[i], node.bounds, false);
    if (!cut || cut.neck) return { cut, seed: seeds[i] };
  }
  return null;
};

// Split an outline with the neck finder until three chambers remain
export const partitionContour = (sourceContour, click, selectionBounds) => {
  const polygon = flatten(sourceContour);
  if (!polygonValid(polygon) || !contains(polygon, click)) return null;
  const root = { polygon, contour: sourceContour, bounds: selectionBounds || box(polygon), constraints: [] };
  const pending = [root];
  const leaves = [];
  const necks = [];
  while (pending.length) {
    const node = pending.shift();
    const found = findPartitionCut(node, contains(node.polygon, click) ? click : null);
    if (!found) return null;
    const cut = found.cut;
    if (!cut) {
      leaves.push({ ...node, seed: found.seed });
      continue;
    }
    if (!cut.neck || necks.length >= 2 || necks.some((n) => sameNeck(n, cut.neck))) return null;
    const halves = [1, -1].map((sign) => clipToSide(node.polygon, cut.neck[0], cut.neck[1], sign));
    if (halves.some((poly) => !polygonValid(poly)) ||
        Math.abs(area(halves[0]) + area(halves[1]) - area(node.polygon)) > area(node.polygon) * 0.01) return null;
    necks.push(cut.neck);
    for (let index = 0; index < 2; index++) {
      pending.push({
        polygon: halves[index],
        contour: lineContour(halves[index]),
        bounds: box(halves[index]),
        constraints: [...node.constraints, { neck: cut.neck, sign: index === 0 ? 1 : -1 }],
        parent: node,
        split: cut.neck,
      });
    }
  }
  if (leaves.length !== 3 || necks.length !== 2 || leaves.filter((leaf) => contains(leaf.polygon, click)).length !== 1 ||
      Math.abs(leaves.reduce((sum, leaf) => sum + area(leaf.polygon), 0) - area(polygon)) > area(polygon) * 0.01) return null;
  return { root, polygon, leaves, necks };
};

const applyConstraints = (poly, constraints) => {
  let out = poly;
  for (let i = 0; i < constraints.length; i++) out = clipToSide(out, constraints[i].neck[0], constraints[i].neck[1], constraints[i].sign);
  return out;
};

const ownsBoundary = (poly, neck) => {
  const length = Math.sqrt((neck[1][0] - neck[0][0]) ** 2 + (neck[1][1] - neck[0][1]) ** 2);
  if (!(length > 0)) return false;
  for (let index = 0; index < poly.length; index++) {
    const a = poly[index];
    const b = poly[(index + 1) % poly.length];
    if (Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) > 1 &&
        Math.abs(sideOf(neck, { x: a[0], y: a[1] })) / length < 0.01 &&
        Math.abs(sideOf(neck, { x: b[0], y: b[1] })) / length < 0.01) return true;
  }
  return false;
};

const boundaryNeck = (poly, neck) => {
  if (ownsBoundary(poly, neck)) return neck;
  for (let index = 0; index < poly.length; index++) {
    const edge = [poly[index], poly[(index + 1) % poly.length]];
    if (sameNeck(edge, neck) && ownsBoundary(poly, edge)) return edge;
  }
  return null;
};

// The clicked chamber first, then reading order: side by side chambers by
// x (right first in RTL), stacked ones by y
export const orderChambers = (plans, click, direction) => {
  const current = plans.find((plan) => contains(plan.cleanPolygon, click));
  if (!current) return null;
  const remaining = plans.filter((plan) => plan !== current);
  remaining.sort((p, q) => {
    const x = p.selection;
    const y = q.selection;
    const verticalOverlap = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
    if (verticalOverlap > Math.min(x.height, y.height) * 0.5) return direction === "rtl" ? y.xMid - x.xMid : x.xMid - y.xMid;
    return x.yMid - y.yMid;
  });
  return [current, ...remaining];
};

const verifyTriple = (plans, necks, click) => {
  if (plans.length !== 3 || necks.length !== 2) return false;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (!plan.connected || !polygonValid(plan.cleanPolygon) || !contains(plan.cleanPolygon, plan.click) ||
        !plan.necks.length || plan.necks.length > 2 ||
        plan.necks.some((n) => !necks.some((common) => sameNeck(n, common)) || !ownsBoundary(plan.cleanPolygon, n))) return false;
    if (findCut([lineContour(plan.cleanPolygon)], plan.click, box(plan.cleanPolygon), false)) return false;
    for (let j = 0; j < plans.length; j++) if (j !== i && contains(plan.cleanPolygon, plans[j].click)) return false;
  }
  if (necks.some((neck) => plans.filter((p) => p.necks.some((n) => sameNeck(n, neck))).length !== 2)) return false;
  const separated = (first, second, neck) => {
    const a = sideOf(neck, first.click);
    const b = sideOf(neck, second.click);
    if (a * b >= 0) return false;
    const fits = (plan) => plan.cleanPolygon.every((p) => sideOf(neck, { x: p[0], y: p[1] }) * Math.sign(sideOf(neck, plan.click)) >= -1e-5);
    return fits(first) && fits(second);
  };
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      if (!necks.some((neck) => separated(plans[i], plans[j], neck))) return false;
    }
  }
  return plans.filter((p) => contains(p.cleanPolygon, click)).length === 1;
};

// The three chambers of a triple bubble in line order, or null
export const deriveTriplePlans = (input, plan, subpaths, options = {}) => {
  if (!plan || !plan.connected || !plan.neck || plan.source !== "wand") return null;
  try {
    const click = plan.click;
    const contours = contoursAt(subpaths, click);
    let source = null;
    for (let i = 0; i < contours.length; i++) {
      if (!source || area(flatten(contours[i])) > area(flatten(source))) source = contours[i];
    }
    if (!source) return null;
    const partition = partitionContour(source, click, input.selectionBounds);
    if (!partition || !partition.necks.some((neck) => sameNeck(plan.neck, neck))) return null;
    const others = subpaths.filter((sub) => sub.contour !== source);
    const plans = [];
    for (let i = 0; i < partition.leaves.length; i++) {
      const leaf = partition.leaves[i];
      const seed = contains(leaf.polygon, click) ? click : leaf.seed;
      const parent = leaf.parent;
      if (!parent || !withinBounds(input.selectionBounds, seed)) return null;
      const chamberSubpaths = parent === partition.root ? subpaths : [{ closed: true, contour: parent.contour }, ...others];
      const built = buildBubblePlan({ ...input, selectionBounds: parent.bounds }, {
        autoClean: options.autoClean, subpaths: chamberSubpaths, click: seed,
      });
      if (!built.connected || !sameNeck(built.neck, leaf.split)) return null;
      const cleanPolygon = applyConstraints(built.cleanPolygon, leaf.constraints);
      const boundaries = partition.necks.map((neck) => boundaryNeck(cleanPolygon, neck)).filter(Boolean);
      if (!boundaries.length || !contains(cleanPolygon, seed)) return null;
      const selection = bodyBounds(cleanPolygon, box(cleanPolygon));
      plans.push({
        ...built,
        click: { ...seed },
        selectionBounds: { ...input.selectionBounds },
        cleanPolygon,
        cleanupPolygon: built.cleanupPolygon ? applyConstraints(built.cleanupPolygon, leaf.constraints) : null,
        selection: { ...selection, bubbleKind: built.kind },
        necks: boundaries,
        neck: boundaries.find((n) => sameNeck(n, built.neck)) || boundaries[0],
        triple: true,
      });
    }
    if (!verifyTriple(plans, partition.necks, click)) return null;
    return orderChambers(plans, click, input.direction);
  } catch (uncertain) {
    return null;
  }
};

// Chambers for up to `lines` script lines, in line order: [plan] when the
// bubble is single or the split is uncertain
export const chambersFor = (input, plan, subpaths, lines, options = {}) => {
  if (lines >= 3) {
    const triple = deriveTriplePlans(input, plan, subpaths, options);
    if (triple) return triple;
  }
  if (lines >= 2) {
    const sibling = deriveDoubleSibling(input, plan, subpaths, options);
    if (sibling) return [plan, sibling];
  }
  return [plan];
};
