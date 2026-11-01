import React from "react";
import { locale } from "../../utils";

const labels = { CTRL: "Ctrl", ALT: "Alt", SHIFT: "Shift", WIN: "Win / Cmd", SPACE: "Space", ENTER: "Enter" };
const keys = (state) => /^a(?:[A-Z0-9]+a)*$/.test(state || "") ? state.split("a").filter(Boolean) : [];
const chord = (state) => keys(state).map((key) => labels[key] || key).join(" + ");

export default function KeyboardDebug() {
  const host = window.typerUXP;
  const [info, setInfo] = React.useState(null);
  const [state, setState] = React.useState("a");
  const [lastKeys, setLastKeys] = React.useState("a");
  const [error, setError] = React.useState("");
  const [waiting, setWaiting] = React.useState(false);

  React.useEffect(() => {
    if (!host) return undefined;
    let active = true;
    let pending = false;
    let sentAt = 0;
    const updateKeys = (value) => {
      if (!active) return;
      setState(value);
      if (keys(value).length) setLastKeys(value);
    };
    const unsubscribe = host.onKeys(updateKeys);
    const poll = () => {
      if (pending) {
        if (Date.now() - sentAt > 2000) { setWaiting(true); setState("a"); }
        return;
      }
      pending = true;
      sentAt = Date.now();
      host.request("keyboardDebug").then((value) => {
        if (!active) return;
        setInfo(value);
        updateKeys(value.state);
        if (keys(value.lastKeys).length) setLastKeys(value.lastKeys);
        setError("");
        setWaiting(false);
      }, (reason) => {
        if (active) { setError(reason.message || String(reason)); setState("a"); }
      }).then(() => { pending = false; });
    };
    poll();
    const timer = setInterval(poll, 200);
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, [host]);

  const stale = info && info.sampledAt && Date.now() - info.sampledAt > 2000;
  const status = !host ? locale.keyboardDebugUnavailable : waiting ? locale.keyboardDebugWaiting :
    error || (info && info.error) ? locale.keyboardDebugError : !info || info.loading ? locale.keyboardDebugConnecting :
    stale ? locale.keyboardDebugStale : info.running === false ? locale.keyboardDebugStopped :
    info.running === true ? locale.keyboardDebugRunning : locale.keyboardDebugUnknown;
  const pressed = keys(waiting || stale || error ? "a" : state);

  return (
    <div className="settings-section keyboard-debug">
      <div className="settings-group">
        <h3 className="settings-group-title">{locale.keyboardDebugTitle}</h3>
        <div className="field-descr">{locale.keyboardDebugHint}</div>
        <dl className="keyboard-debug-details">
          <dt>{locale.keyboardDebugReader}</dt><dd>{info ? (info.source === "uxpaddon" ? "UXP Addon" : "TypeR Helper") : "—"}</dd>
          <dt>{locale.keyboardDebugStatus}</dt><dd role="status">{status}</dd>
          <dt>{locale.keyboardDebugForeground}</dt><dd>{info && typeof info.foreground === "boolean" ? (info.foreground ? locale.keyboardDebugYes : locale.keyboardDebugNo) : "—"}</dd>
          <dt>{locale.keyboardDebugSamples}</dt><dd>{info && typeof info.samples === "number" ? info.samples : "—"}</dd>
        </dl>
        {(error || (info && info.error)) && <pre className="keyboard-debug-error">{error || info.error}</pre>}
        <h4>{locale.keyboardDebugPressed}</h4>
        <div className="keyboard-debug-keys">
          {pressed.length ? pressed.map((key) => <kbd key={key}>{labels[key] || key}</kbd>) : <span>{locale.keyboardDebugNone}</span>}
        </div>
        <h4>{locale.keyboardDebugLast}</h4>
        <div className="keyboard-debug-last">{chord(lastKeys) || "—"}</div>
        <div className="field-descr">{locale.keyboardDebugRaw} <code>{state}</code></div>
      </div>
    </div>
  );
}
