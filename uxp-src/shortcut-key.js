function keyToken(key) {
  if (!key || key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return '';
  if (key === '+' || key === 'Add') return 'PLUS';
  if (key === '-' || key === 'Subtract') return 'MINUS';
  if (key === '=') return 'EQUAL';
  if (key === '/') return 'DIVIDE';
  if (key === '*') return 'MULTIPLY';
  if (key === ' ') return 'SPACE';
  return String(key).toUpperCase();
}

function keysFromEvent(event) {
  const list = [];
  if (event.metaKey) list.push('WIN');
  if (event.ctrlKey) list.push('CTRL');
  if (event.altKey) list.push('ALT');
  if (event.shiftKey) list.push('SHIFT');
  const token = event.type === 'keydown' ? keyToken(event.key) : '';
  if (token) list.push(token);
  return list;
}

module.exports = {keyToken, keysFromEvent};
