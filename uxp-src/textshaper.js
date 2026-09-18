const ps = require('photoshop');
const host = require('./photoshop');
const {play, mutate, document, getLayer, readSelection, liveSelection, usableBubble, readStroke, detectBubble, px, target} = host;
const {bounds, fromActionJSON, makeTextDescriptor} = require('./text-style');

const textOf = (layer) => (typeof layer?.textKey?.textKey === 'string' ? layer.textKey.textKey : '');
const isPoint = (layer) => layer?.textKey?.textShape?.[0]?.textType?._value === 'point';
const selected = (doc) => Array.from(doc.activeLayers || []);
const targetLayer = () => play({_obj: 'get', _target: target()});
const shapeRPayload = (data) => !!(data && data.text && data.style?.textProps?.layerText?.textStyleRange?.[0]);

function selectLayer(id) {
  return play({_obj: 'select', _target: [{_ref: 'layer', _id: id}], makeVisible: false});
}

async function selectLayers(ids) {
  for (let index = 0; index < ids.length; index++) {
    await play({
      _obj: 'select',
      _target: [{_ref: 'layer', _id: ids[index]}],
      ...(index ? {selectionModifier: {_enum: 'selectionModifierType', _value: 'addToSelection'}} : {}),
      makeVisible: false,
    });
  }
}

// BatchPlay is the only way to touch the marquee of a modal session, whose DOM
// selection is the one that was open when the session started. The wand itself
// is shared (photoshop.js): no spelling of it has been run against a real
// Photoshop yet, so it must not be guessed in two places.
async function clearMarquee() {
  const descriptor = property => ({_obj: 'set', _target: [{_ref: 'channel', _property: property}], to: {_enum: 'ordinal', _value: 'none'}});
  try { await play(descriptor('frameSelect')); }
  catch (_) { await play(descriptor('selection')); }
}

function modal(name, callback) {
  return ps.core.executeAsModal(callback, {commandName: name});
}

// The panel asks for a read while the user may be mid-edit: everything runs in
// one reverted history state, so a read leaves neither an entry in the history
// nor a stray duplicate layer behind.
async function reading(name, callback) {
  return modal(name, async context => {
    const doc = document();
    const history = await context.hostControl.suspendHistory({documentID: doc.id, name});
    try {
      return await callback(doc);
    } finally {
      try { await context.hostControl.resumeHistory(history, false); } catch (error) { console.error('TypeR history', error.message || error); }
    }
  });
}

async function restore(ids) {
  if (!ids.length) return;
  try { await modal('TypeR : restaurer la sélection', async () => selectLayers(ids)); } catch (error) { console.error('TypeR restore', error.message || error); }
}

function textType(value) {
  return play({_obj: 'set', _target: [{_ref: 'property', _property: 'textType'}, {_ref: 'layer', _enum: 'ordinal', _value: 'targetEnum'}], to: {_enum: 'textType', _value: value}});
}

// A box layer never stores its automatic wraps in textKey: only a point-text
// copy makes Photoshop materialize them.
async function renderedLines() {
  const original = await targetLayer();
  await play({_obj: 'duplicate', _target: target()});
  await textType('point');
  const layer = await targetLayer();
  await play({_obj: 'delete', _target: target()});
  // The copy took the selection: the caller gets its layer back
  if (original?.layerID != null) await selectLayer(original.layerID);
  return textOf(layer);
}

// host.js samples the bubble outline along the wand selection and smooths it;
// UXP exposes no path sampling, so only the wand box survives — enough for the
// fit, which clamps to it. The detection itself is the shared one the centring
// code uses (photoshop.js detectBubble).
async function bubbleAround(doc, layer) {
  const found = await detectBubble(doc, layer);
  // The marquee is ours and the page gets its own back: the scan may run with
  // no selection, never with someone else's
  try { await clearMarquee(); } catch (error) { console.error('TypeR deselect', error.message || error); }
  return found ? {rows: [], width: found.width, height: found.height} : null;
}

function visibleTextLayers(container, list, limit) {
  for (const layer of Array.from(container.layers || [])) {
    if (list.length >= limit) break;
    if (Array.from(layer.layers || []).length) { visibleTextLayers(layer, list, limit); continue; }
    if (layer.visible && layer.kind === ps.constants.LayerKind.TEXT) list.push(layer);
  }
  return list;
}

function trainingTextLayers(container, list, parentPath, parentVisible) {
  for (const layer of Array.from(container.layers || [])) {
    const path = parentPath ? `${parentPath} / ${layer.name}` : layer.name;
    if (Array.from(layer.layers || []).length) { trainingTextLayers(layer, list, path, parentVisible && layer.visible); continue; }
    if (layer.kind === ps.constants.LayerKind.TEXT) {
      list.push({layerId: layer.id, name: layer.name, layerPath: path, visible: parentVisible && layer.visible, text: ''});
    }
  }
  return list;
}

// UXP hands files over through pickers only: a bare path from the old CEP panel
// is not resolvable, so the panel passes back the persistent token it was given.
async function entryFor(path) {
  let system = null;
  try { system = require('uxp').storage.localFileSystem; } catch (_) {}
  if (!system || typeof path !== 'string' || !path.startsWith('psfile:')) return null;
  try { return await system.getEntryForPersistentToken(path.slice(7)); } catch (_) { return null; }
}

function findOpen(entry) {
  const names = [entry.name, entry.name.replace(/\.[^.]+$/, '')];
  return Array.from(ps.app.documents).find(doc => names.includes(doc.title) || names.includes(doc.name)) || null;
}

async function open(entry) {
  let doc = null;
  await modal('TypeR : ouvrir le PSD', async () => { doc = await ps.app.open(entry); });
  return doc;
}

async function duplicate(source) {
  let copy = null;
  await modal('TypeR : copie de travail', async () => {
    await play({_obj: 'duplicate', _target: [{_ref: 'document', _id: source.id}], name: 'TypeR Training Preview'});
    copy = ps.app.activeDocument;
  });
  return copy;
}

async function close(doc) {
  await modal('TypeR : fermer le PSD', async () => { await doc.close(ps.constants.SaveOptions.DONOTSAVECHANGES); });
}

async function activate(doc) {
  await modal('TypeR : document actif', async () => { ps.app.activeDocument = doc; });
}

// Everything FontScanR needs per text layer, in one pass: group and section
// layers fail the kind check, so the index space needs no special casing.
async function fontLayers(doc) {
  const results = [];
  const walk = async (container) => {
    for (const layer of Array.from(container.layers || [])) {
      if (Array.from(layer.layers || []).length) { await walk(layer); continue; }
      if (layer.kind !== ps.constants.LayerKind.TEXT) continue;
      try {
        const result = await play({_obj: 'get', _target: [{_ref: 'layer', _id: layer.id}]});
        const layerText = fromActionJSON(result.textKey || {});
        if (!layerText) continue;
        const runs = (layerText.textStyleRange || []).map(range => range && range.textStyle).filter(Boolean);
        if (!runs.length) continue;
        results.push({
          layerName: layer.name,
          antiAlias: layerText.antiAlias || 'antiAliasSmooth',
          typeUnit: result.textKey.textStyleRange?.[0]?.textStyle?.size?._unit || 'pixelsUnit',
          paragraphStyle: layerText.paragraphStyleRange?.[0]?.paragraphStyle || null,
          stroke: readStroke(result),
          runs,
        });
      } catch (error) {
        console.error('TypeR font', error.message || error);
      }
    }
  };
  await walk(doc);
  return results;
}

async function readTraining(work) {
  return modal('TypeR : analyse de l\'entraînement', async () => {
    ps.app.activeDocument = work;
    const entries = trainingTextLayers(work, [], '', true);
    for (const entry of entries) {
      try {
        await selectLayer(entry.layerId);
        const layer = await targetLayer();
        if (isPoint(layer)) { entry.text = textOf(layer); continue; }
        entry.text = await renderedLines();
        if (!entry.text) entry.error = 'readFailed';
      } catch (error) {
        console.error('TypeR training', error.message || error);
        entry.error = 'readFailed';
      }
    }
    return entries;
  });
}

const methods = {
  async getRenderedTextLines() {
    if (!ps.app.documents.length) return JSON.stringify({error: 'layer'});
    const doc = ps.app.activeDocument;
    const layers = selected(doc).map(layer => layer.id);
    const layer = await getLayer().catch(() => null);
    if (!layer) return JSON.stringify({error: 'layer'});
    if (isPoint(layer)) return JSON.stringify({text: textOf(layer)});
    let text = '';
    try {
      text = await reading('TypeR : lire les lignes rendues', async () => renderedLines());
    } catch (error) {
      console.error('TypeR read', error.message || error);
    }
    await restore(layers);
    return JSON.stringify({text});
  },
  async getAllRenderedTextLines(data) {
    if (!ps.app.documents.length) return JSON.stringify({error: 'document'});
    const doc = ps.app.activeDocument;
    const layers = selected(doc).map(layer => layer.id);
    const scanBubbles = !!(data && data.scanBubbles);
    let entries = [];
    try {
      entries = await reading('TypeR : lire les lignes de la page', async active => {
        // Bubble scans destroy the current selection: never sacrifice one the
        // user drew — without a selection at batch start, scans are free to run
        const canScan = scanBubbles && !(await readSelection());
        const found = [];
        for (const layer of visibleTextLayers(active, [], 80)) {
          try {
            await selectLayer(layer.id);
            const descriptor = await targetLayer();
            if (!descriptor.textKey) continue;
            const bubble = canScan ? await bubbleAround(active, descriptor) : null;
            const text = isPoint(descriptor) ? textOf(descriptor) : await renderedLines();
            if (text) found.push({text, bubble});
          } catch (error) {
            console.error('TypeR read', error.message || error);
          }
        }
        return found;
      });
    } catch (error) {
      console.error('TypeR read', error.message || error);
    }
    await restore(layers);
    return JSON.stringify({entries});
  },
  async setTextShapeRLayerText(data) {
    // A payload without a captured style goes through the classic apply
    if (!shapeRPayload(data)) return host.methods.setActiveLayerText(data);
    const current = ps.app.documents.length ? ps.app.activeDocument : null;
    try {
      return await mutate('TypeR : appliquer le texte et le style', async doc => {
        const layer = await getLayer();
        const wasAt = bounds(layer.boundsNoEffects || layer.bounds);
        const point = isPoint(layer);
        // A box layer soft-wraps any line the retained frame is too narrow to
        // hold, which would undo the line breaking being applied: hop through
        // point text, which never wraps, and let the box rebuilt on the way
        // back fit itself around the new text — the same detour host.js takes
        const previous = point ? layer.textKey : {...layer.textKey, textShape: undefined};
        if (!point) await textType('point');
        try {
          // Same history name as the classic apply so one undo covers it; the
          // stroke is left alone because only the line breaking changed
          await play({_obj: 'set', _target: [{_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: makeTextDescriptor(data, previous, 20, doc.resolution)});
        } finally {
          // The layer must never be left as point text, even on a failed set
          if (!point) await textType('box').catch(error => console.error('TypeR kind', error.message || error));
        }
        const after = await targetLayer();
        const now = bounds(after.boundsNoEffects || after.bounds);
        if (wasAt && now) await play({_obj: 'move', _target: target(), to: {_obj: 'offset', horizontal: px(wasAt.xMid - now.xMid), vertical: px(wasAt.yMid - now.yMid)}});
        return '';
      });
    } catch (error) {
      // A stale snapshot or an unexpected layer state still gets its text in:
      // the reference falls back to the full apply the same way — but never on
      // a document the user moved away from, which the fallback would edit
      console.error('TypeR lean apply', error.message || error);
      if (!Array.from(ps.app.documents).includes(current)) throw error;
      return host.methods.setActiveLayerText(data);
    }
  },
  async scanTextShapeRTraining(path) {
    const previous = ps.app.documents.length ? ps.app.activeDocument : null;
    if (!path && !previous) return JSON.stringify({error: 'document'});
    const entry = path ? await entryFor(path) : null;
    if (path && !entry) return JSON.stringify({error: 'notFound', file: path});
    if (entry && !/\.psd$/i.test(entry.name)) return JSON.stringify({error: 'badPath'});
    let work = null;
    let keep = null;
    try {
      // Reads run on a disposable copy: the source keeps its layer selection,
      // pixel selection and history
      const source = entry ? findOpen(entry) : previous;
      work = source ? await duplicate(source) : await open(entry);
      keep = previous && previous.id !== work.id ? previous : null;
      return JSON.stringify({entries: await readTraining(work)});
    } catch (error) {
      console.error('TypeR training', error.message || error);
      return JSON.stringify({error: 'scanFailed'});
    } finally {
      if (work) { try { await close(work); } catch (error) { console.error('TypeR close', error.message || error); } }
      if (keep) { try { await activate(keep); } catch (error) { console.error('TypeR restore', error.message || error); } }
    }
  },
  async reloadUserFonts() {
    // UXP has no font rescan (ExtendScript's app.refreshFonts): the list is
    // whatever Photoshop already loaded, so fresh installs need a restart
    return host.methods.getUserFonts();
  },
  async scanPsdFonts(path) {
    if (!path) return JSON.stringify({error: 'badPath'});
    const entry = await entryFor(path);
    if (!entry) return JSON.stringify({error: 'badPath', file: path});
    const previous = ps.app.documents.length ? ps.app.activeDocument : null;
    let doc = findOpen(entry);
    let temporary = false;
    try {
      if (doc) await activate(doc);
      else { doc = await open(entry); temporary = true; }
      return JSON.stringify({file: entry.nativePath || entry.name, layers: await fontLayers(doc)});
    } catch (error) {
      return JSON.stringify({error: 'scanFailed', file: path, message: error.message || String(error)});
    } finally {
      if (temporary && doc) { try { await close(doc); } catch (error) { console.error('TypeR close', error.message || error); } }
      if (temporary && previous) { try { await activate(previous); } catch (error) { console.error('TypeR restore', error.message || error); } }
    }
  },
};

module.exports = {methods};
