// Keep common script headings while avoiding page mentions inside dialogue.
export const parsePageMarker = (text) => {
  if (typeof text !== 'string') return null;
  let heading = text.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim();
  if (heading[0] === '[' && heading[heading.length - 1] === ']') heading = heading.slice(1, -1).trim();
  const match = /^Page\s+([0-9]+)\s*(?:(?::|[-\u2013\u2014]).*|\.)?$/i.exec(heading);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
};
