const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the host callback used by both automatic and interactive updates.
// Photoshop's showAlert cannot select a success icon: it must only receive errors.
const source = fs.readFileSync(path.join(__dirname, "../uxp-src/host/main.js"), "utf8");
const callback = source.slice(source.indexOf("function nativeAlert(data)"), source.indexOf("function nativeConfirm(data)"));
const nativeMessages = [];
const nodes = [];
let dialogOptions;
const createElement = (tag) => {
  let dismiss;
  const node = {
    tag, style: {}, attributes: {}, children: [], events: {},
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.events[name] = handler; },
    remove() { this.removed = true; },
    close() { dismiss(); },
    uxpShowModal(options) { dialogOptions = options; return new Promise(resolve => { dismiss = resolve; }); },
  };
  nodes.push(node);
  return node;
};
const scope = {
  ps: { app: { showAlert: (text) => { nativeMessages.push(text); return Promise.resolve(); } } },
  document: { createElement, body: createElement("body") },
  readLocaleStrings: () => ({ successTitle: "Succès" }),
};
vm.runInNewContext(callback + "\nthis.alert = nativeAlert;", scope);
(async () => {
  assert.strictEqual(await scope.alert(null), "");
  assert.strictEqual(await scope.alert({ text: "Installation failed", isError: true }), "");
  assert.deepStrictEqual(nativeMessages, ["Installation failed"]);
  const success = scope.alert({ text: "TypeR installé. Redémarrez Photoshop.", title: "Succès", isError: false });
  assert.strictEqual(dialogOptions.title, "Succès");
  assert.strictEqual(nodes.find(node => node.tag === "sp-icon").attributes.name, "ui:SuccessMedium");
  assert.strictEqual(nodes.find(node => node.tag === "sp-body").textContent, "TypeR installé. Redémarrez Photoshop.");
  assert.strictEqual(nativeMessages.length, 1, "success never opens Photoshop's warning alert");
  nodes.find(node => node.tag === "sp-button").events.click();
  assert.strictEqual(await success, "");
  assert.ok(nodes.find(node => node.tag === "dialog").removed, "dismissal cleans up the dialog");
  nodes.length = 0;
  const information = scope.alert({ text: "Information", title: "TypeR" });
  assert.strictEqual(nodes.find(node => node.tag === "sp-icon").attributes.name, "ui:InfoMedium");
  nodes.find(node => node.tag === "dialog").events.keydown({ key: "Enter" });
  assert.strictEqual(await information, "");
  console.log("UXP success/error alert tests passed");
})().catch(error => { console.error(error); process.exit(1); });
