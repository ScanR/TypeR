// Message bridge between the panel and the plugin host (uxp-src/host/main.js).
// Messages travel as JSON strings both ways. In a WebView they go through
// postMessage; when Photoshop refuses the WebView, the application runs in
// the panel's own DOM, in the host's JavaScript context, and the host hands
// over a direct channel instead (window.__typerInPanel, uxp-src/host/inPanel.js).
const pending = new Map();
const handlers = {};
let nextId = 1;

const inPanel = typeof window !== "undefined" ? window.__typerInPanel || null : null;

export const runsInPanel = !!inPanel;

function send(message) {
  if (inPanel) {
    inPanel.toHost(JSON.stringify(message));
    return;
  }
  const host = window.uxpHost || null;
  if (!host) throw new Error("TypeR: the plugin host is not reachable");
  host.postMessage(JSON.stringify(message));
}

export function request(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      send({ type: "request", id, method, args });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export function notify(type, payload = {}) {
  try {
    send(Object.assign({ type }, payload));
  } catch (error) {}
}

export function on(type, handler) {
  (handlers[type] = handlers[type] || []).push(handler);
}

function receive(data) {
  let message = data;
  for (let depth = 0; typeof message === "string" && depth < 2; depth++) {
    try {
      message = JSON.parse(message);
    } catch (error) {
      return;
    }
  }
  if (!message || typeof message !== "object") return;
  if (message.type === "reply") {
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (message.error !== undefined) task.reject(new Error(message.error));
    else task.resolve(message.result);
    return;
  }
  (handlers[message.type] || []).forEach((handler) => {
    try {
      handler(message);
    } catch (error) {
      console.error("TypeR:", message.type, error);
    }
  });
}

if (inPanel) inPanel.toPanel = receive;
else window.addEventListener("message", (event) => receive(event.data));
