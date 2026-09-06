// Exercise the installed image-size parsers. Each untrusted input gets a child
// process so a regression cannot hang the release gate or the application host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function box(name, payload, declaredSize) {
  const buffer = Buffer.alloc(8 + payload.length);
  buffer.writeUInt32BE(declaredSize ?? buffer.length);
  buffer.write(name, 4, 4, 'ascii');
  payload.copy(buffer, 8);
  return buffer;
}

function fixtures() {
  const dimensions = Buffer.alloc(12);
  dimensions.writeUInt32BE(32, 4);
  dimensions.writeUInt32BE(48, 8);
  const heif = size => Buffer.concat([
    box('ftyp', Buffer.from('mif1\0\0\0\0')),
    box('meta', Buffer.concat([
      Buffer.alloc(4), box('iprp', box('ipco', box('ispe', dimensions, size))),
    ])),
  ]);
  const jxl = size => Buffer.concat([
    box('JXL ', Buffer.from([13, 10, 135, 10])),
    box('ftyp', Buffer.from('jxl \0\0\0\0')),
    box('jxlp', Buffer.from([0, 0, 0, 0, 255, 10, 1, 0]), size),
  ]);
  const icns = size => {
    const buffer = Buffer.alloc(16);
    buffer.write('icns', 0);
    buffer.writeUInt32BE(16, 4);
    buffer.write('ic07', 8);
    buffer.writeUInt32BE(size ?? 8, 12);
    return buffer;
  };
  const partialIcns = icns(1024);
  partialIcns.writeUInt32BE(1032, 4);
  // These are dimensions-only format fixtures. The PNG is an encoded 1px image.
  return {
    'heif-zero': { data: heif(0), reject: true },
    'heif-short': { data: heif(19), reject: true },
    'jxl-zero': { data: jxl(0), reject: true },
    'jxl-short': { data: jxl(11), reject: true },
    'icns-zero': { data: icns(0), reject: true },
    'icns-short': { data: icns(4), reject: true },
    'icns-seven': { data: icns(7), reject: true },
    'icns-truncated': { data: icns().subarray(0, 15), reject: true },
    'heif-valid': { data: heif(), dimensions: [32, 48] },
    'jxl-valid': { data: jxl(), dimensions: [8, 8] },
    'icns-valid': { data: icns(), dimensions: [128, 128] },
    'icns-partial': { data: partialIcns, dimensions: [128, 128] },
    'png-valid': {
      data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'),
      dimensions: [1, 1],
    },
  };
}

async function child() {
  const [packageRoot, mode, name, inputFile] = process.argv.slice(3);
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json')));
  const isEsm = mode.endsWith('esm');
  const extension = isEsm ? 'mjs' : manifest.version.startsWith('2.') ? 'cjs' : 'js';
  const type = mode.startsWith('type-') ? mode.split('-')[1] : undefined;
  const entry = type ? `dist/types/${type}.${extension}`
    : mode.startsWith('file-') && manifest.version.startsWith('2.') ? `dist/fromFile.${extension}`
      : isEsm ? 'dist/index.mjs' : manifest.main;
  const modulePath = path.join(packageRoot, entry);
  const loaded = isEsm ? await import(pathToFileURL(modulePath).href) : require(modulePath);
  const fn = type ? loaded[type.toUpperCase()].calculate
    : mode.startsWith('file-') && manifest.version.startsWith('2.') ? loaded.imageSizeFromFile
      : loaded.imageSize || loaded.default || loaded;
  assert.equal(typeof fn, 'function');
  const input = mode.startsWith('file-') ? inputFile : fixtures()[name].data;
  try {
    const measured = await fn(input);
    process.stdout.write(JSON.stringify({ status: 'parsed', dimensions: [measured.width, measured.height] }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'rejected', error: error.message }));
  }
}

function installedParsers(sourceRoot) {
  const seen = new Set();
  const matches = [];
  function visitModules(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const packageRoot = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        visitModules(packageRoot);
        continue;
      }
      const manifestPath = path.join(packageRoot, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const real = fs.realpathSync(packageRoot);
      if (seen.has(real)) continue;
      seen.add(real);
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      if (manifest.name === 'image-size') matches.push({ root: real, version: manifest.version });
      visitModules(path.join(packageRoot, 'node_modules'));
    }
  }
  visitModules(path.join(sourceRoot, 'node_modules'));
  assert.ok(matches.length > 0, 'No installed image-size parser was found');
  return matches;
}

async function main() {
  if (process.argv[2] === '--child') return child();
  const sourceRoot = path.resolve(process.argv[2] || process.cwd());
  const packages = installedParsers(sourceRoot);
  const cases = fixtures();
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toybaco-image-parser-'));
  let checked = 0;
  const observations = [];
  try {
    for (const [name, fixture] of Object.entries(cases)) {
      fs.writeFileSync(path.join(fixtureRoot, name), fixture.data);
    }
    for (const dependency of packages) {
      assert.ok(['1.2.1', '2.0.2'].includes(dependency.version), `Unreviewed image-size version: ${dependency.version}`);
      const modes = dependency.version.startsWith('2.')
        ? ['cjs', 'esm', 'file-cjs', 'file-esm', 'type-heif-cjs', 'type-heif-esm', 'type-jxl-cjs', 'type-jxl-esm', 'type-icns-cjs', 'type-icns-esm']
        : ['cjs', 'file-cjs', 'type-heif-cjs', 'type-jxl-cjs', 'type-icns-cjs'];
      for (const mode of modes) {
        for (const [name, fixture] of Object.entries(cases)) {
          if (mode.startsWith('type-') && !name.startsWith(`${mode.split('-')[1]}-`)) continue;
          const result = spawnSync(process.execPath, [
            '--max-old-space-size=64', __filename, '--child', dependency.root, mode, name, path.join(fixtureRoot, name),
          ], { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 65536 });
          const label = `${dependency.version} ${mode} ${name}`;
          assert.equal(result.error, undefined, `${label}: child failed or timed out`);
          assert.equal(result.status, 0, `${label}: ${result.stderr}`);
          const observation = JSON.parse(result.stdout);
          assert.equal(observation.status, fixture.reject ? 'rejected' : 'parsed', label);
          if (!fixture.reject) assert.deepEqual(observation.dimensions, fixture.dimensions, label);
          checked++;
        }
      }
      observations.push({ version: dependency.version, path: path.relative(sourceRoot, dependency.root) });
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ status: 'PASS', check: 'installed-image-parser-bounds', node: process.version, platform: process.platform, arch: process.arch, packages: observations, cases: checked }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
