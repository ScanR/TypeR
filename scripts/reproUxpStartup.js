// Real Photoshop integration probe. Adobe's UXP CLI service must already be running.
// Uses a separate plugin ID and data folder; never edits documents or installed TypeR.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const work = path.join(root, '.update-test', 'uxp-repro');
const tools = path.join(root, '.update-test', 'uxp-tools', 'node_modules');
const input = path.resolve(process.argv[2] || path.join(root, 'Releases/TypeR-DEBUG-Windows.zip'));
const tag = process.argv[3] || 'original';
const scenario = process.argv[4] || 'baseline';
if (!['baseline', 'zero-height', 'hidden', 'missing-page', 'missing-bundle', 'deny-local'].includes(scenario)) throw new Error('Unknown scenario');
if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a simple lowercase test name');
const folder = path.join(work, tag);
let files = unzipSync(fs.readFileSync(input));
const ccx = Object.keys(files).find(name => name.endsWith('.ccx'));
if (ccx) files = unzipSync(files[ccx]);
const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
manifest.id = 'com.scanr.typer.repro.' + tag;
manifest.name = 'TypeR Repro ' + tag;
for (const entry of manifest.entrypoints || []) {
  if (entry.type === 'panel') entry.label = { default: manifest.name };
}
fs.mkdirSync(folder, { recursive: true });
for (const [name, contents] of Object.entries(files)) {
  const target = path.resolve(folder, name);
  if (!target.startsWith(folder + path.sep)) throw new Error('Unsafe archive entry: ' + name);
  if (name.endsWith('/')) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (scenario === 'zero-height' || scenario === 'hidden') {
  const file = path.join(folder, 'index.html');
  const css = scenario === 'hidden' ? '#typer-view { display: none !important; }' : '#typer-view { flex: none; height: 0px; }';
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</style>', css + '\n</style>'));
}
if (scenario === 'missing-page') fs.unlinkSync(path.join(folder, 'web/index.html'));
if (scenario === 'missing-bundle') fs.unlinkSync(path.join(folder, 'web/index.js'));
if (scenario === 'deny-local') {
  manifest.requiredPermissions.webview.allowLocalRendering = 'no';
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
const sha = name => crypto.createHash('sha256').update(files[name]).digest('hex');
const report = {
  format: 'TypeR real Photoshop reproduction v1', started: new Date().toISOString(),
  input: path.basename(input), pluginId: manifest.id,
  hostSha256: sha('host.js'), panelSha256: sha('web/index.js'),
  scenario,
  note: 'Separate plugin ID and storage. Deliberate fault only when scenario is not baseline. No document operations.',
  samples: []
};
const output = path.join(work, tag + '-result.json');
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function readJournal() {
  const dir = path.join(process.env.APPDATA, 'Adobe/UXP/PluginsStorage/PHSP/27/Developer', manifest.id, 'PluginData/diagnostics');
  if (!fs.existsSync(dir)) return;
  const names = fs.readdirSync(dir).filter(n => /^typer-startup-\d+\.json$/.test(n));
  const journals = names.flatMap(n => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))]; }
    catch (error) { return []; } // A diagnostic flush may still be in progress.
  }).filter(j => j.started >= report.started);
  journals.sort((a, b) => b.started.localeCompare(a.started));
  report.journal = journals[0];
}
function verifyOutcome() {
  assert(report.journal, 'Expected a journal from this Photoshop run');
  const has = stage => report.journal.events.some(e => e.stage === stage);
  if (scenario === 'baseline' || scenario === 'zero-height' || scenario === 'hidden') assert(has('app.ready'), 'TypeR should reach app.ready');
  if (scenario === 'missing-page' || scenario === 'deny-local') assert(has('webview.loaderror'), 'Expected an explicit WebView error');
  if (scenario === 'missing-bundle') {
    assert(has('web.html.script') && has('webview.loadstop'), 'HTML should load even without the application bundle');
    assert(!has('app.ready'), 'Missing application bundle must not reach app.ready');
  }
  if (scenario === 'hidden') {
    assert(report.beforeRecoveryJournal, 'Expected a pre-recovery journal');
    assert(!report.beforeRecoveryJournal.events.some(e => /^(webview\.load|bridge\.|web\.|app\.ready)/.test(e.stage)), 'Hidden WebView should match the client\'s silence');
  }
  report.outcomeVerified = true;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const { UDTApplication } = require(path.join(tools, '@adobe/uxp-devtools-core'));
  const WebSocket = require(path.join(tools, 'ws'));
  UDTApplication.createInstance({});
  const client = UDTApplication.instance().client;
  let session, socket;
  try {
    await client.connect();
    session = await client.loadPlugin({ manifest: path.join(folder, 'manifest.json'), apps: ['PS@27.7.0'], breakOnStart: false });
    session.commitToRc(folder);
    console.log('Loaded isolated plugin:', manifest.id);
    const debug = await client.debugPlugin(session, { apps: ['PS@27.7.0'] });
    report.debug = debug;
    socket = new WebSocket(debug[0].cdtDebugWsUrl.replace(/^ws=/, 'ws://'));
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let next = 0;
    const pending = new Map();
    const contexts = [];
    socket.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
      if (pending.has(msg.id)) { const cb = pending.get(msg.id); pending.delete(msg.id); cb(msg); }
    });
    const send = (method, params) => new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 5000);
      pending.set(id, msg => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable', {});
    await pause(500);
    report.contexts = contexts;
    console.log('Contexts:', JSON.stringify(contexts));
    for (const delay of [1000, 5000, 18000]) {
      await pause(delay);
      const snapshot = await send('Runtime.evaluate', { contextId: contexts[0] && contexts[0].id, expression: `JSON.stringify({environment:{photoshop:require('uxp').host.version,uxp:require('uxp').versions.uxp},status:document.getElementById('typer-status')&&document.getElementById('typer-status').textContent,views:Array.from(document.querySelectorAll('webview')).map(v=>({src:v.src,rect:{width:v.getBoundingClientRect().width,height:v.getBoundingClientRect().height},inlineDisplay:v.style.display})),body:{width:document.body.getBoundingClientRect().width,height:document.body.getBoundingClientRect().height}})`, returnByValue: true });
      if (snapshot.exceptionDetails) throw new Error(JSON.stringify(snapshot.exceptionDetails));
      report.samples.push({ at: new Date().toISOString(), snapshot });
      save();
      console.log(JSON.stringify(report.samples[report.samples.length - 1]));
    }
    readJournal();
    console.log('Journal stages:', report.journal && [...new Set(report.journal.events.map(e => e.stage))].join(', '));
    if (scenario === 'hidden') {
      report.beforeRecoveryJournal = report.journal;
      report.recovery = await send('Runtime.evaluate', { contextId: contexts[0].id, expression: `document.querySelector('style').textContent = document.querySelector('style').textContent.replace('#typer-view { display: none !important; }', ''); 'Visibility restored'`, returnByValue: true });
      await pause(2000);
      readJournal();
      console.log('After restoring visibility:', report.journal && [...new Set(report.journal.events.map(e => e.stage))].join(', '));
    }
    verifyOutcome();
  } finally {
    if (socket) socket.close();
    try {
      if (session) {
        await client.unloadPlugin(session, { apps: ['PS@27.7.0'] });
        report.unloaded = true;
      }
    } finally {
      save();
      client.disconnect();
    }
  }
}
main().then(() => { console.log('Report:', output); process.exit(0); }, error => { report.error = error.stack; save(); console.error(error); process.exit(1); });
