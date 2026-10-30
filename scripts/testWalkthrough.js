// The basics walkthrough: its practice script and page, the steps it checks,
// and how it shares the tour engine with What's new
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const createLoader = require("./helpers/loadAppModule");
const loadContext = require("./helpers/loadContext");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const walkthrough = read("app_src/components/modal/walkthrough.jsx");
const engine = read("app_src/components/modal/tour.jsx");
const chapters = walkthrough.slice(walkthrough.indexOf("const getChapters"), walkthrough.indexOf("const COURSE"));

const loadSession = (locale = {}) => createLoader({
  "./utils": { csInterface: {}, locale },
  "./uxpMigration": { getNode: () => null },
})("app_src/whatsNewSession.js");
const session = loadSession();
const COURSE = "walkthrough";

// --- when it shows ------------------------------------------------------------

{
  const { reducer, initial } = loadContext({});
  const first = reducer(initial, { type: "showFirstRunWalkthrough" });
  assert.strictEqual(first.modalType, "walkthrough", "A new user starts with the walkthrough");
  const done = reducer(first, { type: "completeWalkthrough" });
  assert.strictEqual(done.modalType, null);
  assert.strictEqual(done.notFirstTime, true);
  assert(session.isTourModal("walkthrough") && session.isTourModal("whatsNew"), "Both tours float over the panel");
  assert.strictEqual(session.isBlockingModal("walkthrough"), false, "The shortcuts keep working during the walkthrough");
  assert.strictEqual(session.isBlockingModal("settings"), true);
  assert(/completeAction: "completeWalkthrough"/.test(walkthrough), "Closing the walkthrough marks it as done");
}

// --- the practice script ---------------------------------------------------------

{
  const { reducer, initial } = loadContext({ notFirstTime: true });
  const script = session.buildPracticeScript(COURSE);
  const raw = script.split("\n");
  assert.strictEqual(raw[0], "Page 1", "The script starts with a page marker TypeR reads in every language");
  assert(raw.some((line) => line.startsWith("## ")), "The script has a translator note");
  let state = reducer(initial, { type: "addTab", id: "basics", name: "Practice", data: { text: script, currentLineIndex: 0 } });
  const indexes = session.BASICS_LINES.map((line, i) => session.findPracticeLineIndex(state.lines, i + 1, COURSE));
  indexes.forEach((index, i) => {
    assert(index >= 0, "Practice line " + (i + 1) + " is found in the parsed script");
    assert(!state.lines[index].ignore, "Practice line " + (i + 1) + " is a dialogue line");
    if (i) assert(index > indexes[i - 1], "Practice lines keep their order");
  });
  assert(state.lines[0].ignore, "The page marker is skipped");
  assert.strictEqual(state.currentLineIndex, indexes[0], "The practice tab starts on line 1");

  // The script chapter: line 2, then the next line skips the note
  state = reducer(state, { type: "setCurrentLineIndex", index: indexes[1] });
  state = reducer(state, { type: "nextLine" });
  assert.strictEqual(state.currentLineIndex, indexes[2], "Next goes from line 2 to line 3, over the note");
  assert(indexes[2] - indexes[1] === 2 && state.lines[indexes[1] + 1].ignore, "The note sits between lines 2 and 3");

  // The shout chapter: a copy of the dialogue style with the prefix picks
  // line 4, which is pasted without the prefix
  const prefix = session.basicsShoutPrefix();
  state = reducer(state, { type: "saveStyle", data: { id: "dialogue", name: "Dialogue", folder: null, prefixes: "" } });
  state = reducer(state, { type: "setCurrentStyleId", id: "dialogue" });
  state = reducer(state, { type: "duplicateStyle" });
  const copyId = state.currentStyleId;
  assert.notStrictEqual(copyId, "dialogue", "Duplicate makes the copy active");
  state = reducer(state, { type: "saveStyle", data: { ...state.styles.find((style) => style.id === copyId), name: "Shout", prefixes: prefix + "\n" } });
  state = reducer(state, { type: "setCurrentStyleId", id: "dialogue" });
  const shoutLine = state.lines[indexes[3]];

  // Line 4 is already the current line when the Shout style is made (after
  // the caption paste): a paste uses the current style, so the walkthrough
  // picks the line again and its tag style becomes current
  let onLine4 = reducer(state, { type: "setCurrentLineIndex", index: indexes[3] });
  onLine4 = reducer(onLine4, { type: "setCurrentStyleId", id: "dialogue" });
  assert.strictEqual(onLine4.currentStyleId, "dialogue", "Making the style does not switch by itself");
  assert.strictEqual(reducer(onLine4, { type: "setCurrentLineIndex", index: onLine4.currentLineIndex }).currentStyleId, "dialogue",
    "Moving to the line it is already on does not switch the style");
  const tagStyle = onLine4.lines[onLine4.currentLineIndex].style;
  assert.strictEqual(tagStyle && tagStyle.id, copyId, "The current line knows its tag style");
  onLine4 = reducer(onLine4, { type: "setCurrentStyleId", id: tagStyle.id });
  assert.strictEqual(onLine4.currentStyle.id, copyId, "The Shout style becomes current");
  assert(/if \(line && line\.style && line\.style\.id !== state\.currentStyleId\) \{\s*dispatch\(\{ type: "setCurrentStyleId", id: line\.style\.id \}\);/.test(engine),
    "The engine makes the tag style of the current line current once the step is done");
  assert(/source = i === 0\s*\?\s*options\.style \|\| state\.currentStyle/.test(read("app_src/smartPasteClient.js")),
    "A paste uses the current style for the current line (why the line is picked again)");
  assert.strictEqual(shoutLine.style && shoutLine.style.id, copyId, "The prefix picks the Shout style");
  assert(!shoutLine.text.startsWith(prefix), "The prefix is left out of the text");
  [0, 1, 2].forEach((i) => assert(!state.lines[indexes[i]].style, "Line " + (i + 1) + " has no prefix style"));

  // The tag style is the one line 4 picks: with a second style carrying the
  // tag (an earlier run), the first in the list, the one a paste uses
  assert.strictEqual(session.basicsShoutStyle(onLine4).id, copyId, "The style the tag picks is found");
  assert(session.hasBasicsShoutTag(state.styles.find((style) => style.id === copyId)));
  assert(!session.hasBasicsShoutTag(state.styles.find((style) => style.id === "dialogue")));
  let twice = reducer(onLine4, { type: "duplicateStyle" });
  const secondId = twice.currentStyleId;
  twice = reducer(twice, { type: "setCurrentStyleId", id: "dialogue" });
  const picked = twice.lines[indexes[3]].style;
  assert.strictEqual(session.basicsShoutStyle(twice).id, picked && picked.id, "The guide follows the tag style the script picks");
  assert.notStrictEqual(secondId, copyId);
  // Tags limited to the current folder: a tag style elsewhere does not count
  const inFar = { ...twice, styles: twice.styles.concat([{ id: "other", name: "Other", folder: "far", prefixes: [] }]), currentStyleId: "other" };
  assert.strictEqual(session.basicsShoutStyle(inFar), null, "Only the folder of the current style is read");
  assert(session.basicsShoutStyle({ ...inFar, currentFolderTagPriority: false }), "Unless tags are read from every folder");
}

{
  // Styles the user already has are recognized by their name, in any language
  const styles = [
    { id: "a", name: "Default" },
    { id: "b", name: "Shout copy" },
    { id: "c", name: "Shout" },
    { id: "d", name: "Shouts" },
    { id: "e", name: "Gros Bold / cri" },
    { id: "f", name: "Critique" },
    { id: "g", name: "Narrateur 8bit" },
    { id: "h", name: "Bağırış" },
    { id: "i", name: "Narración" },
    { id: "j", name: "Dẫn truyện" },
  ];
  assert.strictEqual(session.findNamedStyle(styles, "shout").id, "c", "A style named just so comes first");
  assert.strictEqual(session.findNamedStyle(styles, "shout", "b").id, "b", "The preferred style comes first when it is one");
  assert.strictEqual(session.findNamedStyle(styles, "shout", "a").id, "c", "A preferred style with another name is not taken");
  assert.strictEqual(session.findNamedStyle([styles[8]], "narration").id, "i", "Accents do not matter");
  assert.strictEqual(session.findNamedStyle(styles.slice(3), "shout").id, "d", "Plural names are recognized");
  assert.strictEqual(session.findNamedStyle([styles[4], styles[5]], "shout").id, "e", "A word of the name counts, not a part of a word");
  assert.strictEqual(session.findNamedStyle([styles[5]], "shout"), null);
  assert.strictEqual(session.findNamedStyle([styles[7]], "shout").id, "h", "Names in other languages are recognized");
  assert.strictEqual(session.findNamedStyle(styles.slice(0, 8), "narration").id, "g", "A word of the name: Narrateur");
  assert.strictEqual(session.findNamedStyle([styles[9]], "narration").id, "j", "Names of several words are recognized");
  assert.strictEqual(session.findNamedStyle([], "shout"), null);
}

{
  // Each language has its own practice lines and prefix; the page marker
  // stays "Page 1" since TypeR reads it in English only
  const localeDir = path.join(root, "locale");
  const files = ["messages.properties"].concat(fs.readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name + "/messages.properties"));
  const { parsePageMarker } = createLoader()("app_src/pageMarker.js");
  files.forEach((file) => {
    const values = {};
    fs.readFileSync(path.join(localeDir, file), "utf8").split(/\r?\n/).forEach((line) => {
      const match = line.match(/^(walkthrough\w+)=(.*)$/);
      if (match) values[match[1]] = match[2];
    });
    const translated = loadSession(values);
    const lines = translated.BASICS_LINES.map((line, i) => translated.practiceLineText(i + 1, COURSE));
    assert(session.BASICS_LINES.every((line) => values[line.key] && values[line.key].trim()), file + ": every practice line is translated");
    assert.strictEqual(new Set(lines).size, lines.length, file + ": practice lines must differ, they are found by their text");
    const prefix = translated.basicsShoutPrefix();
    assert(values.walkthroughShoutPrefix && /:$/.test(prefix) && !/\s/.test(prefix), file + ": the shout prefix is one word ending with a colon");
    assert(lines[3].startsWith(prefix + " "), file + ": line 4 starts with the prefix");
    assert(/\{prefix\}/.test(values.walkthroughShoutCoach1) && /\{prefix\}/.test(values.walkthroughShoutResult1), file + ": the tip names the prefix");
    assert.strictEqual(parsePageMarker(translated.buildPracticeScript(COURSE).split("\n")[0]), 1, file + ": the page marker is read");
  });
}

// --- the practice page -----------------------------------------------------------

{
  const page = fs.readFileSync(path.join(root, "app_src/assets/typer-basics-page.png"));
  assert.strictEqual(page.toString("ascii", 1, 4), "PNG");
  assert.deepStrictEqual([page.readUInt32BE(16), page.readUInt32BE(20)], [1200, 1500], "The basics page keeps its layout");
  assert(page.length < 300 * 1024, "The basics page stays light");
  assert(/app_src\/assets\/typer-basics-page\.png/.test(read("scripts/finalizeBuild.js")), "The CEP build ships the basics page");
  assert(/app_src\/assets\/typer-basics-page\.png/.test(read("scripts/buildUxp.js")), "The UXP build ships the basics page");
  assert(/"typer-basics-page\.png"/.test(read("uxp-src/host/services.js")), "UXP opens the basics page from the plugin");
  assert(/window\.typerUXP\.request\("practicePagePath", PRACTICE_PAGE\)/.test(read("app_src/whatsNewSession.js")),
    "UXP is told which page to open");
  assert.strictEqual(session.PRACTICE_PAGES.walkthrough, "typer-basics-page.png");

  // Bubbles 1 and 2 are regular, 4 is a shout, 3 is a dotted frame
  const geometry = createLoader()("app_src/oneClick/geometry.js");
  const bubblePlan = createLoader()("app_src/oneClick/bubblePlan.js");
  const svg = read("app_src/assets/typer-basics-page.svg");
  const attr = (tag, name) => parseFloat((tag.match(new RegExp(" " + name + "=\"([^\"]+)\"")) || [])[1]);
  const px = (value) => ({ _unit: "pixelsUnit", _value: value });
  const pathOf = (poly) => ({ pathContents: { pathComponents: [{ subpathListKey: [{ closedSubpath: true, points: poly.map((p) => ({ anchor: { horizontal: px(p[0]), vertical: px(p[1]) }, forward: { horizontal: px(p[0]), vertical: px(p[1]) }, backward: { horizontal: px(p[0]), vertical: px(p[1]) } })) }] }] } });
  const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
  const kindOf = (poly, click) => {
    const b = geometry.box(poly);
    return bubblePlan.buildPlan({ width: 1200, height: 1500, resolution: 72, documentId: 1, source: "wand", click, fill: white, rawPath: pathOf(poly),
      selectionBounds: { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) } }, {}).kind;
  };
  const ellipses = (svg.match(/<ellipse [^>]*>/g) || []).map((tag) => ({ cx: attr(tag, "cx"), cy: attr(tag, "cy"), rx: attr(tag, "rx") - 2.5, ry: attr(tag, "ry") - 2.5 }));
  assert.strictEqual(ellipses.length, 2, "Bubbles 1 and 2");
  ellipses.forEach((e) => {
    const outline = Array.from({ length: 240 }, (_, i) => [e.cx + e.rx * Math.cos((i / 240) * Math.PI * 2), e.cy + e.ry * Math.sin((i / 240) * Math.PI * 2)]);
    assert.strictEqual(kindOf(outline, { x: e.cx, y: e.cy }), "regular", "Bubble at " + e.cx + "," + e.cy + " is a regular bubble");
  });
  const star = (svg.match(/<polygon points="([^"]+)"/) || [])[1].trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
  const center = star.reduce((sum, p) => [sum[0] + p[0] / star.length, sum[1] + p[1] / star.length], [0, 0]);
  const shrunk = star.map((p) => {
    const d = Math.hypot(p[0] - center[0], p[1] - center[1]);
    return [center[0] + ((p[0] - center[0]) * (d - 2.5)) / d, center[1] + ((p[1] - center[1]) * (d - 2.5)) / d];
  });
  assert.strictEqual(kindOf(shrunk, { x: center[0], y: center[1] }), "shout", "Bubble 4 is spiky");
  assert(/stroke-dasharray/.test(svg), "Spot 3 is a dotted frame");
  for (let number = 1; number <= 4; number++) {
    assert(new RegExp('fill="#ffffff">' + number + "</text>").test(svg), "Spot " + number + " is numbered on the page");
  }
}

// --- chapters ----------------------------------------------------------------------

{
  const ids = (chapters.match(/^\s{8}id: "(\w+)"/gm) || []).map((line) => line.trim().slice(5, -1));
  assert(ids.length >= 13, "The chapters list their steps");
  assert.strictEqual(new Set(ids).size, ids.length, "Step ids are unique: progress is stored by id");
  const minutes = (chapters.match(/^\s{4}minutes: ([\d.]+),/gm) || []).map((line) => parseFloat(line.split(":")[1]));
  assert.strictEqual(minutes.length, 8, "Every chapter announces its duration");
  assert.strictEqual(minutes.reduce((sum, value) => sum + value, 0), 7, "The walkthrough takes about 7 minutes");

  // Linked files replace the practice page: the paste exercises come first,
  // no run starts with the files of an earlier one, and auto close never
  // saves the practice page
  const order = (id) => chapters.indexOf('id: "' + id + '"');
  ["paste", "shout", "retouch"].forEach((id) => assert(order(id) < order("pages"), "Pages come after chapter " + id));
  assert(/check: \(env\) => env\.onPracticeTab && \(env\.state\.images/.test(chapters), "Linking files on the practice tab passes the step");
  assert(/type: "clearPastedLines" \}\);[\s\S]{0,120}type: "setImages", images: \[\]/.test(engine), "A practice tab picked up again drops its files");

  // The guide never does the gesture: it only sets up the practice page and
  // script; the paste and align buttons are fallbacks for a hidden control
  const actions = (chapters.match(/^\s+actions: \[[^\]]*\]/gm) || []).map((line) => (line.match(/type: "(\w+)"/) || [])[1]);
  assert.deepStrictEqual(actions.sort(), ["loadScript", "openPage"]);
  assert(!/createTextLayerInSelection|showSaveDialogEx|walkthroughReturn/.test(walkthrough), "No gesture is done for the user");
  assert(!/walkthroughReturn/.test(read("app_src/components/modal/editStyle.jsx")), "The style editor no longer sends the user back by itself");

  // Every ringed control exists in the panel, under the same name
  const sources = [
    "app_src/components/footer/footer.jsx",
    "app_src/components/previewBlock/previewBlock.jsx",
    "app_src/components/stylesBlock/stylesBlock.jsx",
    "app_src/components/modal/editStyle.jsx",
    "app_src/components/modal/settings.jsx",
    "app_src/components/modal/export.jsx",
  ].map(read).join("\n");
  const names = (walkthrough.match(/tour\("([\w-]+)"\)/g) || []).map((call) => call.slice(6, -2));
  assert(names.length >= 8, "The steps ring the panel controls");
  names.forEach((name) => assert(sources.includes(`data-tour="${name}"`), "Control " + name + " carries data-tour"));
  assert(sources.includes('data-tour="apply-style"') && /\[data-tour="apply-style"\]/.test(walkthrough), "The apply button of a style row is found");
  (walkthrough.match(/unlessActive\("(\w+)"\)/g) || []).forEach((call) => {
    const id = call.match(/"(\w+)"/)[1];
    assert(new RegExp(`id: "${id}"`).test(read("app_src/components/modal/settings.jsx")), "Settings tab " + id + " exists");
  });
  (chapters.match(/coachIn: "(\w+)"/g) || []).forEach((entry) => {
    assert(/^(settings|editStyle|export)$/.test(entry.slice(10, -1)), "Tips go to a window the panel opens");
  });

  // Steps that check a style made during the step take their baseline
  const stepOf = (id) => chapters.slice(chapters.indexOf('id: "' + id + '"'), chapters.indexOf('id: "' + id + '"') + 1600).split("result")[0];
  assert(/known: true/.test(stepOf("createStyle")) && /env\.newStyles\("createStyle"\)/.test(stepOf("createStyle")),
    "The style step passes on a style made during it");
  assert(/known: true/.test(stepOf("shoutStyle")) && /reselectLine: true/.test(stepOf("shoutStyle")),
    "The copy step picks the current line again, so its tag style becomes current");
  assert(/check: pastedWithTag,/.test(stepOf("shoutPaste")) && /miss: /.test(stepOf("shoutPaste")),
    "Line 4 pasted with a style its tag does not pick does not pass, and says how to do it again");
  assert(/line: 4,/.test(stepOf("shoutPaste")), "Line 4 checks a tag style was used");
  assert(/env\.shoutStyle = basicsShoutStyle\(env\.state\);/.test(walkthrough),
    "The Shout style is the one the tag picks, made in the walkthrough or before it");
  assert(/check: \(env\) => !!env\.shoutStyle,/.test(stepOf("shoutStyle")), "A tag style already there passes the step");
  assert(/\(!!env\.currentStyle && session\.stylePicked === true\)/.test(stepOf("createStyle")),
    "With styles already there, picking any of them passes the style step");
  assert(!/“(Dialogue|Shout|Narration)”/.test(read("locale/messages.properties").split("\n")
    .filter((line) => /^(walkthroughStyleCoach1|walkthroughShoutCoach1|whatsNewBubblesCoach3|whatsNewBubblesCoach6)=/.test(line)).join("\n")),
    "The tours do not impose a style name");
  [["align", "align"], ["applyStyle", "applyStyle"], ["export", "export"]].forEach(([id, event]) => {
    assert(new RegExp('event: "' + event + '"').test(stepOf(id)), id + " waits for its gesture");
  });
}

// --- the engine ----------------------------------------------------------------------

{
  // Gestures without a trace in the panel are counted where they succeed
  const events = createLoader()("app_src/tourEvents.js");
  const heard = [];
  events.setTourEventListener((name) => heard.push(name));
  assert.strictEqual(events.tourEventCount("align"), 0);
  events.noteTourEvent("align");
  events.noteTourEvent("align");
  assert.strictEqual(events.tourEventCount("align"), 2);
  assert.deepStrictEqual(heard, ["align", "align"], "The open tour hears each gesture");
  events.setTourEventListener(null);

  const utils = read("app_src/utils.js");
  assert(/else noteTourEvent\("align"\);/.test(utils), "A successful align is counted");
  assert(/else if \(!text && style\) noteTourEvent\("applyStyle"\);/.test(utils), "A style applied to a layer is counted, not a paste");
  assert((read("app_src/components/modal/export.jsx").match(/noteTourEvent\("export"\);\s*close\(\);/g) || []).length === 2,
    "A written backup is counted, JSON or zip");

  assert(/if \(step\.event\) passed = env\.eventSince\(step\.id, step\.event\);/.test(engine), "An event step passes on a gesture made during it");
  assert(/session\.eventStart\[step\.id\] = tourEventCount\(step\.event\);/.test(engine), "Its baseline is taken when it begins");
  assert(/session\.known\[step\.id\] = \(state\.styles \|\| \[\]\)\.map\(\(style\) => style\.id\);/.test(engine), "A style step remembers the styles there");
  assert(/textOf\(step\.coach, env\)/.test(engine), "A tip can name the user's prefix");

  const modal = read("app_src/components/modal/modal.jsx");
  assert(/const floating = isTourModal\(modalType\);/.test(modal), "Both tours float and keep their place");
  assert(/whatsNewSession\.course === 'walkthrough'/.test(modal), "The tip in a window names its tour");
}

{
  // Each tour keeps its own progress, and opening one puts the other away
  const items = {};
  global.window = {
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(items, key) ? items[key] : null),
      setItem: (key, value) => { items[key] = String(value); },
      removeItem: (key) => { delete items[key]; },
    },
  };
  const run = session.whatsNewSession;
  run.active = false;
  session.startWhatsNewSession(8, "whatsNew");
  run.chapter = 3;
  session.saveWhatsNewProgress();
  session.startWhatsNewSession(7, COURSE);
  assert.strictEqual(run.course, COURSE, "The walkthrough takes over");
  assert.strictEqual(run.resumeOffer, null, "The What's new run is not offered in the walkthrough");
  assert.strictEqual(JSON.parse(items["typer.whatsNewProgress"]).chapter, 3, "The What's new run is kept");
  run.chapter = 4;
  run.known = { createStyle: ["a", "b"] };
  session.endWhatsNewSession();
  assert.strictEqual(JSON.parse(items["typer.walkthroughProgress"]).chapter, 4, "The walkthrough keeps its own progress");
  session.startWhatsNewSession(7, COURSE);
  assert(run.resumeOffer && run.resumeOffer.chapter === 4, "Reopening the walkthrough offers to resume it");
  session.resumeWhatsNewSession(true);
  assert.deepStrictEqual(run.known, { createStyle: ["a", "b"] }, "The styles known by a step come back on resume");
  session.endWhatsNewSession();
  session.startWhatsNewSession(8, "whatsNew");
  assert(run.resumeOffer && run.resumeOffer.chapter === 3, "What's new resumes where it stopped");
  run.active = false;
  delete global.window;
}

console.log("Basics walkthrough tests passed");
