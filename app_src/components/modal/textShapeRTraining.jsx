import "./textShapeRTraining.scss";
import React from "react";
import { FiChevronLeft, FiChevronRight, FiFolderPlus, FiStar, FiRotateCcw } from "react-icons/fi";
import { FaFileImport, FaFileExport } from "react-icons/fa";
import { locale, scanTextShapeRTraining } from "../../utils";
import { useContext } from "../../context";
import { recordTextShapeRFeedback, setTextShapeRTuning } from "../../textShapeR";
import { makeTrainingPage, normalizeTrainingFiles, selectedTrainingEntries, trainTextShapeREntries } from "../../textShapeRTraining";

const PAGE_SIZE = 15;
const format = (text, values) => Object.keys(values).reduce((result, key) => result.replace(`{${key}}`, values[key]), text);

export default function TextShapeRTraining({ onImportLearning, onExportLearning } = {}) {
  const context = useContext((state) => ({ textShapeRTuning: state.textShapeRTuning }));
  const [pages, setPages] = React.useState([]);
  const [activePath, setActivePath] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [stage, setStage] = React.useState("review");
  const [progress, setProgress] = React.useState({ current: 0, total: 0, name: "" });
  const [message, setMessage] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState(false);
  const mounted = React.useRef(true);
  const cancelled = React.useRef(false);
  const busyRef = React.useRef(false);
  const fileInput = React.useRef(null);
  const busy = stage === "scanning" || stage === "training" || stage === "cancelling";
  React.useEffect(() => () => { mounted.current = false; cancelled.current = true; }, []);

  const samples = (context.state.textShapeRTuning && context.state.textShapeRTuning.samples) || 0;
  const selected = selectedTrainingEntries(pages);
  const activePage = pages.find((page) => page.path === activePath) || pages[0];
  const entries = activePage ? activePage.entries : [];
  const editable = entries.filter((entry) => entry.usable);
  const allIncluded = editable.length > 0 && editable.every((entry) => entry.included);

  const scanFiles = async (files) => {
    if (busyRef.current || !files.length) return;
    busyRef.current = true;
    cancelled.current = false;
    setMessage("");
    setResetConfirm(false);
    setStage("scanning");
    setOffset(0);
    let firstPath = activePath;
    try {
      for (let index = 0; index < files.length; index++) {
        if (cancelled.current) break;
        const file = files[index];
        setProgress({ current: index + 1, total: files.length, name: file.name });
        const data = await new Promise((resolve) => scanTextShapeRTraining(file.path, resolve));
        if (!mounted.current) return;
        if (!firstPath) { firstPath = file.path; setActivePath(firstPath); }
        // Replace a retried file, retaining all other review choices.
        setPages((current) => current.filter((page) => page.path !== file.path).concat(makeTrainingPage(file, data)));
      }
    } catch (error) {
      if (mounted.current) setMessage(locale.textShapeRTrainError);
    } finally {
      busyRef.current = false;
      if (mounted.current) setStage("review");
    }
  };

  const onFilesPicked = (event) => {
    const files = Array.from(event.target.files || []);
    const paths = files.map((file) => file.path).filter(Boolean);
    event.target.value = "";
    if (files.length && paths.length !== files.length) {
      setMessage(locale.textShapeRTrainFileError);
      return;
    }
    scanFiles(normalizeTrainingFiles(paths));
  };

  const pickFiles = () => {
    if (busyRef.current) return;
    try {
      if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
        const result = window.cep.fs.showOpenDialogEx(true, false, locale.textShapeRTrainPick, "", ["psd"]);
        if (result.err) { setMessage(locale.textShapeRTrainFileError); return; }
        scanFiles(normalizeTrainingFiles(result.data || []));
      } else {
        fileInput.current.click();
      }
    } catch (error) {
      setMessage(locale.textShapeRTrainFileError);
    }
  };

  const toggleEntry = (key) => {
    setMessage("");
    setPages((current) => current.map((page) => ({ ...page, entries: page.entries.map((entry) => (
      entry.key === key && entry.usable ? { ...entry, included: !entry.included } : entry
    )) })));
  };
  const selectEntries = (included, pageOnly = false) => {
    setMessage("");
    setPages((current) => current.map((page) => pageOnly && page.path !== activePage.path ? page : ({
      ...page, entries: page.entries.map((entry) => ({ ...entry, included: entry.usable && included })),
    })));
  };

  const train = async () => {
    if (busyRef.current || !selected.length) return;
    busyRef.current = true;
    cancelled.current = false;
    setMessage("");
    setResetConfirm(false);
    setStage("training");
    setProgress({ current: 0, total: selected.length, name: "" });
    const initialTuning = context.state.textShapeRTuning;
    try {
      const result = await trainTextShapeREntries(selected, initialTuning, {
        recordFeedback: recordTextShapeRFeedback,
        isCancelled: () => cancelled.current || !mounted.current,
        onProgress: (current, total) => { if (mounted.current) setProgress({ current, total, name: "" }); },
      });
      if (!mounted.current) return;
      if (result.cancelled) { setMessage(locale.textShapeRTrainCancelled); return; }
      if (!result.learned) { setMessage(locale.textShapeRLearnAllEmpty); return; }
      setTextShapeRTuning(result.tuning);
      context.dispatch({ type: "setTextShapeRTuning", value: result.tuning, learned: true });
      setMessage(format(locale.textShapeRTrainDone, { count: result.learned, skipped: result.skipped }));
      // Prevent an accidental second validation of the same selection.
      setPages((current) => current.map((page) => ({ ...page, entries: page.entries.map((entry) => ({ ...entry, included: false })) })));
    } catch (error) {
      if (mounted.current) setMessage(locale.textShapeRTrainError);
    } finally {
      busyRef.current = false;
      if (mounted.current) setStage("review");
    }
  };

  const cancel = () => {
    cancelled.current = true;
    setStage("cancelling");
  };
  const reset = () => {
    setTextShapeRTuning(null);
    context.dispatch({ type: "setTextShapeRTuning", value: null });
    setResetConfirm(false);
    setMessage(locale.textShapeRMarkBestReset);
  };

  return (
    <div className="settings-group textshaper-training">
      <div className="settings-group-title">{locale.settingsGroupShapeTuning}</div>
      <div className="textshaper-training-status" role="status">
        <FiStar size={16} />
        <span>{samples ? format(locale.textShapeRTrainSamples, { count: samples }) : locale.textShapeRTrainNoSamples}</span>
      </div>
      <div className="textshaper-training-section">
        <div className="textshaper-training-heading">{locale.textShapeRTrainTitle}</div>
        <p className="field-descr">{locale.textShapeRTrainIntro}</p>
        <input ref={fileInput} type="file" accept=".psd" multiple onChange={onFilesPicked} style={{ display: "none" }} />
        <div className="textshaper-training-actions">
          <button type="button" className="topcoat-button--large--cta" disabled={busy} onClick={pickFiles}>
            <FiFolderPlus size={14} /> {locale.textShapeRTrainPick}
          </button>
          {busy && <button type="button" className="topcoat-button--large" onClick={cancel} disabled={stage === "cancelling"}>{locale.cancel}</button>}
        </div>
        {busy && <div role="status" className="textshaper-training-progress">
          {stage === "cancelling" ? locale.textShapeRTrainCancelling : format(
            stage === "scanning" ? locale.textShapeRTrainScanning : locale.textShapeRTrainProgress,
            { current: progress.current, total: progress.total }
          )}
          {progress.name && <span title={progress.name}>{progress.name}</span>}
          <progress value={stage === "scanning" ? progress.current - 1 : progress.current} max={progress.total || 1} />
        </div>}
        {!!pages.length && <React.Fragment>
          <div className="textshaper-training-summary">{format(locale.textShapeRTrainSelection, { count: selected.length, total: pages.reduce((sum, page) => sum + page.entries.length, 0) })}</div>
          <div className="textshaper-training-actions">
            <button type="button" disabled={busy} onClick={() => selectEntries(true)} className="topcoat-button--large">{locale.textShapeRTrainSelectAll}</button>
            <button type="button" disabled={busy} onClick={() => selectEntries(false)} className="topcoat-button--large">{locale.textShapeRTrainSelectNone}</button>
          </div>
          <select className="textshaper-training-files" value={activePage.path} disabled={busy} aria-label={locale.textShapeRTrainFiles} title={activePage.path} onChange={(event) => { setActivePath(event.target.value); setOffset(0); }}>
            {pages.map((page) => <option key={page.path} value={page.path}>{page.name} ({page.entries.filter((entry) => entry.included).length}/{page.entries.length}){page.error ? " ⚠" : ""}</option>)}
          </select>
          {activePage.error ? <p role="alert">{locale.textShapeRTrainFileError}</p> : !entries.length ? <p>{locale.textShapeRLearnAllEmpty}</p> : <React.Fragment>
            <label className="textshaper-training-page-toggle">
              <input type="checkbox" checked={allIncluded} disabled={busy || !editable.length} onChange={() => selectEntries(!allIncluded, true)} />
              {locale.textShapeRTrainSelectPage}
            </label>
            <div className="textshaper-training-layers">
              {entries.slice(offset, offset + PAGE_SIZE).map((entry) => <label key={entry.key} className={`textshaper-training-layer${entry.included ? "" : " is-excluded"}`}>
                <input type="checkbox" checked={entry.included} disabled={busy || !entry.usable} onChange={() => toggleEntry(entry.key)} />
                <span className="textshaper-training-layer-content">
                  <span className="textshaper-training-layer-name" title={entry.layerPath}>{entry.layerPath || entry.name}</span>
                  {entry.visible === false && <small>{locale.textShapeRTrainHidden}</small>}
                  {entry.error ? <small>{locale.textShapeRTrainReadError}</small> : <span className="textshaper-training-text" dir="auto">{entry.text || locale.textShapeREmpty}</span>}
                </span>
              </label>)}
            </div>
            <div className="textshaper-training-pagination">
              <button type="button" className="topcoat-button--large" title={locale.textShapeRPreviousSuggestions} disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><FiChevronLeft /></button>
              <span>{Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(entries.length / PAGE_SIZE)}</span>
              <button type="button" className="topcoat-button--large" title={locale.textShapeRNextSuggestions} disabled={offset + PAGE_SIZE >= entries.length || busy} onClick={() => setOffset(offset + PAGE_SIZE)}><FiChevronRight /></button>
            </div>
          </React.Fragment>}
          <button type="button" className="topcoat-button--large--cta" disabled={busy || !selected.length} onClick={train}><FiStar size={14} /> {locale.textShapeRTrainValidate}</button>
        </React.Fragment>}
        {message && <p role="status" className="textshaper-training-message">{message}</p>}
      </div>
      <div className="textshaper-training-section">
        <div className="textshaper-training-heading">{locale.settingsGroupImportExport}</div>
        <div className="textshaper-training-actions textshaper-training-sharing">
          <button type="button" className="topcoat-button--large" disabled={busy} onClick={onImportLearning}>
            <FaFileImport size={14} /> {locale.settingsShapeTuningImport}
          </button>
          <button type="button" className="topcoat-button--large" disabled={busy || !samples} onClick={onExportLearning}>
            <FaFileExport size={14} /> {locale.settingsShapeTuningExport}
          </button>
        </div>
        <p className="field-descr">{locale.settingsShapeTuningHint}</p>
      </div>
      <div className="textshaper-training-section">
        {resetConfirm ? <div className="textshaper-training-reset">
          <p>{locale.confirmResetTextShapeR}</p>
          <button type="button" className="topcoat-button--large settings-danger-btn" disabled={busy} onClick={reset}>{locale.textShapeRTrainReset}</button>
          <button type="button" className="topcoat-button--large" onClick={() => setResetConfirm(false)}>{locale.cancel}</button>
        </div> : <button type="button" className="topcoat-button--large" disabled={busy || !samples} onClick={() => setResetConfirm(true)}><FiRotateCcw size={14} /> {locale.textShapeRTrainReset}</button>}
      </div>
      <p className="field-descr textshaper-training-info">{locale.textShapeRLearnInfo}</p>
    </div>
  );
}
