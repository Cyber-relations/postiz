'use strict';

// Next 16.3.6 ships a versionless ncc copy of shell-quote 1.7.3. An ordinary
// pnpm override does not replace it. Delegate that exact reviewed copy to the
// installed production package; retain the original package metadata/license.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ORIGINAL_SHA256 = 'baa80c1a37327583ba7140ba9d81a65da1d9f1679df11cb51617d7382a1a9037';
const METADATA_SHA256 = '907fda3052f7e1ece852b1cf025642aa3d90cb96ccccf4d568017d974002e9af';
const DELEGATE = "'use strict';\n// Toybaco: use the pinned production shell-quote package.\nmodule.exports = require('shell-quote');\n";

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function regular(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Regular dependency file required: ${file}`);
  return stat;
}

function applyAndVerify(sourceRoot, checkOnly = false) {
  const root = fs.realpathSync(sourceRoot);
  regular(path.join(root, 'package.json'));
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const nextManifestPath = rootRequire.resolve('next/package.json');
  regular(nextManifestPath);
  assert.equal(JSON.parse(fs.readFileSync(nextManifestPath)).version, '16.3.6', 'Unreviewed Next version');
  const vendor = path.join(path.dirname(nextManifestPath), 'dist/compiled/shell-quote/index.js');
  const stat = regular(vendor);
  assert.ok(fs.realpathSync(vendor).startsWith(root + path.sep), 'Next vendor must belong to this install');
  const metadata = path.join(path.dirname(vendor), 'package.json');
  regular(metadata);
  assert.equal(hash(fs.readFileSync(metadata)), METADATA_SHA256, 'Unreviewed vendor metadata');
  const before = fs.readFileSync(vendor);
  const beforeHash = hash(before);
  assert.ok([ORIGINAL_SHA256, hash(DELEGATE)].includes(beforeHash), 'Unreviewed vendor bytes');

  const vendorRequire = createRequire(vendor);
  const fixedManifest = vendorRequire.resolve('shell-quote/package.json');
  regular(fixedManifest);
  assert.ok(fs.realpathSync(fixedManifest).startsWith(root + path.sep), 'Fixed package must belong to this install');
  assert.equal(JSON.parse(fs.readFileSync(fixedManifest)).version, '1.11.0', 'Fixed package must be exactly 1.11.0');
  const fixed = vendorRequire('shell-quote');
  assert.equal(typeof fixed.parse, 'function');
  assert.equal(typeof fixed.quote, 'function');

  if (!checkOnly && beforeHash === ORIGINAL_SHA256) {
    // Replace the directory entry, never edit a pnpm store hardlink in place.
    const temporary = vendor + '.toybaco-' + crypto.randomBytes(8).toString('hex');
    try {
      fs.writeFileSync(temporary, DELEGATE, { flag: 'wx', mode: stat.mode & 0o777 });
      fs.renameSync(temporary, vendor);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  assert.equal(hash(fs.readFileSync(vendor)), hash(DELEGATE), 'Next vendor delegation is missing');
  delete require.cache[vendorRequire.resolve(vendor)];
  const delegated = vendorRequire(vendor);
  assert.equal(delegated.parse, fixed.parse, 'Next parser must be the installed fixed parser');
  assert.equal(delegated.quote, fixed.quote, 'Next quoting must be the installed fixed implementation');

  const values = ['plain', 'space here', 'line\nbreak', "single'quote", '$(not-executed); literal', '雪'];
  assert.deepEqual(delegated.parse(delegated.quote(values)), values, 'Literal argument round trip');
  assert.deepEqual(delegated.parse('echo "$FIXTURE_VALUE"', { FIXTURE_VALUE: 'two words' }), ['echo', 'two words']);
  assert.equal(hash(fs.readFileSync(metadata)), METADATA_SHA256, 'Vendor metadata must remain unchanged');
  return { check: 'next-vendored-shell-quote-binding', status: 'PASS', next: '16.3.6',
    resolved_shell_quote: '1.11.0', delegate_sha256: hash(DELEGATE),
    original_vendor_metadata_unchanged: true, store_hardlink_not_modified: true,
    mode: checkOnly ? 'verify' : 'apply-and-verify' };
}

module.exports = { applyAndVerify, ORIGINAL_SHA256, METADATA_SHA256, DELEGATE };

if (require.main === module) {
  try {
    assert.ok(['--apply', '--check'].includes(process.argv[2]) && process.argv.length === 4,
      'Usage: fix-next-shell-quote.cjs --apply|--check SOURCE_ROOT');
    console.log(JSON.stringify(applyAndVerify(process.argv[3], process.argv[2] === '--check')));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
