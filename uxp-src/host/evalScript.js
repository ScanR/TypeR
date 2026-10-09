// The panel calls the host with ExtendScript strings, "name(json, json, ...)":
// csInterface.evalScript("setActiveLayerText(" + JSON.stringify(data) + ")").
// The Double bubble bridge prefixes some calls with others, "a(...);b(...)".
// They are parsed, never evaluated.

// A missing optional argument reaches ExtendScript as a bare `undefined`,
// which JSON does not know: it becomes null, strings are left alone
function replaceBareUndefined(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text.charAt(i + 1);
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (text.startsWith("undefined", i) && !/[\w$]/.test(text.charAt(i - 1) || "") && !/[\w$]/.test(text.charAt(i + 9) || "")) {
      out += "null";
      i += 8;
      continue;
    }
    out += char;
  }
  return out;
}

function parseCall(script) {
  const match = /^\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(String(script || ""));
  if (!match) return null;
  const body = match[2].trim();
  if (!body) return { name: match[1], args: [] };
  try {
    return { name: match[1], args: JSON.parse("[" + body + "]") };
  } catch (error) {
    try {
      return { name: match[1], args: JSON.parse("[" + replaceBareUndefined(body) + "]") };
    } catch (secondError) {
      return null;
    }
  }
}

// "a(...);b(...)": the calls in order, or null when one is not a call
function parseCalls(script) {
  const text = String(script || "");
  const statements = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === ";" && depth === 0) {
      statements.push(text.slice(start, i));
      start = i + 1;
    }
  }
  statements.push(text.slice(start));
  const calls = [];
  for (let i = 0; i < statements.length; i++) {
    if (!statements[i].trim()) continue;
    const call = parseCall(statements[i]);
    if (!call) return null;
    calls.push(call);
  }
  return calls.length ? calls : null;
}

module.exports = { parseCall, parseCalls };
