// Message bridge between the panel (this WebView) and the plugin host
// (uxp-src/host/main.js). Messages travel as JSON strings both ways.
const pending = new Map();
const handlers = {};
let nextId = 1;

function hostWindow() {
  return window.uxpHost || null;
}

function send(message) {
  const host = hostWindow();
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

window.addEventListener("message", (event) => {
  let message = event.data;
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
});
