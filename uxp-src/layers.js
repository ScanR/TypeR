const ps = require('photoshop');
const {play, mutate, strokeStyle, getLayer, readSelection, keepLayerSize, setText, moveTo, selectLayer, reselect} = require('./photoshop');
const {bounds, makeTextDescriptor} = require('./text-style');

// Cleaning layers hidden by toggleCleaningLayers, per document: the next call
// restores that exact list instead of re-detecting layers the user moved.
const hiddenCleaningLayers = {};

async function applyText(doc, data, layer) {
  const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
  // Each item goes through the reference's single-layer apply, which keeps
  // the layer's own size when "keep the text size" is held
  await setText(makeTextDescriptor(keepLayerSize(data, layer.textKey, doc.resolution), layer.textKey, 20, doc.resolution));
  await strokeStyle(data.style?.stroke);
  if (oldBounds) await moveTo(oldBounds);
}

async function targetLayer(layerId) {
  const id = parseInt(layerId, 10);
  if (!Number.isSafeInteger(id)) throw new Error('Calque cible introuvable.');
  await selectLayer(id);
  const layer = await getLayer();
  // The descriptor just read is the selected layer's; the DOM can still report
  // the layer that was active when the modal session opened.
  const locked = layer.layerLocking ? layer.layerLocking.protectAll : ps.app.activeDocument.activeLayer?.allLocked;
  if (locked) throw new Error('Le calque cible est verrouillé.');
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
// All the reads go in one batchPlay call: a page has dozens of layers, and one
// round trip each made the toggle visibly slow.
async function cleaningLayerIds(state) {
  const leaves = state.leaves.slice(0, -1)
    .filter(leaf => leaf.visible && leaf.parentsVisible && leaf.kind !== ps.constants.LayerKind.TEXT);
  if (!leaves.length) return [];
  const results = await ps.action.batchPlay(leaves.map(leaf => ({
    _obj: 'get',
    _target: [{_ref: 'layer', _id: leaf.id}],
    _options: {dialogOptions: 'dontDisplay'},
  })), {});
  return leaves.filter((leaf, index) => {
    const result = results[index];
    return result && result._obj !== 'error' && !result.adjustmentLayer;
  }).map(leaf => leaf.id);
}

// Visibility is a document change: UXP refuses it outside a modal session.
// Hiding is not an edit to undo, as in the reference, so it runs without a
// history step of its own.
async function setLayerVisibility(ids, visible) {
  if (!ids.length) return;
  await ps.core.executeAsModal(() => play({_obj: visible ? 'show' : 'hide', null: ids.map(id => ({_ref: 'layer', _id: id}))}), {commandName: 'TypeR : calques de nettoyage'});
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
      await reselect(ids);
      return '';
    });
  },
  async deselectDocumentSelection() {
    if (!ps.app.documents.length) return 'doc';
    // A selection change edits the document, which UXP only allows modally.
    try {
      await ps.core.executeAsModal(async () => {
        const selection = ps.app.activeDocument.selection;
        if (selection && selection.deselect) await selection.deselect();
      }, {commandName: 'TypeR : désélectionner'});
    } catch (_) {}
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
