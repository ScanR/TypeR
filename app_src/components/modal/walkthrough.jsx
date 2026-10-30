// The basics walkthrough: the guided tour (tour.jsx) of the TypeR workflow,
// shown to new users and available from Help and Settings > General. It
// opens its own practice page (four numbered spots) and script, with a page
// marker and a translator note the user sees TypeR skip.

import React from "react";
import { FiAlignLeft, FiDownload, FiFileText, FiLayers, FiSliders } from "react-icons/fi";
import { MdCenterFocusWeak, MdOutlineFormatColorText } from "react-icons/md";

import { locale, scrollToLine } from "../../utils";
import {
  basicsShoutPrefix, basicsShoutStyle, currentFolderStyles, findNamedStyle, hasBasicsShoutTag, whatsNewSession as session,
} from "../../whatsNewSession";
import TourModal, { Bars, byId, fill, styleItem, stylePencil, tour, unlessActive } from "./tour";

/* ============================ illustrations ============================ */

// A script: the current line, a note skipped on the way to the next line
const ScriptArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <rect className="whats-new-card" x="42" y="6" width="136" height="84" rx="6" />
    <text className="whats-new-tag" x="72" y="20">Page 1</text>
    <rect className="whats-new-bar" x="56" y="28" width="96" height="4.5" rx="2.25" />
    <rect className="whats-new-line-current" x="48" y="38" width="124" height="12" rx="3" />
    <circle className="whats-new-target" cx="56" cy="44" r="3.5" />
    <rect className="whats-new-bar" x="64" y="42" width="84" height="4.5" rx="2.25" />
    <text className="whats-new-tag m-skipped" x="62" y="64">##</text>
    <rect className="whats-new-bar m-skipped" x="74" y="59" width="70" height="4.5" rx="2.25" />
    <rect className="whats-new-bar" x="56" y="74" width="88" height="4.5" rx="2.25" />
    <path className="whats-new-arrow m-accent" d="M168 46c18 8 18 22 0 30m6-4l-6 4 7 2" />
  </svg>
);

// A style: its font, size and color, saved under a name
const StyleArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <rect className="whats-new-card m-accent" x="52" y="10" width="116" height="76" rx="6" />
    <text className="whats-new-glyph" x="84" y="60">Aa</text>
    <rect className="whats-new-bar" x="118" y="30" width="38" height="4.5" rx="2.25" />
    <rect className="whats-new-bar" x="118" y="44" width="26" height="4.5" rx="2.25" />
    <circle className="whats-new-swatch" cx="122" cy="62" r="5" />
    <rect className="whats-new-bar" x="132" y="60" width="22" height="4.5" rx="2.25" />
  </svg>
);

// The cursor clicks the bubble, the selection appears, the line is pasted
const PasteArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <ellipse className="whats-new-bubble" cx="110" cy="48" rx="54" ry="36" />
    <ellipse className="whats-new-ants" cx="110" cy="48" rx="54" ry="36" />
    <circle className="whats-new-ripple" cx="110" cy="48" r="10" />
    <Bars cx={110} className="whats-new-bars m-after-click" rows={[[33, 44], [43, 74], [53, 64]]} />
    <g className="whats-new-cursor">
      <path d="M110 48l0 17 4.5-4.5 3.5 8 3-1.4-3.5-7.8h6.5z" />
    </g>
  </svg>
);

// A prefix in the script picks the style of the line
const ShoutArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <rect className="whats-new-card" x="8" y="34" width="86" height="28" rx="5" />
    <text className="whats-new-tag m-accent" x="34" y="52">SHOUT:</text>
    <rect className="whats-new-bar" x="58" y="46" width="28" height="4.5" rx="2.25" />
    <path className="whats-new-arrow" d="M102 48h14m-5-5l5 5-5 5" />
    <path
      className="whats-new-bubble"
      d="M168 12l6 14 14-8-4 15 15 2-12 9 12 10-15 1 4 15-14-8-6 14-6-14-14 8 4-15-15-1 12-10-12-9 15-2-4-15 14 8z"
    />
    <Bars cx={168} className="whats-new-bars m-bold m-animated" rows={[[39, 30], [48, 22]]} />
  </svg>
);

// Align puts a text moved off center back in the middle of its bubble
const AlignArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <ellipse className="whats-new-bubble" cx="55" cy="50" rx="44" ry="32" />
    <Bars cx={74} className="whats-new-bars m-old" rows={[[50, 34], [59, 44], [68, 26]]} />
    <path className="whats-new-arrow" d="M104 50h12m-5-5l5 5-5 5" />
    <ellipse className="whats-new-bubble" cx="165" cy="50" rx="44" ry="32" />
    <rect className="whats-new-selection" x="121" y="18" width="88" height="64" />
    <Bars cx={165} className="whats-new-bars m-animated" rows={[[38, 34], [47, 44], [56, 26]]} />
  </svg>
);

// The styles and settings saved to a file
const BackupArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <path className="whats-new-card m-accent" d="M84 8h38l16 16v62a4 4 0 0 1-4 4H84a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z" />
    <path className="whats-new-card" d="M122 8v16h16" />
    <text className="whats-new-tag m-accent" x="109" y="50">JSON</text>
    <rect className="whats-new-bar" x="92" y="60" width="34" height="4.5" rx="2.25" />
    <rect className="whats-new-bar" x="92" y="70" width="24" height="4.5" rx="2.25" />
    <path className="whats-new-arrow m-accent whats-new-drop" d="M164 30v34m-8-8l8 8 8-8M150 74h28" />
  </svg>
);

const ART = {
  script: <ScriptArt />,
  style: <StyleArt />,
  paste: <PasteArt />,
  shout: <ShoutArt />,
  retouch: <AlignArt />,
  backup: <BackupArt />,
};

/* ============================== chapters ============================== */

// The ▶ button of a style row, which applies the style to the selected layer
const applyButton = (id) => (id ? { selector: `.style-item${byId(id)} [data-tour="apply-style"]` } : null);

// The target at the start of a script line, scrolled into view when needed
const lineTarget = (env, number) => {
  const index = env.lineIndex(number);
  return index >= 0
    ? { selector: `.text-line[data-line-index="${index}"] .text-line-select`, reveal: () => scrollToLine(index, 0) }
    : null;
};

// The copy of the dialogue style the user just duplicated: a style made in
// the step, active, without the prefix yet
const shoutCopyId = (env) => {
  const id = env.state.currentStyleId;
  return id && !env.shoutStyle && env.newStyles("shoutStyle").some((style) => style.id === id) ? id : null;
};

// A shout style the user already has, without the tag of line 4: the style
// marked for shout bubbles, or one named so, in the folder of the current
// style (the dialogue style the step began with aside). The shout step asks
// to tag it instead of making a copy.
const shoutCandidate = (env) => {
  if (env.shoutStyle || shoutCopyId(env)) return null;
  const baseId = (session.styleBefore && session.styleBefore.id) || env.state.currentStyleId;
  const others = currentFolderStyles(env.state).filter((style) => style.id !== baseId);
  return others.find((style) => style.bubbleType === "shout") || findNamedStyle(others, "shout");
};

// Line 4 was pasted with a style its tag picks
const pastedWithTag = (env) => {
  const id = env.usedStyleId(4);
  return !!id && hasBasicsShoutTag((env.state.styles || []).find((style) => style.id === id));
};

// Each step is checked from the panel state: it passes by itself when the
// user does it, in Photoshop or in the panel. The guide never does the
// gesture: `spot` rings the control to use, `fallback` is offered only when
// that control is hidden in the user's layout. env: see TourModal (tour.jsx).
const getChapters = () => [
  {
    id: "prep",
    Icon: FiFileText,
    minutes: 0.5,
    title: locale.walkthroughPrepTitle || "Get ready",
    intro:
      locale.walkthroughPrepIntro ||
      "The walkthrough is hands-on: TypeR opens a practice page with four numbered spots and a short practice script, one line per spot.",
    steps: [
      {
        id: "basicsOpenPage",
        text: locale.walkthroughPrepOpenText || "Open the practice page in Photoshop.",
        check: () => session.pageOpened === true,
        actions: [{ type: "openPage" }],
        result:
          locale.walkthroughPrepOpenResult ||
          "It opens as a normal document: 4 numbered spots, read from right to left like a manga. Close it without saving at the end.",
      },
      {
        id: "basicsLoadScript",
        text: locale.walkthroughPrepScriptText || "Load the practice script. It opens in a new tab: your own scripts stay untouched.",
        check: (env) => env.onPracticeTab,
        actions: [{ type: "loadScript" }],
        result:
          locale.walkthroughPrepScriptResult ||
          "This is where your translation goes: paste it in the text block, TypeR splits it into lines.",
      },
    ],
  },
  {
    id: "script",
    Icon: FiAlignLeft,
    minutes: 0.75,
    title: locale.walkthroughScriptTitle || "Read the script",
    intro:
      locale.walkthroughScriptIntro ||
      "TypeR always works on one line of the script, the current line: it is the text of the next paste.",
    steps: [
      {
        id: "pickLine",
        text:
          locale.walkthroughScriptStep1 ||
          "In the script, click the target at the start of line 2: it becomes the current line.",
        check: (env) => env.onPracticeTab && env.state.currentLineIndex === env.lineIndex(2),
        spot: (env) => [lineTarget(env, 2)],
        result: locale.walkthroughScriptResult1 || "The current line is highlighted: it is the text of the next paste.",
      },
      {
        id: "nextLine",
        text:
          locale.walkthroughScriptStep2 ||
          "Now go to the next line with the ↓ arrow under the preview, or with your shortcut.",
        check: (env) => !!session.done.pickLine && env.onPracticeTab && env.state.currentLineIndex === env.lineIndex(3),
        spot: () => [tour("next-line")],
        keys: ["next"],
        result:
          locale.walkthroughScriptResult2 ||
          "TypeR jumped over the line starting with ##: it is a note for you, never pasted. “Page 1” at the top is a page marker, skipped as well.",
      },
    ],
  },
  {
    id: "style",
    Icon: MdOutlineFormatColorText,
    minutes: 1,
    title: locale.walkthroughStyleTitle || "Your dialogue style",
    intro:
      locale.walkthroughStyleIntro ||
      "A style is everything a text layer needs: font, size, color, stroke, spacing. TypeR applies it to every text you paste.",
    steps: [
      {
        id: "createStyle",
        known: true,
        coachIn: "editStyle",
        // With styles already there, the user picks the one for dialogue,
        // whatever its name, or makes a new one
        text: (env) => ((env.state.styles || []).length
          ? locale.walkthroughStyleStep1Existing ||
            "Click the style you use for dialogue in the list, whatever its name. None fits? Click “Add style” under the list."
          : locale.walkthroughStyleStep1 || "Click “Add style” under the style list."),
        coach:
          locale.walkthroughStyleCoach1 ||
          "Give it the name you like, pick the font and size you use for dialogue, then click Save.",
        check: (env) => env.newStyles("createStyle").some((style) => style.id === env.state.currentStyleId) ||
          (!!env.currentStyle && session.stylePicked === true),
        spot: (env) => ((env.state.styles || []).length ? [{ selector: ".folders-list" }, tour("add-style")] : [tour("add-style")]),
        result: (env) => (env.newStyles("createStyle").some((style) => style.id === env.state.currentStyleId) || !env.currentStyle
          ? locale.walkthroughStyleResult1 ||
            "Your style is in the list and active. Click a style to make it active; its pencil edits it."
          : fill(
            locale.walkthroughStyleResult1Existing ||
              "“{name}” is your dialogue style for the walkthrough: every paste uses it. Click a style to make it active; its pencil edits it.",
            { name: env.currentStyle.name }
          )),
      },
    ],
  },
  {
    id: "paste",
    Icon: FiLayers,
    minutes: 1.5,
    title: locale.walkthroughPasteTitle || "Paste the text",
    intro:
      locale.walkthroughPasteIntro ||
      "The core loop: select a bubble in Photoshop, paste, and TypeR moves on to the next line.",
    steps: [
      {
        id: "bubble1",
        line: 1,
        text:
          locale.walkthroughPasteStep1 ||
          "Bubble 1: in Photoshop, take the Magic Wand (W) and click inside the big bubble. Then click Paste in the panel.",
        paste: true,
        result:
          locale.walkthroughPasteResult1 ||
          "A text layer with your style, centered in the bubble: the lines follow its round shape. TypeR moved on to line 2 by itself.",
      },
      {
        id: "bubble2",
        line: 2,
        text: locale.walkthroughPasteStep2 || "Bubble 2: same gesture, and this time paste with your shortcut.",
        paste: true,
        result:
          locale.walkthroughPasteResult2 ||
          "Selection, paste: that is the whole loop. With the shortcut, your hands never leave Photoshop.",
      },
      {
        id: "caption",
        line: 3,
        text:
          locale.walkthroughPasteStep3 ||
          "No bubble at spot 3: take the Rectangular Marquee (M), draw a rectangle in the dotted frame, then paste.",
        paste: true,
        result:
          locale.walkthroughPasteResult3 ||
          "A rectangle or a lasso places the text anywhere: captions, text on the art…",
      },
    ],
  },
  {
    id: "shout",
    Icon: FiSliders,
    minutes: 1.25,
    title: locale.walkthroughShoutTitle || "One style per kind of text",
    intro:
      locale.walkthroughShoutIntro ||
      "A tag at the start of a script line picks its style: the line is pasted with that style, without the tag.",
    steps: [
      {
        id: "shoutStyle",
        known: true,
        reselectLine: true,
        coachIn: "editStyle",
        text: (env) => (shoutCopyId(env)
          ? locale.walkthroughShoutStep1Edit || "Now click the pencil of the copy to edit it."
          : shoutCandidate(env)
            ? fill(
              locale.walkthroughShoutStep1Reuse ||
                "Line 4 starts with a tag. You already have a style for shouts, “{name}”: give it this tag instead of making a new one. Click its pencil.",
              { name: shoutCandidate(env).name }
            )
            : locale.walkthroughShoutStep1 ||
              "Line 4 starts with a tag. Make its style from your dialogue style: right-click it in the list, then “Duplicate style”."),
        coach: (env) => fill(
          shoutCandidate(env)
            ? locale.walkthroughShoutCoach1Reuse || "Write {prefix} in “Tags for automatic style choosing”, then click Save."
            : locale.walkthroughShoutCoach1 ||
              "Write {prefix} in “Tags for automatic style choosing”, pick a bolder font and another name if you like, then click Save.",
          { prefix: basicsShoutPrefix() }
        ),
        // Any style the tag picks: made now, or already there
        check: (env) => !!env.shoutStyle,
        spot: (env) => [tour("style-prefixes")].concat(shoutCopyId(env)
          ? [stylePencil(shoutCopyId(env))]
          : shoutCandidate(env)
            ? [stylePencil(shoutCandidate(env).id)]
            : [tour("duplicate-style"), styleItem((session.styleBefore && session.styleBefore.id) || env.state.currentStyleId)]),
        // No baseline: the tag was already there when the guide got to the step
        result: (env) => (!session.known.shoutStyle && env.shoutStyle
          ? fill(
            locale.walkthroughShoutResult1Existing ||
              "Your style “{name}” already has the {prefix} tag: every line starting with it gets that style, as soon as that line is the current line.",
            { name: env.shoutStyle.name, prefix: basicsShoutPrefix() }
          )
          : fill(
            locale.walkthroughShoutResult1 ||
              "Every line starting with {prefix} now gets the Shout style: TypeR makes it the current style as soon as that line is the current line.",
            { prefix: basicsShoutPrefix() }
          )),
      },
      {
        id: "shoutPaste",
        line: 4,
        text: locale.walkthroughShoutStep2 || "Bubble 4 is spiky: paste line 4 into it.",
        paste: true,
        // The step waits for a paste made with a style the tag picks
        check: pastedWithTag,
        miss: (env) => (env.isPasted(4) && !pastedWithTag(env)
          ? locale.walkthroughShoutResult2Missed ||
            "This text did not get the Shout style. Undo it in Photoshop (Ctrl+Z, Cmd+Z on Mac), check that the tag of the Shout style is written exactly as in the script and that it is in the same folder as your dialogue style, then paste line 4 again."
          : null),
        result:
          locale.walkthroughShoutResult2 ||
          "The tag picked the Shout style, and it was left out of the text. A tag always wins: the style smart paste picks for spiky bubbles only goes to lines without one.",
      },
    ],
  },
  {
    id: "retouch",
    Icon: MdCenterFocusWeak,
    minutes: 1,
    title: locale.walkthroughRetouchTitle || "Retouch a text",
    intro:
      locale.walkthroughRetouchIntro ||
      "A text already on the page can be centered again or take another style, without typing it again.",
    steps: [
      {
        id: "align",
        event: "align",
        text:
          locale.walkthroughRetouchStep1 ||
          "In Photoshop, move the text of bubble 1 off center with the Move tool (V). Then select bubble 1 again with the Magic Wand and click Align.",
        spot: () => [tour("align")],
        keys: ["center"],
        fallback: [{ type: "align" }],
        result:
          locale.walkthroughRetouchResult1 ||
          "The text is back in the middle of the selection. Handy after resizing a text.",
      },
      {
        id: "applyStyle",
        event: "applyStyle",
        text:
          locale.walkthroughRetouchStep2 ||
          "Select the text layer of bubble 2 in the Layers panel, then click the ➜ button of the Shout style in the list.",
        spot: (env) => [applyButton(env.shoutStyle && env.shoutStyle.id), tour("apply-style")],
        keys: ["applyStyle"],
        result:
          locale.walkthroughRetouchResult2 ||
          "The layer took the Shout style and kept its text. Ctrl+click on ➜ also keeps its current size.",
      },
    ],
  },
  {
    id: "backup",
    Icon: FiDownload,
    minutes: 0.5,
    title: locale.walkthroughBackupTitle || "Back up your styles",
    intro:
      locale.walkthroughBackupIntro ||
      "Your styles and settings fit in one file: keep a copy, move it to another computer or share it with your team.",
    steps: [
      {
        id: "export",
        event: "export",
        coachIn: "export",
        text:
          locale.walkthroughBackupStep1 ||
          "Open the settings with the gear at the bottom of the panel, then the Data tab and “Export styles or settings”.",
        coach: locale.walkthroughBackupCoach1 || "Pick what to save, click Save, then choose where to put the file.",
        spot: () => [tour("export-save"), tour("export-settings"), unlessActive("data"), tour("settings")],
        result:
          locale.walkthroughBackupResult1 ||
          "Keep this file safe: “Import styles or settings”, in the same tab, brings everything back.",
      },
    ],
  },
];

/* =============================== course =============================== */

const COURSE = {
  id: "walkthrough",
  getChapters,
  art: ART,
  hero: "TypeR",
  title: () => locale.walkthroughTitle || "TypeR walkthrough",
  practiceTabName: () => locale.walkthroughPracticeTab || "TypeR practice",
  completeAction: "completeWalkthrough",
  // The Shout style of the walkthrough: the style the tag of line 4 picks
  extendEnv: (env) => {
    env.shoutStyle = basicsShoutStyle(env.state);
  },
  intro: {
    title: () => locale.walkthroughIntroTitle || "Welcome to TypeR",
    text: () => locale.walkthroughIntroText ||
      "Learn TypeR by using it: the guide opens a practice page in Photoshop and a practice script, and each exercise checks itself as soon as you do it.",
    spot: () => locale.walkthroughIntroSpot ||
      "You do every gesture yourself: the guide highlights the button to use in the panel. Drag the guide by its header, or fold it away with ▴.",
  },
  end: {
    title: () => locale.walkthroughDoneTitle || "You know the basics",
    next: { modal: "whatsNew", label: () => locale.walkthroughOpenWhatsNew || "Go further: TypeR 3.0" },
    notes: () => [
      locale.walkthroughDoneHelp || "Help, the ? at the bottom of the panel, lists every feature and your shortcuts.",
      locale.walkthroughDoneText || "Reopen this guide at any time from Help or Settings > General.",
    ],
  },
};

const WalkthroughModal = React.memo(function WalkthroughModal() {
  return <TourModal course={COURSE} />;
});

export default WalkthroughModal;
