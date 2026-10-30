// The What's new tour: when it shows, its practice script and page, and the
// state it checks its exercises with
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const createLoader = require("./helpers/loadAppModule");
const loadContext = require("./helpers/loadContext");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
// The What's new course and the tour engine it runs on
const readTour = () => read("app_src/components/modal/whatsNew.jsx") + "\n" + read("app_src/components/modal/tour.jsx");
const config = createLoader()("app_src/config.js").default;

// --- when the tour shows ---------------------------------------------------

{
  const { reducer, initial } = loadContext({ notFirstTime: true });
  assert.strictEqual(initial.whatsNewSeen, null, "An update from 2.5 has not seen the tour");
  const shown = reducer(initial, { type: "showWhatsNew" });
  assert.strictEqual(shown.modalType, "whatsNew");
  const done = reducer(shown, { type: "completeWhatsNew" });
  assert.strictEqual(done.modalType, null);
  assert.strictEqual(done.whatsNewSeen, config.whatsNewVersion, "Closing the tour marks this version as seen");
  const busy = reducer({ ...initial, modalType: "update" }, { type: "showWhatsNew" });
  assert.strictEqual(busy.modalType, "update", "The tour never replaces another window");
}

{
  const { reducer, initial } = loadContext({});
  const first = reducer(initial, { type: "showFirstRunWalkthrough" });
  assert.strictEqual(first.modalType, "walkthrough");
  assert.strictEqual(first.whatsNewSeen, config.whatsNewVersion, "A new user gets the basics, not what changed since 2.5");
}

{
  const { initial } = loadContext({ notFirstTime: true, whatsNewSeen: config.whatsNewVersion });
  assert.strictEqual(initial.whatsNewSeen, config.whatsNewVersion, "The seen version is read back from storage");
  const modalSource = read("app_src/components/modal/modal.jsx");
  assert(/whatsNewSeen !== config\.whatsNewVersion\) \{\s*context\.dispatch\(\{type: 'showWhatsNew'\}\)/.test(modalSource),
    "The panel shows the tour at startup until this version is seen");
  assert(/if \(!modalType && whatsNewSession\.active\) context\.dispatch\(\{type: 'setModal', modal: whatsNewSession\.course\}\)/.test(modalSource),
    "A window opened from the tour hands back to it");
  assert(/whatsNewSeen: config\.whatsNewVersion/.test(read("app_src/components/modal/profileSettings.jsx")),
    "A new profile does not replay the tour");
}

// --- the practice script ---------------------------------------------------

const session = createLoader({
  "./utils": { csInterface: {}, locale: {} },
  "./uxpMigration": { getNode: () => null },
})("app_src/whatsNewSession.js");

{
  const { reducer, initial } = loadContext({ notFirstTime: true });
  const script = session.buildPracticeScript();
  assert.strictEqual(script.split("\n").length, session.PRACTICE_LINES.length);
  let state = reducer(initial, { type: "addTab", name: "Practice", data: { text: script, currentLineIndex: 0 } });
  const indexes = session.PRACTICE_LINES.map((line, index) => session.findPracticeLineIndex(state.lines, index + 1));
  indexes.forEach((index, i) => {
    assert(index >= 0, "Practice line " + (i + 1) + " must be found in the parsed script");
    assert(!state.lines[index].ignore, "Practice line " + (i + 1) + " must be a dialogue line");
    if (i) assert(index > indexes[i - 1], "Practice lines keep their order");
  });
  assert.strictEqual(state.currentLineIndex, indexes[0], "The practice tab starts on bubble 1");

  // A paste records the line: that is what the exercises check
  state = reducer({ ...state, currentStyleId: state.currentStyleId || "style" }, {
    type: "commitLineBatch",
    entries: [{ lineIndex: indexes[5], styleId: "style" }, { lineIndex: indexes[6], styleId: "style" }],
    nextLineIndex: indexes[7],
  });
  assert(state.usedLineStyles[indexes[5]] && state.usedLineStyles[indexes[6]], "A double bubble paste records both lines");
  assert.strictEqual(state.currentLineIndex, indexes[7]);
}

{
  // The tour knows the practice tab id before the dispatch: getState() only
  // catches up on the next render, so reading it back gave the previous tab
  const { reducer, initial } = loadContext({ notFirstTime: true });
  const script = session.buildPracticeScript();
  let state = reducer(initial, { type: "addTab", id: "practice-test", name: "Practice", data: { text: script, currentLineIndex: 0 } });
  assert.strictEqual(state.currentTabId, "practice-test", "addTab keeps the id it is given");
  assert(state.tabs.some((tab) => tab.id === "practice-test" && tab.text === script));
  assert(/session\.practiceTabId = id;[\s\S]*type: "addTab",\s*id,/.test(readTour()),
    "The tour sets the practice tab id itself");

  // Go to line N from another tab: the line is found in the stored script
  state = reducer(state, { type: "switchTab", id: initial.currentTabId });
  const tab = state.tabs.find((item) => item.id === "practice-test");
  for (let number = 1; number <= session.PRACTICE_LINES.length; number++) {
    const index = session.findPracticeLineInText(tab.text, number);
    const switched = reducer(reducer(state, { type: "switchTab", id: tab.id }), { type: "setCurrentLineIndex", index });
    assert.strictEqual(session.findPracticeLineIndex(switched.lines, number), index, "Line " + number + " has the same index once parsed");
    assert.strictEqual(switched.currentLineIndex, index);
  }
}

{
  // The tour floats away from the script
  const dock = (layout) => session.getWhatsNewDock(layout);
  assert.strictEqual(dock({ order: ["preview", "text", "styles"], visible: {} }), "bottom");
  assert.strictEqual(dock({ order: ["preview", "styles", "text"], visible: {} }), "top");
  assert.strictEqual(dock({ order: ["preview", "text", "styles"], visible: { styles: false } }), "top");
}

{
  // Each language has its own practice lines: none may be empty or shared
  // with a script prefix
  const localeDir = path.join(root, "locale");
  const files = ["messages.properties"].concat(fs.readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name + "/messages.properties"));
  files.forEach((file) => {
    const values = {};
    fs.readFileSync(path.join(localeDir, file), "utf8").split(/\r?\n/).forEach((line) => {
      const match = line.match(/^(whatsNewPracticeLine\d+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    });
    const lines = session.PRACTICE_LINES.map((line) => values[line.key]);
    assert(lines.every((line) => line && line.trim()), file + ": every practice line is translated");
    assert.strictEqual(new Set(lines).size, lines.length, file + ": practice lines must differ, they are found by their text");
  });
}

// --- the TextShapeR exercise counters ----------------------------------------

{
  const { reducer, initial, writes } = loadContext({ notFirstTime: true });
  let state = reducer(initial, { type: "recordTextShapeRUse" });
  state = reducer(state, { type: "recordTextShapeRUse" });
  assert.strictEqual(state.textShapeRAppliedThisSession, 2, "Every applied shape counts, past the learn tip threshold too");
  state = reducer(state, { type: "setTextShapeRTuning", value: state.textShapeRTuning, learned: true });
  assert.strictEqual(state.textShapeRLearnedThisSession, 1);
  assert(writes.every(([data]) => !("textShapeRAppliedThisSession" in data) && !("textShapeRLearnedThisSession" in data)),
    "The session counters are never stored");
}

// --- chapters ---------------------------------------------------------------

{
  const source = readTour();
  const chapters = source.slice(source.indexOf("const getChapters"), source.indexOf("const COURSE"));
  const ids = (chapters.match(/^\s{8}id: "(\w+)"/gm) || []).map((line) => line.trim().slice(5, -1));
  assert(ids.length >= 20, "The chapters list their steps");
  assert.strictEqual(new Set(ids).size, ids.length, "Step ids are unique: progress is stored by id");
  const minutes = (chapters.match(/^\s{4}minutes: ([\d.]+),/gm) || []).map((line) => parseFloat(line.split(":")[1]));
  assert.strictEqual(minutes.length, 7, "Every chapter announces its duration");
  assert.strictEqual(minutes.reduce((sum, value) => sum + value, 0), 4.5, "The tour takes about 4 and a half minutes");
}

// --- the practice page ---------------------------------------------------------

{
  const page = fs.readFileSync(path.join(root, "app_src/assets/typer-practice-page.png"));
  assert.strictEqual(page.toString("ascii", 1, 4), "PNG");
  assert.deepStrictEqual([page.readUInt32BE(16), page.readUInt32BE(20)], [1200, 1900], "The practice page keeps its layout");
  assert(page.length < 300 * 1024, "The practice page stays light");
  assert(/app_src\/assets\/typer-practice-page\.png/.test(read("scripts/finalizeBuild.js")), "The CEP build ships the practice page");
  assert(/app_src\/assets\/typer-practice-page\.png/.test(read("scripts/buildUxp.js")), "The UXP build ships the practice page");
  assert(/\/app\/assets\/" \+ PRACTICE_PAGE/.test(read("app_src/whatsNewSession.js")), "CEP opens the page from the extension");
  assert(/practicePagePath,/.test(read("uxp-src/host/services.js")), "UXP opens the page from the plugin");
}

// --- the practice page bubbles, as smart paste sees them ------------------------
//
// The exercises expect bubbles 1-4 and 8 regular, 5 black, 6 a double bubble
// of two regular parts and 7 a shout. Read from the page's SVG source, as the
// Magic Wand would select them (inside the 5 px outline).

{
  const engine = createLoader();
  const geometry = engine("app_src/oneClick/geometry.js");
  const bubblePlan = engine("app_src/oneClick/bubblePlan.js");
  const connected = engine("app_src/oneClick/connected.js");
  const svg = read("app_src/assets/typer-practice-page.svg");
  const attr = (tag, name) => parseFloat((tag.match(new RegExp(" " + name + "=\"([^\"]+)\"")) || [])[1]);
  const px = (value) => ({ _unit: "pixelsUnit", _value: value });
  const pathOf = (poly) => ({ pathContents: { pathComponents: [{ subpathListKey: [{ closedSubpath: true, points: poly.map((p) => ({ anchor: { horizontal: px(p[0]), vertical: px(p[1]) }, forward: { horizontal: px(p[0]), vertical: px(p[1]) }, backward: { horizontal: px(p[0]), vertical: px(p[1]) } })) }] }] } });
  const inset = 2.5;
  const ellipses = (svg.match(/<ellipse [^>]*stroke-width="5"[^>]*>/g) || []).map((tag) => ({ cx: attr(tag, "cx"), cy: attr(tag, "cy"), rx: attr(tag, "rx") - inset, ry: attr(tag, "ry") - inset }));
  const black = (svg.match(/<ellipse [^>]*fill="#000000"[^>]*>/) || [])[0];
  const outline = (e, n = 240) => Array.from({ length: n }, (_, i) => [e.cx + e.rx * Math.cos((i / n) * Math.PI * 2), e.cy + e.ry * Math.sin((i / n) * Math.PI * 2)]);
  const inside = (p, e) => ((p[0] - e.cx) / e.rx) ** 2 + ((p[1] - e.cy) / e.ry) ** 2 < 1 - 1e-6;
  const overlaps = (a, b) => outline(a).some((p) => inside(p, b));
  const page = { width: 1200, height: 1900, resolution: 72, documentId: 1 };
  const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
  const planOf = (poly, click, fill = white) => {
    const b = geometry.box(poly);
    const input = { ...page, source: "wand", click, fill, rawPath: pathOf(poly),
      selectionBounds: { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) } };
    return { input, plan: bubblePlan.buildPlan(input, {}) };
  };

  const pair = ellipses.filter((e) => ellipses.some((other) => other !== e && overlaps(e, other)));
  const singles = ellipses.filter((e) => pair.indexOf(e) === -1);
  assert.strictEqual(singles.length, 5, "Bubbles 1, 2, 3, 4 and 8");
  singles.forEach((e) => {
    assert.strictEqual(planOf(outline(e), { x: e.cx, y: e.cy }).plan.kind, "regular", "Bubble at " + e.cx + "," + e.cy + " is a regular bubble");
  });

  assert(black, "Bubble 5 is pure black: smart paste only turns text white on black");
  const dark = { cx: attr(black, "cx"), cy: attr(black, "cy"), rx: attr(black, "rx"), ry: attr(black, "ry") };
  assert.deepStrictEqual(planOf(outline(dark), { x: dark.cx, y: dark.cy }, { fill: 0, rgb: { red: 0, green: 0, blue: 0 } }).plan.textColor,
    { red: 255, green: 255, blue: 255 });

  assert.strictEqual(pair.length, 2, "Bubble 6 is two overlapping ellipses");
  const [a, b] = pair;
  const union = outline(a).filter((p) => !inside(p, b)).concat(outline(b).filter((p) => !inside(p, a)));
  const mid = [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2];
  union.sort((p, q) => Math.atan2(p[1] - mid[1], p[0] - mid[0]) - Math.atan2(q[1] - mid[1], q[0] - mid[0]));
  const double = planOf(union, { x: a.cx, y: a.cy });
  assert.strictEqual(double.plan.connected, true, "Bubble 6 is found as a double bubble");
  const chambers = connected.chambersFor(double.input, double.plan, bubblePlan.subpathsFromDescriptor(double.input.rawPath, 72), 2, {});
  assert.deepStrictEqual(chambers.map((chamber) => chamber.kind), ["regular", "regular"], "Its parts are regular, not shouts");

  const star = (svg.match(/<polygon points="([^"]+)"/) || [])[1];
  assert(star, "Bubble 7 is a spiky polygon");
  const spikes = star.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
  const center = spikes.reduce((sum, p) => [sum[0] + p[0] / spikes.length, sum[1] + p[1] / spikes.length], [0, 0]);
  const shrunk = spikes.map((p) => {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
    return [center[0] + ((p[0] - center[0]) * (d - inset)) / d, center[1] + ((p[1] - center[1]) * (d - inset)) / d];
  });
  assert.strictEqual(planOf(shrunk, { x: center[0], y: center[1] }).plan.kind, "shout", "Bubble 7 is found as a shout");
}

// --- the user does every gesture -----------------------------------------------
//
// The guide rings the real control (whatsNewSpotlight.js) instead of doing
// the gesture: it only opens the practice page and loads its script. Its
// paste, toggle and window buttons are fallbacks for a control hidden in
// the user's layout.

{
  const tour = readTour();
  const chapters = tour.slice(tour.indexOf("const getChapters"), tour.indexOf("const COURSE"));
  const actions = (chapters.match(/^\s+actions: \[[^\]]*\]/gm) || []).map((line) => (line.match(/type: "(\w+)"/) || [])[1]);
  assert.deepStrictEqual(actions.sort(), ["loadScript", "openPage"], "Only the practice page and script are set up for the user");
  assert(!/resultActions|type: "open"|createShoutStyle/.test(chapters), "No step opens a window for the user");

  // Every ringed control exists in the panel, under the same name
  const sources = [
    "app_src/components/footer/footer.jsx",
    "app_src/components/previewBlock/previewBlock.jsx",
    "app_src/components/stylesBlock/stylesBlock.jsx",
    "app_src/components/modal/editStyle.jsx",
  ].map(read).join("\n");
  const footer = read("app_src/components/footer/footer.jsx");
  const settings = read("app_src/components/modal/settings.jsx");
  const names = (tour.match(/tour\("([\w-]+)"\)/g) || []).map((call) => call.slice(6, -2));
  assert(names.length >= 6, "The steps ring the panel controls");
  names.forEach((name) => {
    if (name.startsWith("mode-")) {
      assert(/data-tour=\{"mode-" \+ mode\.id\}/.test(footer), "The footer toggles carry their id");
      assert(new RegExp(`id: "${name.slice(5)}"`).test(footer), "Footer toggle " + name.slice(5) + " exists");
    } else {
      assert(sources.includes(`data-tour="${name}"`), "Control " + name + " carries data-tour");
    }
  });
  const footerNeeds = (tour.match(/footer: "(\w+)"/g) || []).map((need) => need.slice(9, -1));
  footerNeeds.forEach((id) => assert(new RegExp(`id: "${id}"`).test(footer), "Footer toggle " + id + " exists"));
  assert(/data-tour=\{"settings-" \+ tab\.id\}/.test(settings), "The settings tabs carry their id");
  (tour.match(/(?:unlessActive|activeSettingsTab)\("(\w+)"\)/g) || []).forEach((call) => {
    const id = call.match(/"(\w+)"/)[1];
    assert(new RegExp(`id: "${id}"`).test(settings), "Settings tab " + id + " exists");
  });
  assert(/data-tour-tab=\{tab\.id\}/.test(read("app_src/components/tabBar/tabBar.jsx")), "Tabs carry their id");
  assert(/className="text-line-select"/.test(read("app_src/components/textBlock/textBlock.jsx")), "Script lines keep their target");
  assert(/\.style-edit-size-section/.test(chapters) && /className="style-edit-size-section"/.test(read("app_src/components/modal/editStyle.jsx")),
    "The size presets section is found in the style editor");
  assert(/className=\{"preview-textshaper hostBgdDark"/.test(read("app_src/components/previewBlock/previewBlock.jsx")) &&
    /className=\{"preview-textshaper-markbest"/.test(read("app_src/components/previewBlock/previewBlock.jsx")),
    "TextShapeR suggestions and star are found");

  // A window the tour sends the user to keeps the step's tip
  const modal = read("app_src/components/modal/modal.jsx");
  assert(/whatsNewSession\.coach\.modal === modalType/.test(modal), "The tip shows only in the window of its step");
  (chapters.match(/coachIn: "(\w+)"/g) || []).forEach((entry) => {
    assert(/^(settings|editStyle)$/.test(entry.slice(10, -1)), "Tips go to a window the panel opens");
  });

  // The guide is dragged by its header and moves away from the ring, but a
  // drop by hand wins until the next target
  const guide = read("app_src/whatsNewGuide.js");
  assert(/avoidRing\(rect, spot\.key\)/.test(read("app_src/whatsNewSpotlight.js")), "The ring pushes the guide away");
  assert(/session\.guideLockKey && session\.guideLockKey === lockKey/.test(guide), "A guide dropped by hand stays for its target");
  assert(/session\.guideLockKey = lockKey/.test(guide), "Dropping the guide locks it for the target");
  assert((tour.match(/onMouseDown=\{dragGuide\}/g) || []).length === 2, "Both the open and the folded guide can be dragged");
  assert(!/whatsNewDock(Top|Bottom)/.test(tour), "No more button to move the guide");
  assert(/getGuideStyle\(\)/.test(modal) && /key=\{floating \? 'tour-' \+ modalType/.test(modal),
    "modal.jsx places the dragged guide on its own element");
}

{
  // Closing the tour keeps its progress: reopening it offers to resume, and
  // starting over forgets the old run
  const items = {};
  global.window = {
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null),
      setItem: (key, value) => { items[key] = String(value); },
      removeItem: (key) => { delete items[key]; },
    },
  };
  const run = session.whatsNewSession;
  const reopen = () => {
    session.endWhatsNewSession();
    session.startWhatsNewSession(8);
  };
  run.active = false;
  session.startWhatsNewSession(8);
  assert.strictEqual(run.resumeOffer, null, "A first run starts at the intro");
  run.chapter = 3;
  run.done.someStep = true;
  run.guidePos = { left: 12, anchor: "bottom", offset: 8 };
  run.startValues = { enableClick: "true" };
  reopen();
  assert.strictEqual(run.chapter, 0, "The guide asks before resuming");
  assert.strictEqual(run.resumeOffer.chapter, 3);
  reopen();
  assert(run.resumeOffer && run.resumeOffer.chapter === 3, "Closing the question keeps the saved run");
  session.resumeWhatsNewSession(true);
  assert.strictEqual(run.resumeOffer, null);
  assert.strictEqual(run.chapter, 3, "Resume goes back to the same chapter");
  assert.strictEqual(run.done.someStep, true, "Resume keeps the steps done");
  assert.deepStrictEqual(run.guidePos, { left: 12, anchor: "bottom", offset: 8 }, "Resume puts the guide back");
  assert.deepStrictEqual(run.startValues, { enableClick: "true" }, "Resume keeps the settings that were already there");
  reopen();
  session.resumeWhatsNewSession(false);
  assert.strictEqual(run.chapter, 0, "Start over goes back to the intro");
  assert.deepStrictEqual(run.done, {}, "Start over clears the steps done");
  assert.strictEqual(run.startValues, null, "Start over reads the settings again");
  reopen();
  assert.strictEqual(run.resumeOffer, null, "Start over forgets the old run");
  run.chapter = 9;
  reopen();
  assert.strictEqual(run.resumeOffer, null, "A finished run starts again from the intro");
  items["typer.whatsNewProgress"] = "{broken";
  run.active = false;
  session.startWhatsNewSession(8);
  assert.strictEqual(run.resumeOffer, null, "A broken save starts a new run");
  run.active = false;
  delete global.window;

  // Start over: a practice tab from the earlier run is reused blank, and a
  // setting already there must be changed again to pass its step
  const { reducer, initial } = loadContext({ notFirstTime: true });
  let practice = reducer(initial, { type: "addTab", name: "Practice", data: { text: session.buildPracticeScript(), currentLineIndex: 0 } });
  practice = reducer(practice, { type: "setCurrentStyleId", id: (practice.styles[0] || {}).id || null });
  practice = reducer(practice, { type: "commitLineBatch", entries: [{ lineIndex: 0, styleId: "s" }, { lineIndex: 1, styleId: "s" }], nextLineIndex: 2 });
  assert.strictEqual(Object.keys(practice.usedLineStyles).length, 2);
  const blank = reducer(practice, { type: "clearPastedLines" });
  assert.deepStrictEqual(blank.usedLineStyles, {}, "The reused practice tab has nothing pasted");
  assert.strictEqual(blank.currentLineIndex, 0, "It starts again from line 1");
  assert.deepStrictEqual(blank.tabs.find((tab) => tab.id === blank.currentTabId).usedLineStyles, {}, "The tab itself is cleared");

  const tour = readTour();
  assert(/dispatch\(\{ type: "switchTab", id: existing\.id \}\);\s*dispatch\(\{ type: "clearPastedLines" \}\)/.test(tour),
    "A practice tab from an earlier run is reused blank");
  assert(/if \(!session\.resumeOffer && !session\.startValues\) session\.startValues = takeStartValues/.test(tour),
    "The settings already there are read when the run begins");
  // A role style already there is used, not made again
  ["shoutStyle", "narrationStyle"].forEach((id) => {
    const block = tour.slice(tour.indexOf('id: "' + id + '"'), tour.indexOf('id: "' + id + '"') + 2000).split("result:")[0];
    assert(!/fresh: /.test(block) && !/again: /.test(block), id + " passes with the style already marked");
    assert(/marks: \(env\) => roleMarks\("\w+", env\)/.test(block), id + " outlines every style that can take the role, none is forced");
  });
  // A value seen turned off drops the start value, even though the check fails
  assert(/const held = heldOver\(step, env\);\s*passed = step\.check\(env\) && !held;/.test(tour), "Turning a setting off and on again passes its step");
  // Toggles already on are shown for a moment, then pass by themselves
  ["enableClick", "enableShapeR", "autoCenter"].forEach((id) => {
    const block = tour.slice(tour.indexOf('id: "' + id + '"'), tour.indexOf('id: "' + id + '"') + 900).split("result")[0];
    assert(/preset: true/.test(block) && !/fresh: /.test(block), id + " passes by itself when already on");
  });
  assert(/if \(step\.preset\) return "todo";/.test(tour), "A toggle step passes only once the guide gets to it");
  assert(/const timer = setTimeout\(pass, 2000\);/.test(tour), "A toggle already on is shown for 2 seconds");
  assert(/check: \(env\) => !!env\.currentStyle && session\.stylePicked === true/.test(tour),
    "An active style does not pass the style step: the user clicks one");
  assert(/target\.closest\('\.style-item, \[data-tour="add-style"\]'\)/.test(tour), "A click in the style list picks the style");
  assert(/className=\{"style-item/.test(read("app_src/components/stylesBlock/stylesBlock.jsx")) ||
    /"style-item/.test(read("app_src/components/stylesBlock/stylesBlock.jsx")), "Style rows keep their class");
  assert(/React\.useEffect\(saveWhatsNewProgress\)/.test(tour), "Every change of the tour is saved");
  assert(/startWhatsNewSession\(chapters\.length, course\.id\)/.test(tour), "The tour looks for a run to resume when it opens");
}

{
  // The tour goes in order: Next and later chapters open once the chapter is
  // done (a skipped step counts), and a finished chapter moves on by itself
  const tour = readTour();
  assert(/session\.done\[step\.id\] = "skipped";/.test(tour), "The current step can be skipped");
  assert(/\{stepTodo && \(\s*<button[\s\S]{0,120}className="whats-new-skip"/.test(tour), "Skip is offered only on a step to do");
  assert(/if \(record === "skipped"\) return "skipped";/.test(tour) &&
    /chapter\.steps\.every\(\(step\) => stepState\(step, env\) !== "todo"\)/.test(tour),
    "A skipped step completes its chapter");
  assert(/if \(id && session\.done\[id\] === "skipped"\) delete session\.done\[id\];/.test(tour),
    "A skipped step opened again is to do after all");
  assert(!/whatsNewNextChapterSkip/.test(tour), "A whole chapter cannot be skipped from Next");
  assert(/const chapterOpen = \(index\) => chapters\.slice\(0, Math\.max\(0, index - 1\)\)\.every\(\(item\) => chapterComplete\(item, env\)\)/.test(tour),
    "A chapter opens once the chapters before it are done");
  assert(/if \(!chapterOpen\(target\)\) return;/.test(tour), "goTo never jumps past an unfinished chapter");
  assert(/disabled=\{!isEnd && !chapterOpen\(view \+ 1\)\}/.test(tour), "Next waits for the chapter");
  assert(/disabled=\{locked\}/.test(tour), "Locked chapters cannot be opened from the contents");
  assert(/disabled=\{states\[index\] === "todo" && index !== firstTodo\}/.test(tour), "A later step cannot be opened before its turn");
  assert(/if \(shown\.view === view && !shown\.done && chapterDone\) goTo\(view \+ 1\);/.test(tour), "A finished chapter moves on right away");
  assert(!/whatsNewAutoNext|setTimeout\(\(\) => \{\s*setAutoNext/.test(tour), "No waiting screen between chapters");

  // The undo step waits for bubble 4 to be pasted back
  const undo = tour.slice(tour.indexOf('id: "undo"'), tour.indexOf('id: "bubbles"'));
  assert(/session\.undoSeen = true;\s*return false;/.test(undo), "The undo alone does not pass the step");
  assert(/if \(env\.isPasted\(5\)\) return true;/.test(undo), "Going on to the black bubble passes the undo step");
  assert(/session\.undoSeen && env\.isPasted\(4\) && env\.state\.currentLineIndex === env\.lineIndex\(5\)/.test(undo),
    "Bubble 4 has to be pasted back");
}

{
  // The ring darkens the rest of the panel, under the guide; in a window
  // opened over the panel it only rings the control, above that window
  const spotlight = read("app_src/whatsNewSpotlight.js");
  const styles = read("app_src/components/modal/modal.scss");
  assert(/const dim = !blockingModal\(\);/.test(spotlight), "No darkening over a window opened over the panel");
  const zOf = (block) => Number((/z-index: (\d+);/.exec(block) || [])[1]);
  const dimBlock = styles.slice(styles.indexOf("&.m-dim {"), styles.indexOf("&.m-dim {") + 300);
  const modalBlock = styles.slice(styles.indexOf(".app-modal {"), styles.indexOf(".app-modal {") + 100);
  assert(/9999px rgba\(0, 0, 0, 0\.55\)/.test(dimBlock), "The panel around the ring goes dark");
  assert(zOf(dimBlock) < zOf(modalBlock), "The darkening stays under the guide");
}

{
  // The star of the TextShapeR chapter learns only for the tour: the user's
  // learning is copied when the chapter opens and given back afterwards,
  // even after Photoshop closed in the middle of the chapter
  const items = {};
  global.window = {
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null),
      setItem: (key, value) => { items[key] = String(value); },
      removeItem: (key) => { delete items[key]; },
    },
  };
  const own = { samples: 3, exemplars: [{ text: "mine" }] };
  const actions = [];
  const dispatch = (action) => actions.push(action);
  session.backupTourTuning({ textShapeRTuning: own, textShapeRLearnUsed: true });
  session.backupTourTuning({ textShapeRTuning: { samples: 4 }, textShapeRLearnUsed: true });
  session.restoreTourTuning(dispatch);
  assert.deepStrictEqual(actions, [{ type: "restoreTextShapeRTuning", value: own, learnUsed: true }], "The learning from before the chapter comes back");
  assert.strictEqual(items["typer.whatsNewTuningBackup"], undefined, "The copy is dropped once given back");
  session.restoreTourTuning(dispatch);
  assert.strictEqual(actions.length, 1, "Nothing to give back twice");

  // Photoshop quit during the chapter: the next panel start gives it back
  session.backupTourTuning({ textShapeRTuning: null, textShapeRLearnUsed: false });
  const saved = items["typer.whatsNewTuningBackup"];
  session.restoreTourTuning(() => {});
  items["typer.whatsNewTuningBackup"] = saved;
  session.restoreTourTuning(dispatch);
  assert.deepStrictEqual(actions[1], { type: "restoreTextShapeRTuning", value: null, learnUsed: false }, "A user who never taught TextShapeR gets an empty learning back");
  delete global.window;

  const { reducer, initial } = loadContext({ notFirstTime: true });
  const learned = reducer(initial, { type: "setTextShapeRTuning", value: { samples: 1 }, learned: true });
  assert.strictEqual(learned.textShapeRLearnUsed, true);
  const back = reducer(learned, { type: "restoreTextShapeRTuning", value: null, learnUsed: false });
  assert.strictEqual(back.textShapeRTuning, null, "The tour lesson is gone");
  assert.strictEqual(back.textShapeRLearnUsed, false, "The learn tip is not marked as used by the tour");

  const tour = readTour();
  assert(/if \(chapter && chapter\.id === "textShapeR"\) backupTourTuning\(getState\(\)\);\s*else restoreTourTuning\(dispatch\);/.test(tour),
    "Leaving the TextShapeR chapter gives the learning back");
  assert(/const close = \(\) => \{\s*clearTourSpot\(\);\s*restoreTourTuning\(dispatch\);/.test(tour), "Closing the tour gives it back");
  assert(/if \(!whatsNewSession\.active\) restoreTourTuning\(context\.dispatch\);/.test(read("app_src/components/modal/modal.jsx")),
    "The panel start gives back a lesson left by a closed Photoshop");
}

{
  // The page has a spot without a bubble for the rectangle, and a narration
  // box made like the shout exercise: one line each, in reading order
  const tour = readTour();
  const keys = session.PRACTICE_LINES.map((line) => line.key);
  assert.strictEqual(keys.length, 11, "One line per spot, two for the double bubble");
  assert.strictEqual(keys[4], "whatsNewPracticeLine10", "Line 5 goes into the dotted frame");
  assert.strictEqual(keys[10], "whatsNewPracticeLine11", "The last line goes into the narration box");
  const stepOf = (id) => tour.slice(tour.indexOf('id: "' + id + '"'), tour.indexOf('id: "' + id + '"') + 1500).split("result")[0];
  assert(/line: 5,/.test(stepOf("rectangle")) && /footer: "pasteOnClick"/.test(stepOf("rectangle")), "The rectangle step pastes line 5 on click");
  assert(tour.indexOf('id: "rectangle"') < tour.indexOf('id: "bubbles"'), "The rectangle is part of the paste on click chapter");
  [["shoutStyle", "shout"], ["narrationStyle", "narration"]].forEach(([id, role]) => {
    const block = stepOf(id);
    assert(new RegExp('role: "' + role + '"').test(block), id + " is a role exercise");
    assert(new RegExp('spot: \\(env\\) => roleSpot\\("' + role + '", env\\)').test(block), id + " rings the real controls");
  });
  assert(/line: 11,/.test(stepOf("narration")) && /env\.usedStyleId\(11\) === env\.narrationStyle\.id/.test(tour),
    "The narration box checks that the Narration style was used");
  assert(/env\.usedStyleId\(10\) === env\.shoutStyle\.id/.test(tour), "The shout bubble is line 10");
  const svg = read("app_src/assets/typer-practice-page.svg");
  assert(/stroke-dasharray/.test(svg), "The page shows where to draw the rectangle");
  for (let number = 1; number <= 10; number++) {
    assert(new RegExp('fill="#ffffff">' + number + "</text>").test(svg), "Spot " + number + " is numbered on the page");
  }
}

console.log("What's new tour tests passed");
