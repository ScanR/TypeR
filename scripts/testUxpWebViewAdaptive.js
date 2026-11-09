const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.join(__dirname, '../installer/repair_uxp_webview_win.ps1'), 'utf8');
const layouts = JSON.parse(source.match(/\$StorageLayouts = @'\r?\n([\s\S]*?)\r?\n'@ \| ConvertFrom-Json/)[1]);
assert.deepStrictEqual(layouts.map(layout => layout.bytes.length / 2), [511, 446, 195, 291]);
for (const layout of layouts) {
  let end = 0;
  for (const relocation of layout.relocations) {
    assert(relocation.offset >= end && relocation.offset + 4 <= layout.bytes.length / 2);
    assert(['call', 'iat', 'data'].includes(relocation.kind));
    if (relocation.kind === 'iat') assert(relocation.name);
    end = relocation.offset + 4;
  }
}

// A minimal PE with real instruction layouts, independently linked at different
// addresses. No Adobe binary is stored or executed by this test.
function fixture(shift = 0) {
  const bytes = Buffer.alloc(0x6400);
  const sections = [
    { name: '.text', rva: 0x1000, offset: 0x400, size: 0x4000, flags: 0x60000020 },
    { name: '.rdata', rva: 0x8000, offset: 0x4400, size: 0x1000, flags: 0x40000040 },
    { name: '.pdata', rva: 0xa000, offset: 0x5400, size: 0x1000, flags: 0x40000040 },
  ];
  const file = rva => {
    const section = sections.find(s => rva >= s.rva && rva < s.rva + s.size);
    assert(section, 'fixture RVA outside a section');
    return section.offset + rva - section.rva;
  };
  const u32 = (offset, value) => bytes.writeUInt32LE(value, offset);
  bytes.write('MZ'); u32(60, 0x80); bytes.write('PE\0\0', 0x80);
  bytes.writeUInt16LE(0x8664, 0x84); bytes.writeUInt16LE(sections.length, 0x86);
  bytes.writeUInt16LE(240, 0x94); bytes.writeUInt16LE(0x2000, 0x96);
  bytes.writeUInt16LE(0x20b, 0x98); u32(0x98 + 108, 16);
  u32(0x98 + 120, 0x8000); u32(0x98 + 124, 40);
  u32(0x98 + 136, 0xa000); u32(0x98 + 140, 48);
  sections.forEach((s, i) => {
    const at = 0x188 + i * 40;
    bytes.write(s.name, at); u32(at + 8, s.size); u32(at + 12, s.rva);
    u32(at + 16, s.size); u32(at + 20, s.offset); u32(at + 36, s.flags);
  });
  const names = [...new Set(layouts.flatMap(l => l.relocations.filter(r => r.kind === 'iat').map(r => r.name)))];
  u32(file(0x8000), 0x8100); u32(file(0x8010), 0x8200);
  names.forEach((name, i) => {
    bytes.writeBigUInt64LE(BigInt(0x8300 + i * 80), file(0x8100 + i * 8));
    bytes.writeBigUInt64LE(BigInt(0x8300 + i * 80), file(0x8200 + i * 8));
    bytes.write(name, file(0x8302 + i * 80));
  });
  const functions = [0x1100 + shift, 0x1500 + shift, 0x1800 + shift, 0x1a00 + shift];
  const literal = 0x8700;
  const callStub = 0x4800;
  bytes[file(callStub)] = 0xc3;
  const targets = [];
  layouts.forEach((layout, index) => {
    const rva = functions[index];
    Buffer.from(layout.bytes, 'hex').copy(bytes, file(rva));
    u32(file(0xa000 + index * 12), rva);
    u32(file(0xa004 + index * 12), rva + layout.bytes.length / 2);
    u32(file(0xa008 + index * 12), 0x8800); bytes[file(0x8800)] = 1;
    targets[index] = {};
    layout.relocations.forEach(rel => {
      let target = rel.kind === 'call' ? callStub : 0x8600;
      if (rel.kind === 'iat') target = 0x8200 + names.indexOf(rel.name) * 8;
      if (rel.literalHex) { target = literal; Buffer.from(rel.literalHex, 'hex').copy(bytes, file(target)); }
      if (index === 0 && rel.offset === 150) target = functions[1];
      if ((index === 0 && rel.offset === 47) || (index === 1 && rel.offset === 36)) target = functions[2];
      if (index === 0 && rel.offset === 34) target = functions[3];
      bytes.writeInt32LE(target - rva - rel.next, file(rva) + rel.offset);
      targets[index][rel.offset] = target;
    });
  });
  return { bytes, file, functions, targets, literal, names, patchOffset: file(functions[0]) + 333 };
}

const powershell = process.env.TYPER_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : null);
if (!powershell) {
  console.log('Adaptive DLL runtime tests skipped; set TYPER_POWERSHELL to enable them.');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typer-adaptive-test-'));
  try {
    const cases = [];
    function add(name, edit, supported = false, shift = 0) {
      const data = fixture(shift);
      edit(data);
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'dynamic-torqnative.dll'), data.bytes);
      fs.writeFileSync(path.join(dir, 'Photoshop.exe'), 'Test fixture');
      cases.push({ name, exe: path.join(dir, 'Photoshop.exe'), supported });
      return { dir, data };
    }
    const original = add('compatible', () => {}, true);
    add('relocated', () => {}, true, 0x1700);
    add('changed-header', d => { d.bytes[32] = 63; }, true);
    add('changed-stack', d => { d.bytes[d.file(d.functions[0]) + 26] ^= 8; });
    add('changed-constructor', d => { d.bytes[d.file(d.functions[1]) + 62] ^= 1; });
    add('changed-string-copy', d => { d.bytes[d.file(d.functions[2]) + 75] ^= 1; });
    add('changed-provider', d => { d.bytes[d.file(d.functions[3]) + 29] ^= 1; });
    add('wrong-import', d => { d.bytes[d.file(0x8302)] = 88; });
    add('wrong-storage-path', d => { d.bytes[d.file(d.literal)] = 88; });
    add('wrong-call', d => { d.bytes.writeInt32LE(0x4900 - d.functions[0] - 285, d.file(d.functions[0]) + 281); });
    add('call-outside-code', d => { d.bytes.writeInt32LE(0x8600 - d.functions[0] - 131, d.file(d.functions[0]) + 127); });
    add('trampoline-loop', d => { d.bytes[d.file(0x4800)] = 0xe9; d.bytes.writeInt32LE(-5, d.file(0x4801)); });
    add('wrong-boundary', d => { d.bytes.writeUInt32LE(d.functions[0] + 510, d.file(0xa004)); });
    add('ambiguous', d => { d.bytes.copy(d.bytes, d.file(0x2000), d.file(d.functions[0]), d.file(d.functions[0]) + 511); });
    add('wrong-architecture', d => { d.bytes.writeUInt16LE(0x14c, 0x84); });
    add('truncated', d => { d.bytes = d.bytes.subarray(0, 100); });
    fs.writeFileSync(path.join(root, 'cases.json'), JSON.stringify(cases));
    const run = (script, args) => {
      const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script), ...args], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, String(result.error || '') + result.stdout + result.stderr);
      process.stdout.write(result.stdout);
    };
    run('testUxpWebViewAdaptive.ps1', ['-CasesPath', path.join(root, 'cases.json')]);
    run('testUxpWebViewRepair.ps1', ['-OriginalDll', path.join(original.dir, 'dynamic-torqnative.dll'), '-Adaptive', '-AdaptiveOffset', String(original.data.patchOffset)]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
