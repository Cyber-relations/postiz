'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { applyAndVerify, DELEGATE } = require('./toybaco-fix-next-shell-quote.cjs');

async function main(sourceRoot) {
  assert.equal(process.argv.length, 3, 'Usage: verify-next-shell-quote.cjs SOURCE_ROOT');
  const root = fs.realpathSync(sourceRoot);
  const result = applyAndVerify(root, true);
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const handlebars = rootRequire('handlebars');
  assert.equal(handlebars.VERSION, '4.7.10', 'Fixed Handlebars must be exactly 4.7.10');
  assert.equal(handlebars.compile('{{value}}')({ value: '<script>&' }), '&lt;script&gt;&amp;');
  assert.equal(handlebars.compile('{{#each values}}{{this}}{{/each}}')({ values: new Set(['a', 'b']) }), 'ab');
  const next = path.dirname(rootRequire.resolve('next/package.json'));
  const vendor = path.join(next, 'dist/compiled/shell-quote');
  const vendorRequire = createRequire(path.join(vendor, 'index.js'));
  const fixed = path.dirname(vendorRequire.resolve('shell-quote/package.json'));
  const api = vendorRequire('shell-quote');
  const esm = await import(pathToFileURL(path.join(vendor, 'index.js')).href);
  assert.equal(esm.parse, api.parse, 'ESM parser must bind the installed fixed parser');
  assert.equal(esm.quote, api.quote, 'ESM quoting must bind the installed fixed implementation');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'toybaco-next-shellquote-'));
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  let cases = 0;
  try {
    const kinds = ['next-version', 'next-old-affected', 'metadata', 'vendor-bytes', 'vendor-symlink', 'fixed-version', 'fixed-outside-root'];
    for (const kind of kinds) {
      const fixture = path.join(temporary, kind);
      const moduleRoot = path.join(fixture, 'node_modules/next');
      const compiled = path.join(moduleRoot, 'dist/compiled/shell-quote');
      fs.mkdirSync(compiled, { recursive: true });
      fs.writeFileSync(path.join(fixture, 'package.json'), '{}');
      fs.copyFileSync(path.join(next, 'package.json'), path.join(moduleRoot, 'package.json'));
      for (const name of ['index.js', 'package.json']) {
        fs.copyFileSync(path.join(vendor, name), path.join(compiled, name));
      }
      const api = path.join(fixture, 'node_modules/shell-quote');
      fs.cpSync(fixed, api, { recursive: true, dereference: true });
      const entry = path.join(compiled, 'index.js');
      if (kind === 'next-version' || kind === 'next-old-affected') {
        const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json')));
        manifest.version = kind === 'next-version' ? '16.4.0' : '16.3.6';
        fs.writeFileSync(path.join(moduleRoot, 'package.json'), JSON.stringify(manifest));
      }
      if (kind === 'metadata') fs.appendFileSync(path.join(compiled, 'package.json'), ' ');
      if (kind === 'vendor-bytes') fs.writeFileSync(entry, DELEGATE + '// drift\n');
      if (kind === 'vendor-symlink') {
        const original = path.join(compiled, 'original');
        fs.renameSync(entry, original);
        fs.symlinkSync(original, entry);
      }
      if (kind === 'fixed-version') {
        const manifest = JSON.parse(fs.readFileSync(path.join(api, 'package.json')));
        manifest.version = '1.10.0';
        fs.writeFileSync(path.join(api, 'package.json'), JSON.stringify(manifest));
      }
      if (kind === 'fixed-outside-root') {
        fs.rmSync(api, { recursive: true, force: true });
        fs.symlinkSync(fixed, api, 'dir');
      }
      const before = hash(entry);
      assert.throws(() => applyAndVerify(fixture));
      assert.equal(hash(entry), before, `Rejected ${kind} fixture must remain unchanged`);
      cases++;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ ...result, cases, check: 'installed-next-shell-quote-delegation',
    fixture_removed: true, commonjs_and_esm_binding: true,
    handlebars: handlebars.VERSION, template_escape_and_set_iteration: true,
    shell_commands_or_application_server_executed: false }));
}

main(process.argv[2]).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
