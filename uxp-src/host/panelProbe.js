// Crash trace builds only: when the panel stays silent, small separate WebViews
// tell what fails, on screen and in the trace. A local page that loads with a
// fixed size but not in percent points to the layout, a web page without the
// local one to the plugin: address, and nothing loading at all to the runtime.
// Never part of a release build.
const WATCH_MS = 15000;

const PROBES = [
  { name: "local", src: "plugin:/web/probe.html", width: "100%", height: "70px" },
  { name: "local-percent", src: "plugin:/web/probe.html", width: "100%", height: "100%" },
  { name: "web", src: "https://example.com/", width: "100%", height: "70px" },
];

function startProbe(probe, container, note) {
  const result = { name: probe.name, starts: 0, stops: 0, error: "", message: "", size: "not created" };
  const say = (text) => note(probe.name + ": " + text);
  try {
    // A percent height needs a parent with a size
    const box = document.createElement("div");
    box.style.cssText = "flex:none;height:70px;margin-top:4px;background:#7a1f1f";
    const view = document.createElement("webview");
    view.setAttribute("width", probe.width);
    view.setAttribute("height", probe.height);
    view.style.width = probe.width;
    view.style.height = probe.height;
    view.addEventListener("loadstart", (event) => {
      result.starts++;
      say("start " + String(event.url || "").slice(0, 80));
    });
    view.addEventListener("loadstop", () => {
      result.stops++;
      say("stop");
    });
    view.addEventListener("loaderror", (event) => {
      result.error = String(event.message || event.code || "error");
      say("error " + result.error);
    });
    view.addEventListener("message", (event) => {
      result.message = String(event.message !== undefined ? event.message : event.data);
      say("message " + result.message);
    });
    box.appendChild(view);
    container.appendChild(box);
    view.src = probe.src;
    result.view = view;
  } catch (error) {
    result.error = String((error && error.message) || error);
    say("failed " + result.error);
  }
  return result;
}

function summary(result) {
  const parts = [result.starts + " start", result.stops + " stop", result.size];
  if (result.error) parts.push("error " + result.error);
  if (result.message) parts.push("answered");
  return result.name + ": " + parts.join(", ");
}

// Red boxes stay red where a probe paints nothing
function run({ mainView, note, report }) {
  if (mainView) mainView.style.display = "none";
  const container = document.createElement("div");
  container.style.cssText = "flex:none;padding:0 8px";
  document.body.appendChild(container);
  const results = PROBES.map((probe) => startProbe(probe, container, note));
  report("Probes running...");
  const timer = setTimeout(() => {
    results.forEach((result) => {
      try {
        const box = result.view.getBoundingClientRect();
        result.size = Math.round(box.width) + "x" + Math.round(box.height);
      } catch (error) {}
    });
    const text = results.map(summary).join("\n");
    note(text);
    report(text);
  }, WATCH_MS);
  return () => {
    clearTimeout(timer);
    container.remove();
  };
}

module.exports = { run };
