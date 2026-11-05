// Markdown emphasis around a heading, such as the bold a Google Docs paste brings.
const stripEmphasis = (text) => text.replace(/^(?:\*+|_+|~~)\s*/, '').replace(/\s*(?:\*+|_+|~~)$/, '').trim();

// Keep common script headings while avoiding page mentions inside dialogue.
export const parsePageMarker = (text) => {
  if (typeof text !== 'string') return null;
  let heading = stripEmphasis(text.trim().replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim());
  if (heading[0] === '[' && heading[heading.length - 1] === ']') heading = stripEmphasis(heading.slice(1, -1).trim());
  // The emphasis can also close right after the number: "**Page 12** - Title", "**Page 12:** Title".
  const match = /^Page\s+([0-9]+)(?:\*+|_+|~~)?\s*(?:(?::|[-–—]).*|\.)?$/i.exec(heading);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
};
