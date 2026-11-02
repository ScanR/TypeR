// No document text, settings, request arguments, or message payloads belong here.
function createDiagnosticLog(environment, roots = [], now = () => new Date()) {
  const started = now().toISOString();
  const events = [];
  let dropped = 0;
  const clean = value => {
    let text = String(value === undefined ? '' : value);
    roots.filter(Boolean).sort((a, b) => b.length - a.length).forEach(root => {
      for (const variant of [root, root.replace(/\\/g, '/'), root.replace(/\//g, '\\'), encodeURI(root.replace(/\\/g, '/'))]) {
        text = text.replace(new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<USER>');
      }
    });
    text = text.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?<redacted>');
    return text.slice(0, 1800);
  };
  return {
    note(stage, detail) {
      events.push({ time: now().toISOString(), stage: clean(stage).slice(0, 80), detail: clean(detail) });
      if (events.length > 1000) { events.shift(); dropped++; }
    },
    snapshot() { return JSON.stringify({ format: 'TypeR startup diagnostic v1', started, environment, dropped, events }, null, 2); }
  };
}
module.exports = { createDiagnosticLog };
