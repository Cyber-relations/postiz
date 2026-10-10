'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const REMOVED = Object.freeze('libtiff6 librtmp1 libgnutls30t64 libkrb5-3 libgssapi-krb5-2 libk5crypto3 libkrb5support0 libsasl2-2 libsasl2-modules-db libldap2 libexpat1 libfontconfig1 libfreetype6 libpng16-16t64'.split(' '));
const RETAINED = Object.freeze(['nginx', 'zlib1g', 'libssl3t64', 'libstdc++6', 'libgcc-s1', 'fontconfig-config', 'fonts-dejavu-core']);
function validateStates(states) {
  for (const name of REMOVED) {
    assert.ok(Object.hasOwn(states, name), `missing package observation: ${name}`);
    assert.ok(['not-installed', 'unknown ok not-installed', 'deinstall ok config-files'].includes(states[name]), `unpruned OS package: ${name}`);
  }
  for (const name of RETAINED) assert.equal(states[name], 'install ok installed', `required OS package missing: ${name}`);
}
function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${binary} failed`);
  return result.stdout;
}
async function main(root) {
  const states = {};
  for (const name of [...REMOVED, ...RETAINED]) {
    const result = spawnSync('dpkg-query', ['-W', '-f=${Status}', name], { encoding: 'utf8', timeout: 10000 });
    assert.ok([0, 1].includes(result.status), 'dpkg-query unavailable');
    states[name] = result.status === 1 && !result.stdout.trim() ? 'not-installed' : result.stdout.trim();
  }
  validateStates(states);
  for (const directory of ['/usr/share/fonts', '/etc/fonts']) assert.ok(fs.statSync(directory).isDirectory());
  const sharp = require(path.join(root, 'node_modules/sharp'));
  for (const format of ['jpeg', 'png', 'webp', 'avif', 'tiff', 'gif']) {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#f06f47' } }).toFormat(format).toBuffer();
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.width, 8); assert.equal(meta.height, 8);
  }
  const svg = Buffer.from('<svg width="120" height="40" xmlns="http://www.w3.org/2000/svg"><text x="0" y="25" font-size="20">Toybaco トイバコ</text></svg>');
  const bytes = await sharp(svg).png().toBuffer();
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 120); assert.equal(meta.height, 40); assert.ok(bytes.length > 200);
  for (const file of ['/usr/sbin/nginx', path.join(root, 'node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node'), path.join(root, 'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x')]) {
    assert.ok(!command('ldd', [file]).includes('not found'), 'required ELF library missing');
  }
  assert.equal(process.version, 'v22.23.2');
  command('nginx', ['-v']);
  command(path.join(root, 'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x'), ['--version']);
  console.log('TOYBACO_OS_RUNTIME=PASS removed14 retained7 nativeSharp6 fonts Nginx Prisma');
}
module.exports = { REMOVED, RETAINED, validateStates };
if (require.main === module) main(path.resolve(process.argv[2] || '/app')).catch(error => { console.error(`OS runtime rejected: ${error.message}`); process.exitCode = 1; });
