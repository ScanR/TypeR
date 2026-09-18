const COMMANDS = [
  {id: 'typerAdd', command: 'add', actionName: 'TypeR Insérer', label: {default: 'Insert / Apply', fr: 'Insérer / Appliquer'}},
  {id: 'typerApply', command: 'apply', actionName: 'TypeR Appliquer le style', label: {default: 'Apply style', fr: 'Appliquer le style'}},
  {id: 'typerCenter', command: 'center', actionName: 'TypeR Centrer', label: {default: 'Center', fr: 'Centrer'}},
  {id: 'typerInsertText', command: 'insertText', actionName: 'TypeR Coller le texte', label: {default: 'Paste text', fr: 'Coller le texte'}},
  {id: 'typerNext', command: 'next', actionName: 'TypeR Ligne suivante', label: {default: 'Next line', fr: 'Ligne suivante'}},
  {id: 'typerPrevious', command: 'previous', actionName: 'TypeR Ligne précédente', label: {default: 'Previous line', fr: 'Ligne précédente'}},
  {id: 'typerIncrease', command: 'increase', actionName: 'TypeR Taille +', label: {default: 'Increase size', fr: 'Augmenter la taille'}},
  {id: 'typerDecrease', command: 'decrease', actionName: 'TypeR Taille -', label: {default: 'Decrease size', fr: 'Diminuer la taille'}},
  {id: 'typerNextPage', command: 'nextPage', actionName: 'TypeR Page suivante', label: {default: 'Next page', fr: 'Page suivante'}},
  {id: 'typerToggleMultiBubble', command: 'toggleMultiBubble', actionName: 'TypeR Multi-bulles', label: {default: 'Toggle multi-bubble', fr: 'Mode multi-bulles'}},
];

const ACTION_SET = 'TypeR Silicon';

function resolveShortcutCommand(command, info = {}) {
  if (command === 'add' && info.multiBubble && info.storedCount > 0) return 'add';
  if (command === 'add' && !info.hasSelection && info.hasTextLayer) return 'apply';
  return command;
}

function commandFromActionName(name) {
  return COMMANDS.find(item => item.actionName === name)?.command || null;
}

module.exports = {COMMANDS, ACTION_SET, resolveShortcutCommand, commandFromActionName};
