// The panel calls the host with ExtendScript strings, "name(json, json, ...)":
// csInterface.evalScript("setActiveLayerText(" + JSON.stringify(data) + ")").
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

module.exports = { parseCall };
