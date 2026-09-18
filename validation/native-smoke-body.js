// Executed only by the standalone .psjs test, never included in the plugin.
const photoshop = nativeRequire('photoshop');
const localFS = nativeRequire('uxp').storage.localFileSystem;
const native = hostModule.exports;
const report = {started: new Date().toISOString(), checks: []};
let testDocument;
function verify(name, condition, actual) {
  report.checks.push({name, passed: !!condition, actual});
  if (!condition) throw new Error('Verification failed: ' + name);
}
try {
  await photoshop.core.executeAsModal(async () => {
    testDocument = await photoshop.app.documents.add({width: 1000, height: 1000, resolution: 72, name: 'TypeR Silicon - verification', mode: 'RGBColorMode', fill: 'white'});
    await testDocument.selection.selectRectangle({left: 200, top: 150, right: 800, bottom: 650});
  }, {commandName: 'TypeR : document de verification'});
  const style = styleModule.exports.defaultStyle();
  style.textProps.layerText.textStyleRange[0].textStyle.size = 36;
  style.stroke = {enabled: true, size: 2, opacity: 100, color: {r: 255, g: 255, b: 255}};
  await native.methods.createTextLayerInSelection({text: 'Bonjour Silicon !\nDeuxieme ligne.', style}, false);
  let layer = await native.getLayer();
  verify('paragraph text created', layer.textKey.textKey === 'Bonjour Silicon !\rDeuxieme ligne.', layer.textKey.textKey);
  verify('stroke applied', layer.layerEffects?.frameFX?.enabled === true, layer.layerEffects?.frameFX);
  const captured = JSON.parse(await native.methods.getActiveLayerText());
  verify('style captured', !!captured.textProps.layerText.textStyleRange.length);
  await native.methods.changeActiveLayerTextSize(2);
  layer = await native.getLayer();
  verify('font size changed', Math.abs(layer.textKey.textStyleRange[0].textStyle.size._value - 38) < 0.01, layer.textKey.textStyleRange[0].textStyle.size);
  await native.methods.setActiveLayerText({text: 'Style applique', style: captured});
  verify('captured style reapplied', (await native.getLayer()).textKey.textKey === 'Style applique');
  // Changing the font of an existing layer applies a style with no text: an
  // empty text used to be taken literally and erased the layer.
  const fonts = JSON.parse(await native.methods.getUserFonts()).fonts;
  const currentFont = captured.textProps.layerText.textStyleRange[0].textStyle.fontPostScriptName;
  const otherFont = fonts.find(font => font.postScriptName && font.postScriptName !== currentFont);
  const restyled = JSON.parse(JSON.stringify(captured));
  restyled.textProps.layerText.textStyleRange[0].textStyle.fontPostScriptName = otherFont.postScriptName;
  await native.methods.setActiveLayerText({text: '', style: restyled});
  layer = await native.getLayer();
  verify('font change keeps the layer text', layer.textKey.textKey === 'Style applique', layer.textKey.textKey);
  verify('font change applied', layer.textKey.textStyleRange[0].textStyle.fontPostScriptName === otherFont.postScriptName, layer.textKey.textStyleRange[0].textStyle.fontPostScriptName);
  await native.methods.setActiveLayerText({text: 'Style applique', style: captured});
  // Inserting consumed the selection, and the wand has nothing to grab on a
  // plain white page: centring is checked against a selection the user made.
  await photoshop.core.executeAsModal(async () => {
    await testDocument.selection.selectRectangle({left: 200, top: 150, right: 800, bottom: 650});
  }, {commandName: 'TypeR : selection de verification'});
  await native.methods.alignTextLayerToSelection({resizeTextBox: true});
  layer = await native.getLayer();
  const rect = styleModule.exports.bounds(layer.boundsNoEffects || layer.bounds);
  verify('text centered', Math.abs(rect.xMid - 500) < 3 && Math.abs(rect.yMid - 400) < 3, rect);
  await photoshop.core.executeAsModal(async () => {
    await testDocument.selection.selectRectangle({left: 200, top: 700, right: 800, bottom: 950});
  }, {commandName: 'TypeR : selection de verification'});
  await native.methods.createTextLayerInSelection({text: 'Texte ponctuel', style}, true);
  layer = await native.getLayer();
  verify('point text created', layer.textKey.textShape?.[0]?.textType?._value === 'point', layer.textKey.textShape);
  // A speech balloon's tail is part of its marquee but not part of the area the
  // text sits in. The opening must cut it: a 40px band cannot survive a 40px
  // contraction, so the centre lands on the balloon (400) and not on the tail's
  // bounding box (525). This is the whole point of the adaptive opening.
  await photoshop.core.executeAsModal(async () => {
    await testDocument.selection.selectRectangle({left: 200, top: 200, right: 600, bottom: 600});
    await testDocument.selection.selectRectangle({left: 600, top: 380, right: 850, bottom: 420}, 'extend');
  }, {commandName: 'TypeR : bulle a queue de verification'});
  await native.methods.alignTextLayerToSelection({});
  layer = await native.getLayer();
  const balloon = styleModule.exports.bounds(layer.boundsNoEffects || layer.bounds);
  verify('balloon tail cut from the centring bounds', Math.abs(balloon.xMid - 400) < 3, balloon);
  const channels = Array.from(testDocument.channels || []).map(channel => channel.name);
  verify('temporary channel removed', channels.indexOf('__TyperSelectionTemp__') === -1, channels);
  const count = testDocument.layers.length;
  let rejected = false;
  try {
    await native.methods.createTextLayersInStoredSelections({texts: ['interdit'], selections: [{left: 1, top: 1, right: 500, bottom: 500, width: 499, height: 499, xMid: 250.5, yMid: 250.5, documentId: testDocument.id + 100000}]}, false);
  } catch (_) { rejected = true; }
  verify('stale document has no side effect', rejected && testDocument.layers.length === count);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.message || String(error);
  report.stack = error.stack;
} finally {
  const folder = await localFS.getEntryWithUrl('file:/Users/dadam/Documents/ScanR/TypeR-silicon/validation');
  const file = await folder.createFile('native-smoke-result.json', {overwrite: true});
  await file.write(JSON.stringify(report, null, 2));
  if (testDocument) await photoshop.core.executeAsModal(async () => {
    const image = await folder.createFile('native-smoke.psd', {overwrite: true});
    await testDocument.saveAs.psd(image, {}, true);
  }, {commandName: 'TypeR : enregistrer le document de verification'});
}
