const assert = require("assert");
const fs = require("fs");
const path = require("path");
const React = require("react");
const slots = [];
const effects = [];
let cursor = 0;
const hooks = {
  ...React,
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect(effect) {
    const index = cursor++;
    if (!(index in slots)) { slots[index] = true; effects.push(effect()); }
  },
};
const locale = {};
fs.readFileSync(path.join(__dirname, "../locale/messages.properties"), "utf8").split(/\r?\n/).forEach((line) => {
  const split = line.indexOf("=");
  if (split > 0) locale[line.slice(0, split)] = line.slice(split + 1);
});
const requests = [];
const committed = [];
const lessons = [];
const context = {
  state: { textShapeRTuning: { samples: 4 } },
  dispatch(action) { committed.push(action); context.state.textShapeRTuning = action.value; },
};
let liveTuning = context.state.textShapeRTuning;
const load = require("./helpers/loadAppModule")({
  react: hooks,
  "./textShapeRTraining.scss": {},
  "../../utils": { locale, scanTextShapeRTraining: (file, callback) => requests.push({ file, callback }) },
  "../../context": { useContext: () => context },
  "../../textShapeR": {
    setTextShapeRTuning(value) { liveTuning = value; },
    recordTextShapeRFeedback(text, options, tuning) { lessons.push(text); return { tuning: { samples: tuning.samples + 1 } }; },
  },
});
const Component = load("app_src/components/modal/textShapeRTraining.jsx").default;
const render = () => { cursor = 0; return Component(); };
const nodes = (tree) => {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.reduce((all, child) => all.concat(nodes(child)), []);
  return [tree].concat(nodes(tree.props && tree.props.children));
};
const text = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props && node.props.children);
};
const button = (tree, label) => nodes(tree).find((node) => node.type === "button" && text(node).trim() === label);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
  const previousWindow = global.window;
  global.window = { cep: { fs: { showOpenDialogEx(multiple, folders, title, start, extensions) {
    assert.strictEqual(multiple, true);
    assert.strictEqual(folders, false);
    assert.deepStrictEqual(extensions, ["psd"]);
    return { err: 0, data: ["/pages/2.psd", "/pages/1.psd"] };
  } } } };
  try {
    let tree = render();
    const pick = button(tree, locale.textShapeRTrainPick);
    assert.strictEqual(pick.props.disabled, false);
    pick.props.onClick();
    pick.props.onClick();
    assert.strictEqual(requests.length, 1, "Repeated clicks must not start overlapping imports");
    assert.strictEqual(requests[0].file, "/pages/1.psd");
    requests[0].callback({ entries: [
      { name: "One", text: "First\ntext", visible: true },
      { name: "Hidden", text: "Hidden text", visible: false },
      { name: "Two", text: "Second\ntext", visible: true },
    ] });
    await flush();
    assert.strictEqual(requests.length, 2);
    requests[1].callback({ entries: [{ name: "Three", text: "Third\ntext", visible: true }] });
    await flush();
    tree = render();
    assert(text(tree).includes("3 / 4 text layers selected"));
    assert.strictEqual(committed.length, 0, "Scanning and review must not commit learning");
    const firstRow = nodes(tree).find((node) => node.type === "label" && node.props.className === "textshaper-training-layer");
    nodes(firstRow).find((node) => node.type === "input").props.onChange();
    tree = render();
    assert(text(tree).includes("2 / 4 text layers selected"));
    await button(tree, locale.textShapeRTrainValidate).props.onClick();
    tree = render();
    assert.deepStrictEqual(lessons, ["Second\ntext", "Third\ntext"]);
    assert.strictEqual(committed.length, 1);
    assert.strictEqual(liveTuning.samples, 6);
    assert.strictEqual(button(tree, locale.textShapeRTrainValidate).props.disabled, true, "Completed selection must not be accidentally trained twice");
    assert(text(tree).includes("Learned from 2 text layers."));

    button(tree, locale.textShapeRTrainSelectAll).props.onClick();
    tree = render();
    assert(text(tree).includes("4 / 4 text layers selected"));
    const training = button(tree, locale.textShapeRTrainValidate).props.onClick();
    tree = render();
    button(tree, locale.cancel).props.onClick();
    await training;
    tree = render();
    assert.strictEqual(committed.length, 1, "Cancelled training must not commit a partial result");
    assert(text(tree).includes(locale.textShapeRTrainCancelled));

    button(tree, locale.textShapeRTrainPick).props.onClick();
    const request = requests[requests.length - 1];
    const count = requests.length;
    effects.forEach((cleanup) => { if (cleanup) cleanup(); });
    request.callback({ entries: [] });
    await flush();
    assert.strictEqual(requests.length, count, "Closing settings stops before the next PSD");
  } finally {
    global.window = previousWindow;
  }
  console.log("TextShapeR settings import, review, validation and cancellation UI tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
