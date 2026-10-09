import React from "react";
import {
  FiCheck,
  FiChevronLeft,
  FiChevronRight,
  FiDownload,
  FiMousePointer,
  FiRotateCw,
  FiSkipForward,
  FiType,
  FiX,
} from "react-icons/fi";

import config from "../../config";
import { useContext } from "../../context";
import { alignTextLayerToSelection, createTextLayerInSelection, getDefaultStroke, getDefaultStyle, locale } from "../../utils";

const SAMPLE_SCRIPT = "Page 1\nREG: This bubble is ready.\nSFX: BOOM!\n## translator note";
const hasSampleScript = (value) => /Page\s*1/i.test(value) && /REG:/i.test(value) && /SFX:/i.test(value);

const getSteps = () => [
  {
    id: "script",
    title: locale.walkthroughStepPasteTitle || "Paste your script",
    text:
      locale.walkthroughStepPasteText ||
      "Paste the translated script in the text block. TypeR splits it into lines, ignores empty lines, and keeps the active line highlighted.",
  },
  {
    id: "styles",
    title: locale.walkthroughStepStylesTitle || "Create and choose styles",
    text:
      locale.walkthroughStepStylesText ||
      "Create styles from an existing Photoshop text layer or set the values manually. Click a style to make it active.",
  },
  {
    id: "selection",
    title: locale.walkthroughStepSelectionTitle || "Select the bubble in Photoshop",
    text:
      locale.walkthroughStepSelectionText ||
      "Draw a selection around the bubble with any selection tool. TypeR uses the selection bounds to place and center the text.",
  },
  {
    id: "flow",
    title: locale.walkthroughStepFlowTitle || "Typeset quickly",
    text:
      locale.walkthroughStepFlowText ||
      "Use the preview actions or shortcuts to paste, apply, align, and move through the script without leaving the panel.",
  },
  {
    id: "settings",
    title: locale.walkthroughStepExportTitle || "Export a JSON backup",
    text:
      locale.walkthroughStepExportText ||
      "Save a JSON file so styles and settings can be restored or shared later.",
  },
];

const WalkthroughModal = React.memo(function WalkthroughModal() {
  const context = useContext((state) => ({
    modalData: state.modalData,
    text: state.text,
    styles: state.styles,
    currentStyle: state.currentStyle,
    pastePointText: state.pastePointText,
    internalPadding: state.internalPadding,
    direction: state.direction,
    resizeTextBoxOnCenter: state.resizeTextBoxOnCenter,
    folders: state.folders,
    ignoreLinePrefixes: state.ignoreLinePrefixes,
    ignoreTags: state.ignoreTags,
    defaultStyleId: state.defaultStyleId,
    language: state.language,
    autoClosePSD: state.autoClosePSD,
    autoScrollStyle: state.autoScrollStyle,
    currentFolderTagPriority: state.currentFolderTagPriority,
  }));
  const modalData = context.state.modalData || {};
  const [stepIndex, setStepIndex] = React.useState(modalData.initialStep || 0);
  const [createdStyleId, setCreatedStyleId] = React.useState(modalData.createdStyleId || null);
  const [photoshopLayerDone, setPhotoshopLayerDone] = React.useState(!!modalData.photoshopLayerDone);
  const [alignDone, setAlignDone] = React.useState(!!modalData.alignDone);
  const [exportDone, setExportDone] = React.useState(!!modalData.exportDone);
  const steps = React.useMemo(getSteps, []);
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const sampleLoaded = hasSampleScript(context.state.text || "");

  const completed = {
    script: sampleLoaded,
    styles: !!createdStyleId && context.state.styles.some((style) => style.id === createdStyleId),
    selection: photoshopLayerDone,
    flow: alignDone,
    settings: exportDone,
  };
  const canContinue = completed[step.id];

  const close = React.useCallback(() => {
    context.dispatch({ type: "completeWalkthrough" });
  }, [context.dispatch]);

  const previous = () => setStepIndex((index) => Math.max(0, index - 1));
  const skip = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  const next = () => {
    if (!canContinue) return;
    if (isLast) close();
    else setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  };

  const goToStep = (index) => {
    if (index <= stepIndex || completed[steps[index - 1]?.id]) {
      setStepIndex(index);
    }
  };

  const renderDone = (done) => (
    <span className={`walkthrough-status${done ? " m-done" : ""}`}>
      {done ? locale.walkthroughDoneStatus || "Done" : locale.walkthroughTodoStatus || "To do"}
    </span>
  );

  const loadSampleScript = () => {
    context.dispatch({
      type: "addTab",
      data: {
        text: SAMPLE_SCRIPT,
        currentLineIndex: 1,
      },
    });
  };

  const currentWalkthroughStyle = React.useMemo(() => {
    if (!createdStyleId) return null;
    return context.state.styles.find((style) => style.id === createdStyleId) || null;
  }, [context.state.styles, createdStyleId]);

  const openStyleEditor = () => {
    context.dispatch({
      type: "setModal",
      modal: "editStyle",
      data: {
        create: true,
        name: locale.walkthroughDefaultStyleName || "Regular",
        prefixes: ["REG:"],
        prefixColor: "#54be78",
        walkthroughReturn: true,
        walkthroughState: {
          initialStep: 1,
          createdStyleId,
          photoshopLayerDone,
          alignDone,
          exportDone,
        },
      },
    });
  };

  const createPhotoshopTextLayer = () => {
    const style = currentWalkthroughStyle || context.state.currentStyle || {
      textProps: getDefaultStyle(),
      stroke: getDefaultStroke(),
    };
    createTextLayerInSelection(
      "This bubble is ready.",
      style,
      context.state.pastePointText,
      context.state.internalPadding || 0,
      context.state.direction,
      (ok) => {
        if (ok) {
          setPhotoshopLayerDone(true);
          context.dispatch({ type: "setCurrentLineIndex", index: 2 });
        }
      }
    );
  };

  const alignPhotoshopTextLayer = () => {
    alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, context.state.internalPadding || 0, (ok) => {
      if (ok) setAlignDone(true);
    });
  };

  const exportJson = async () => {
    const pathSelect = await window.cep.fs.showSaveDialogEx(false, false, ["json"], `${config.exportFileName}.json`);
    if (!pathSelect?.data) return;
    const data = {
      folders: context.state.folders,
      styles: context.state.styles,
      version: config.appVersion,
      exported: new Date(),
      ignoreLinePrefixes: context.state.ignoreLinePrefixes,
      ignoreTags: context.state.ignoreTags,
      defaultStyleId: context.state.defaultStyleId,
      language: context.state.language,
      autoClosePSD: context.state.autoClosePSD,
      autoScrollStyle: context.state.autoScrollStyle,
      currentFolderTagPriority: context.state.currentFolderTagPriority,
    };
    const result = await window.cep.fs.writeFile(pathSelect.data, JSON.stringify(data));
    if (!result || !result.err) setExportDone(true);
  };

  const renderPractice = () => {
    if (step.id === "script") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiType size={17} />
            <span>{locale.walkthroughTaskPaste || "Load the sample script into the real TypeR text block."}</span>
            {renderDone(completed.script)}
          </div>
          <pre className="walkthrough-script-preview">{SAMPLE_SCRIPT}</pre>
          <button type="button" className={completed.script ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={loadSampleScript}>
            {completed.script ? locale.walkthroughSampleLoaded || "Sample loaded" : locale.walkthroughUseSample || "Load sample into TypeR"}
          </button>
          {completed.script && (
            <div className="walkthrough-result">
              {locale.walkthroughPasteResult || "The panel now has a page marker, style tags, and an ignored note to practice with."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "styles") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiMousePointer size={17} />
            <span>{locale.walkthroughTaskStyle || "Create a real style. It will be added to your style list and activated."}</span>
            {renderDone(completed.styles)}
          </div>
          <button type="button" className={completed.styles ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={openStyleEditor}>
            {completed.styles ? locale.walkthroughStyleCreated || "Style created" : locale.walkthroughCreateStyle || "Create style"}
          </button>
          {completed.styles && (
            <div className="walkthrough-result">
              {locale.walkthroughStyleResult || "Your new style is now active and can be reused from the style list."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "selection") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiMousePointer size={17} />
            <span>{locale.walkthroughTaskSelection || "In Photoshop, draw a selection around a bubble, then click the button below to create a real text layer."}</span>
            {renderDone(completed.selection)}
          </div>
          <button type="button" className="topcoat-button--large--cta" onClick={createPhotoshopTextLayer}>
            {completed.selection ? locale.walkthroughPhotoshopLayerCreated || "Text layer created" : locale.walkthroughCreateInPhotoshop || "Paste text layer"}
          </button>
          {completed.selection && (
            <div className="walkthrough-result">
              {locale.walkthroughSelectionResult || "TypeR created a real text layer in the current Photoshop selection."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "flow") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiRotateCw size={17} />
            <span>{locale.walkthroughTaskFlow || "Move or redraw the Photoshop selection, then align the active text layer for real."}</span>
            {renderDone(completed.flow)}
          </div>
          <div className="walkthrough-flow">
            <button type="button" className={completed.flow ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={alignPhotoshopTextLayer}>
              {completed.flow ? locale.walkthroughAligned || "Aligned" : locale.alignLayer || "Align"}
            </button>
          </div>
          {completed.flow && (
            <div className="walkthrough-result">
              {locale.walkthroughFlowResult || "That is the real loop: select a bubble, create a layer, then align it when needed."}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="walkthrough-practice">
        <div className="walkthrough-task">
          <FiDownload size={17} />
          <span>{locale.walkthroughTaskExport || "Export a JSON backup with your current styles and settings."}</span>
          {renderDone(completed.settings)}
        </div>
        <button type="button" className={completed.settings ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={exportJson}>
          <FiDownload size={16} /> {completed.settings ? locale.walkthroughJsonExported || "JSON exported" : locale.walkthroughExportJson || "Export JSON"}
        </button>
        <div className="walkthrough-result">
          {locale.walkthroughSettingsConfirm || "You can reopen this guide from Settings > General."}
        </div>
      </div>
    );
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.walkthroughTitle || "First-time walkthrough"}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner walkthrough">
          <div className="walkthrough-progress" aria-label={locale.walkthroughProgress || "Walkthrough progress"}>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`walkthrough-dot${index === stepIndex ? " m-active" : ""}${completed[item.id] ? " m-done" : ""}`}
                title={`${index + 1}. ${item.title}`}
                onClick={() => goToStep(index)}
                disabled={index > stepIndex && !completed[steps[index - 1]?.id]}
              />
            ))}
          </div>
          <div className="walkthrough-step-count">
            {(locale.walkthroughStepCount || "Step {current} of {total}")
              .replace("{current}", String(stepIndex + 1))
              .replace("{total}", String(steps.length))}
          </div>
          <h2>{step.title}</h2>
          <p>{step.text}</p>
          {renderPractice()}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast walkthrough-footer">
        <button type="button" className="topcoat-button--large" onClick={skip} disabled={isLast}>
          <FiSkipForward size={16} /> {locale.walkthroughSkip || "Skip"}
        </button>
        <div className="walkthrough-footer-nav">
          <button type="button" className="topcoat-button--large" onClick={previous} disabled={isFirst}>
            <FiChevronLeft size={16} /> {locale.walkthroughBack || "Back"}
          </button>
          <button type="button" className="topcoat-button--large--cta" onClick={next} disabled={!canContinue}>
            {isLast ? <FiCheck size={16} /> : <FiChevronRight size={16} />}
            {isLast ? locale.walkthroughDone || "Done" : locale.walkthroughNext || "Next"}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
});

export default WalkthroughModal;
