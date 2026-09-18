const ps = require('photoshop');
const {play, mutate, strokeStyle, getLayer, readSelection, px, target} = require('./photoshop');
const {bounds, makeTextDescriptor} = require('./text-style');

// Cleaning layers hidden by toggleCleaningLayers, per document: the next call
// restores that exact list instead of re-detecting layers the user moved.
const hiddenCleaningLayers = {};

const selectLayer = (id, extend) => play({
  _obj: 'select',
  _target: [{_ref: 'layer', _id: id}],
  ...(extend ? {selectionModifier: {_enum: 'selectionModifierType', _value: 'addToSelection'}} : {}),
  makeVisible: false,
});

const setText = (descriptor) => play({_obj: 'set', _target: [{_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: descriptor});

async function moveTo(rect) {
  const layer = await getLayer();
  const current = bounds(layer.boundsNoEffects || layer.bounds);
  if (!current) throw new Error('Le texte ne tient pas dans la zone. Augmentez la zone ou réduisez la taille.');
  await play({_obj: 'move', _target: target(), to: {_obj: 'offset', horizontal: px(rect.xMid - current.xMid), vertical: px(rect.yMid - current.yMid)}});
}

async function applyText(doc, data, layer) {
  const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
  await setText(makeTextDescriptor(data, layer.textKey, 20, doc.resolution));
  await strokeStyle(data.style?.stroke);
  if (oldBounds) await moveTo(oldBounds);
}

async function targetLayer(layerId) {
  const id = parseInt(layerId, 10);
  if (!Number.isSafeInteger(id)) throw new Error('Calque cible introuvable.');
  await selectLayer(id);
  const layer = await getLayer();
  if (ps.app.activeDocument.activeLayer?.allLocked) throw new Error('Le calque cible est verrouillé.');
  return layer;
}

function selectedTextLayerIds() {
  if (!ps.app.documents.length) return [];
  return Array.from(ps.app.activeDocument.activeLayers || [])
    .filter(layer => layer.kind === ps.constants.LayerKind.TEXT)
    .map(layer => ({id: layer.id}));
}

function isGroup(layer) {
  return !!(layer.layers && layer.layers.length) || layer.kind === ps.constants.LayerKind.GROUP;
}

// Panel order: a group's children sit below its header, and only the layers
// whose groups are all visible can be hidden and shown again as a set.
function walkLayers(layers, parentsVisible, state) {
  for (const layer of layers || []) {
    state.ids.add(layer.id);
    if (isGroup(layer)) walkLayers(layer.layers, parentsVisible && layer.visible, state);
    else state.leaves.push({id: layer.id, kind: layer.kind, visible: layer.visible, parentsVisible});
  }
}

// Adjustment and fill layers hold no artwork to hide, and the background (or
// the bottom-most layer when the document has none) must stay on screen.
async function cleaningLayerIds(state) {
  const leaves = state.leaves.slice(0, -1)
    .filter(leaf => leaf.visible && leaf.parentsVisible && leaf.kind !== ps.constants.LayerKind.TEXT);
  const ids = [];
  for (const leaf of leaves) {
    const layer = await play({_obj: 'get', _target: [{_ref: 'layer', _id: leaf.id}]});
    if (!layer.adjustmentLayer) ids.push(leaf.id);
  }
  return ids;
}

async function setLayerVisibility(ids, visible) {
  if (!ids.length) return;
  await play({_obj: visible ? 'show' : 'hide', null: ids.map(id => ({_ref: 'layer', _id: id}))});
}

const methods = {
  async getSelectedTextLayers() {
    return ps.app.documents.length ? JSON.stringify({layers: selectedTextLayerIds()}) : JSON.stringify({error: 'doc'});
  },
  async getTypeRSelectionSnapshot() {
    const selection = await readSelection();
    return JSON.stringify({selection: selection || null, layers: selectedTextLayerIds()});
  },
  async setSelectedTextLayers(data) {
    return mutate('TypeR : collage multiple', async doc => {
      const items = (data && data.items) || [];
      if (items.length < 2) throw new Error('Sélectionnez au moins deux calques de texte.');
      // The host validated every target before writing: mutate's rollback is
      // only the net for a failure raised while Photoshop applies the text.
      for (const item of items) await targetLayer(item.layerId);
      for (const item of items) await applyText(doc, item, await targetLayer(item.layerId));
      const restore = data && data.restoreLayerIds && data.restoreLayerIds.length ? data.restoreLayerIds : items.map(item => item.layerId);
      const ids = restore.map(value => parseInt(value, 10)).filter(Number.isSafeInteger);
      for (let index = 0; index < ids.length; index++) await selectLayer(ids[index], index > 0);
      return '';
    });
  },
  async deselectDocumentSelection() {
    if (!ps.app.documents.length) return 'doc';
    const selection = ps.app.activeDocument.selection;
    try { if (selection && selection.deselect) await selection.deselect(); } catch (_) {}
    return '';
  },
  async undoLastTyperChange() {
    if (!ps.app.documents.length) return 'doc';
    try {
      // The host had to search history by name because its bubble scans left
      // dozens of states between two applies; here every command is a single
      // suspended-history state, so one undo lands on the previous command.
      await mutate('TypeR : annuler', async () => { await play({_obj: 'undo'}); return ''; });
      return '';
    } catch (_) {
      return 'none';
    }
  },
  async toggleCleaningLayers() {
    if (!ps.app.documents.length) return 'doc';
    const doc = ps.app.activeDocument;
    const key = String(doc.id);
    const state = {ids: new Set(), leaves: []};
    walkLayers(Array.from(doc.layers || []), true, state);
    if (Object.prototype.hasOwnProperty.call(hiddenCleaningLayers, key)) {
      const hidden = hiddenCleaningLayers[key];
      delete hiddenCleaningLayers[key];
      // A cleaning layer deleted while hidden is skipped, as Typesetterer did.
      await setLayerVisibility(hidden.filter(id => state.ids.has(id)), true);
      return 'shown:' + hidden.length;
    }
    const ids = await cleaningLayerIds(state);
    await setLayerVisibility(ids, false);
    hiddenCleaningLayers[key] = ids;
    return 'hidden:' + ids.length;
  },
};

module.exports = {methods};
