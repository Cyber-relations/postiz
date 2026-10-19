'use strict';
// Runtime verifier for the source-built Node binary of the Postiz image
// (postiz/os-backport/node/build-node-shared-zlib.sh). It never runs or suppresses a
// scanner.
//
//   verify <build-stamp.json>
//     The running binary must be /usr/local/bin/node with the stamp's SHA-256, built
//     from the pinned and signature-verified release source with --shared-zlib. Its
//     ELF must need libz.so.1, carry no RPATH/RUNPATH and export no gz* symbol, and
//     the libz it maps must be the installed zlib1g +toybaco1 file (the same bytes the
//     builder linked and tested against). Prints JSON on stdout and the
//     TOYBACO_POSTIZ_NODE_SHARED_ZLIB= line on stderr.
//
//   native-modules <app-root> [--reference <node>]
//     Loads every x86-64 glibc native module (*.node) under <app-root>/node_modules
//     with this binary, each in its own process. A module whose shared-library
//     dependencies are absent from the image (ldd "not found") cannot load under any
//     Node and is listed as unresolvable; a missing libz.so.1 fails instead. Other
//     platforms' binaries are listed and skipped by their ELF header. At least one
//     Prisma query engine must load. With --reference, the same set is loaded with the
//     reference binary as well and the outcomes must be identical. A file whose ELF
//     cannot be parsed is listed as unreadable. Modules importing gz* are listed
//     (static symbol-table read only; nothing is called).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED = Object.freeze({
  node_path: '/usr/local/bin/node',
  node_version: '22.23.2',
  tarball_sha256: 'bbe768df8d5815d7fa76124052985332452e0a4742d39f32027550d1aab8f6fb',
  shasums_sha256: '778ac5b2fcdbd68d9c0ae9f4310674faa3af0910bd0d18e7f6597787c40a3e39',
  signer_fingerprint: 'CC68F5A3106FF448322E48ED27F5E38D5B0A215F',
  zlib_version: '1.3.1',
  zlib_fixed: '1:1.3.dfsg+really1.3.1-1+toybaco1',
  libz_path: '/usr/lib/x86_64-linux-gnu/libz.so.1.3.1',
  libz_soname: 'libz.so.1',
  architecture: 'amd64',
});
const ELF_MACHINE_X86_64 = 62;
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function regularFile(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular file required: ${file}`);
  return fs.readFileSync(file);
}

function cString(bytes, offset) {
  const end = bytes.indexOf(0, offset);
  assert.ok(end >= offset, 'unterminated ELF string');
  return bytes.toString('latin1', offset, end);
}

// ELF64 little-endian reader over the section headers: header fields, the dynamic
// section (DT_NEEDED, DT_RPATH, DT_RUNPATH) and the dynamic symbol table names.
// Section headers are present in the built binary and in the usual native modules;
// a file without them yields empty lists, which the callers treat explicitly.
function readElf(bytes) {
  if (bytes.length < 64 || bytes.readUInt32BE(0) !== 0x7f454c46) return { elf: false };
  const elfClass = bytes[4];
  const data = bytes[5];
  if (elfClass !== 2 || data !== 1) return { elf: true, elf64le: false, elfClass, data };
  const machine = bytes.readUInt16LE(18);
  const shoff = Number(bytes.readBigUInt64LE(0x28));
  const shentsize = bytes.readUInt16LE(0x3a);
  const shnum = bytes.readUInt16LE(0x3c);
  const sections = [];
  for (let i = 0; i < shnum && shoff > 0; i += 1) {
    const at = shoff + i * shentsize;
    assert.ok(at + 64 <= bytes.length, 'truncated section header');
    sections.push({
      type: bytes.readUInt32LE(at + 4),
      offset: Number(bytes.readBigUInt64LE(at + 0x18)),
      size: Number(bytes.readBigUInt64LE(at + 0x20)),
      link: bytes.readUInt32LE(at + 0x28),
      entsize: Number(bytes.readBigUInt64LE(at + 0x38)),
    });
  }
  const needed = [];
  const rpath = [];
  const runpath = [];
  const dynsym = [];
  const imports = [];
  for (const section of sections) {
    if (section.type === 6) { // SHT_DYNAMIC
      const strtab = sections[section.link];
      for (let at = section.offset; at + 16 <= section.offset + section.size; at += 16) {
        const tag = bytes.readBigInt64LE(at);
        if (tag === 0n) break;
        const value = Number(bytes.readBigUInt64LE(at + 8));
        if (tag === 1n) needed.push(cString(bytes, strtab.offset + value));
        if (tag === 15n) rpath.push(cString(bytes, strtab.offset + value));
        if (tag === 29n) runpath.push(cString(bytes, strtab.offset + value));
      }
    }
    if (section.type === 11) { // SHT_DYNSYM
      const strtab = sections[section.link];
      const entsize = section.entsize || 24;
      for (let at = section.offset + entsize; at + entsize <= section.offset + section.size; at += entsize) {
        const name = bytes.readUInt32LE(at);
        if (name === 0) continue;
        const symbol = cString(bytes, strtab.offset + name);
        dynsym.push(symbol);
        if (bytes.readUInt16LE(at + 6) === 0) imports.push(symbol); // SHN_UNDEF
      }
    }
  }
  return { elf: true, elf64le: true, machine, sectionCount: sections.length, needed, rpath, runpath, dynsym, imports };
}

// What the verify mode requires of the Node binary's ELF.
function checkNodeElf(elf) {
  assert.ok(elf.elf && elf.elf64le, 'node is not an ELF64 little-endian file');
  assert.equal(elf.machine, ELF_MACHINE_X86_64, `node ELF machine is ${elf.machine}`);
  assert.ok(elf.sectionCount > 0 && elf.dynsym.length > 0, 'node has no readable dynamic symbol table');
  assert.ok(elf.needed.includes(EXPECTED.libz_soname), `node DT_NEEDED lacks ${EXPECTED.libz_soname}: ${elf.needed.join(',')}`);
  assert.deepEqual(elf.rpath, [], 'node carries DT_RPATH');
  assert.deepEqual(elf.runpath, [], 'node carries DT_RUNPATH');
  const gz = elf.dynsym.filter(name => name.startsWith('gz'));
  assert.deepEqual(gz, [], `node dynamic symbol table has gz* symbols: ${gz.slice(0, 8).join(',')}`);
  return { needed: elf.needed, gz_dynamic_symbols: 0, dynamic_symbols: elf.dynsym.length };
}

function validateStamp(stamp) {
  assert.equal(stamp.component, 'node');
  assert.equal(stamp.node_version, EXPECTED.node_version);
  assert.equal(stamp.architecture, EXPECTED.architecture);
  assert.equal(stamp.source.tarball_sha256, EXPECTED.tarball_sha256, 'stamp tarball hash');
  assert.equal(stamp.source.shasums_sha256, EXPECTED.shasums_sha256, 'stamp SHASUMS256.txt hash');
  assert.equal(stamp.source.signer_fingerprint, EXPECTED.signer_fingerprint, 'stamp signer');
  assert.equal(stamp.source.signature_valid, true, 'stamp signature');
  assert.equal(stamp.configure.node_shared_zlib, true, 'stamp configure --shared-zlib');
  assert.equal(stamp.elf.gz_dynamic_symbols, 0);
  assert.equal(stamp.elf.gz_implementation_symbols, 0);
  assert.equal(stamp.elf.v8_private_zlib_gz_symbols, 0);
  assert.ok(stamp.elf.needed.includes(EXPECTED.libz_soname), 'stamp DT_NEEDED');
  assert.equal(stamp.zlib_backport.installed_fixed, EXPECTED.zlib_fixed);
  assert.equal(stamp.runtime.libz_mapped, EXPECTED.libz_path);
  assert.equal(stamp.runtime.libz_matches_backport_deb, true);
  assert.ok(HEX64.test(stamp.runtime.libz_sha256), 'stamp libz hash');
  assert.equal(stamp.runtime.versions_zlib, EXPECTED.zlib_version);
  assert.equal(stamp.js_zlib_interop, 'PASS');
  const poc = stamp.gz_addon_poc;
  assert.ok(poc && poc.needed_libz === true, 'stamp gz addon PoC: addon needs libz.so.1');
  assert.ok(Number.isInteger(poc.gz_undefined_imports) && poc.gz_undefined_imports >= 4,
    'stamp gz addon PoC: undefined gz imports');
  assert.ok(Number.isInteger(poc.gz_bindings_to_libz) && poc.gz_bindings_to_libz >= 1,
    'stamp gz addon PoC: gz symbols bound to libz');
  assert.equal(poc.bound_elsewhere, 0, 'stamp gz addon PoC: a gz symbol bound outside libz');
  assert.equal(poc.zlib_version, EXPECTED.zlib_version, 'stamp gz addon PoC: zlib version');
  assert.equal(poc.store_mode, 'wb0', 'stamp gz addon PoC: store mode reaches the write failure');
  assert.equal(poc.direct_write_path, 'clean', 'stamp gz addon PoC: direct-write path');
  assert.equal(poc.gzwrite_return, 0, 'stamp gz addon PoC: gzwrite return on the forced failure');
  const ts = poc.two_sided;
  assert.ok(ts, 'stamp gz addon PoC: two-sided reproducer record');
  assert.equal(ts.patched_exit, 0, 'stamp two-sided: patched shared libz exits 0');
  assert.notEqual(ts.unpatched_exit, 0, 'stamp two-sided: unpatched shared libz must abort');
  assert.equal(ts.unpatched_asan_overflow, true, 'stamp two-sided: unpatched shows an ASan heap overflow');
  assert.ok(stamp.zlib_tests.total >= 50, 'stamp zlib test count');
  assert.equal(stamp.zlib_tests.regressions, 0, 'stamp zlib test regressions');
  assert.ok(HEX64.test(stamp.node_sha256), 'stamp node hash');
  assert.ok(HEX64.test(stamp.build_environment.installed_packages_sha256), 'stamp build environment');
  assert.ok(Number.isInteger(stamp.build_environment.snapshot_checked_packages)
    && stamp.build_environment.snapshot_checked_packages > 0, 'stamp: every apt package was checked against the snapshot');
  // The resource record behind make -j, and the native build order glibc -> node.
  const r = stamp.resources;
  assert.ok(r && Number.isInteger(r.jobs) && r.jobs >= 1, 'stamp resources: jobs');
  for (const bound of ['nproc', 'cpu_quota', 'jobs_by_memory', 'max_jobs']) {
    assert.ok(Number.isInteger(r[bound]) && r.jobs <= r[bound], `stamp resources: jobs exceeds ${bound}`);
  }
  assert.ok(Number.isInteger(r.mem_available_mib) && Number.isInteger(r.usable_mib), 'stamp resources: memory');
  assert.ok(r.usable_mib <= r.mem_available_mib, 'stamp resources: usable memory above MemAvailable');
  assert.equal(r.jobs_by_memory, Math.floor((r.usable_mib - r.reserve_mib) / r.per_job_mib), 'stamp resources: memory bound');
  assert.ok(Number.isInteger(r.disk_available_mib) && r.disk_available_mib >= r.min_disk_mib, 'stamp resources: disk');
  assert.ok(['pass', 'not_provided'].includes(r.deadline_check), 'stamp resources: deadline check');
  assert.equal(stamp.build.jobs, r.jobs, 'stamp build jobs');
  assert.equal(stamp.ordering && stamp.ordering.after, 'glibc-backport', 'stamp native build order');
  assert.ok(HEX64.test(stamp.ordering.glibc_build_stamp_sha256), 'stamp glibc build stamp hash');
}

function mappedLibz() {
  const seen = new Set();
  for (const line of fs.readFileSync('/proc/self/maps', 'utf8').split('\n')) {
    const file = line.trim().split(/\s+/)[5];
    if (file && /\/libz\.so/.test(file)) seen.add(fs.realpathSync(file));
  }
  return [...seen];
}

function dpkgVersion(pkg) {
  const result = spawnSync('dpkg-query', ['-W', '-f=${Version}', pkg], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `dpkg-query ${pkg} failed`);
  return result.stdout.trim();
}

function verify(stampPath) {
  const stamp = JSON.parse(regularFile(stampPath));
  validateStamp(stamp);
  assert.equal(process.execPath, EXPECTED.node_path, `running binary is ${process.execPath}`);
  const nodeBytes = regularFile(EXPECTED.node_path);
  assert.equal(sha256(nodeBytes), stamp.node_sha256, 'installed node differs from the built binary');
  assert.equal(process.versions.node, EXPECTED.node_version);
  assert.equal(process.versions.zlib, EXPECTED.zlib_version, 'process.versions.zlib');
  const elf = checkNodeElf(readElf(nodeBytes));
  const libz = mappedLibz();
  assert.deepEqual(libz, [EXPECTED.libz_path], `mapped libz: ${libz.join(',')}`);
  const libzSha = sha256(regularFile(EXPECTED.libz_path));
  assert.equal(libzSha, stamp.runtime.libz_sha256, 'mapped libz differs from the one the build linked and tested');
  const zlibVersion = dpkgVersion('zlib1g');
  assert.equal(zlibVersion, EXPECTED.zlib_fixed, `installed zlib1g is ${zlibVersion}`);
  return {
    result: 'PASS',
    node: { path: EXPECTED.node_path, version: process.versions.node, sha256: stamp.node_sha256,
      source_tarball_sha256: stamp.source.tarball_sha256, signer: stamp.source.signer_fingerprint },
    elf,
    zlib: { versions_zlib: process.versions.zlib, mapped: libz[0], sha256: libzSha, zlib1g: zlibVersion },
    build: { zlib_tests: stamp.zlib_tests, seconds: stamp.build.seconds, jobs: stamp.build.jobs },
    resources: stamp.resources,
    ordering: stamp.ordering,
    gz_addon_poc: stamp.gz_addon_poc,
  };
}

function findNativeModules(root) {
  const found = [];
  const stack = [path.join(root, 'node_modules')];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(file);
      else if (entry.isFile() && entry.name.endsWith('.node')) found.push(file);
    }
  }
  return found.sort();
}

function classify(file) {
  let elf;
  try {
    elf = readElf(fs.readFileSync(file));
  } catch (error) {
    return { kind: 'unreadable', reason: error.message };
  }
  if (!elf.elf) return { kind: 'other_platform', reason: 'not ELF' };
  if (!elf.elf64le) return { kind: 'other_platform', reason: `ELF class ${elf.elfClass} data ${elf.data}` };
  if (elf.machine !== ELF_MACHINE_X86_64) return { kind: 'other_platform', reason: `ELF machine ${elf.machine}` };
  if (elf.needed.some(name => name.startsWith('libc.musl-'))) return { kind: 'other_platform', reason: 'musl' };
  const ldd = spawnSync('ldd', [file], { encoding: 'utf8', timeout: 60000 });
  const missing = `${ldd.stdout || ''}`.split('\n')
    .map(line => /^\s*(\S+) => not found/.exec(line)).filter(Boolean).map(match => match[1]);
  assert.ok(!missing.includes(EXPECTED.libz_soname), `${file} cannot resolve ${EXPECTED.libz_soname}`);
  // Static only: which modules import gz* (resolved through libz.so.1, as Node exports none).
  const gzImports = elf.imports.filter(name => name.startsWith('gz'));
  if (missing.length > 0) return { kind: 'unresolvable', reason: `not found: ${missing.join(',')}`, gz_imports: gzImports };
  return { kind: 'candidate', needs_libz: elf.needed.includes(EXPECTED.libz_soname), gz_imports: gzImports };
}

function load(nodeBinary, file) {
  const result = spawnSync(nodeBinary, ['-e', 'process.dlopen({ exports: {} }, process.argv[1])', file],
    { encoding: 'utf8', timeout: 60000 });
  return { ok: result.status === 0, status: result.status, error: (result.stderr || '').trim().split('\n')[0] || '' };
}

function nativeModules(root, reference) {
  const modules = findNativeModules(root);
  const rows = [];
  for (const file of modules) {
    const relative = path.relative(root, file);
    const row = { module: relative, ...classify(file) };
    if (row.kind === 'candidate') {
      row.load = load(process.execPath, file);
      if (reference) row.reference = load(reference, file);
    }
    rows.push(row);
  }
  const candidates = rows.filter(row => row.kind === 'candidate');
  const failed = candidates.filter(row => !row.load.ok);
  const mismatched = reference ? candidates.filter(row => row.load.ok !== row.reference.ok) : [];
  const prisma = candidates.filter(row => /libquery_engine-[^/]+\.so\.node$/.test(row.module) && row.load.ok);
  const summary = {
    result: failed.length === 0 && mismatched.length === 0 && prisma.length > 0 ? 'PASS' : 'FAIL',
    node: process.execPath,
    reference: reference || null,
    total: rows.length,
    loaded: candidates.length - failed.length,
    failed: failed.length,
    reference_mismatch: mismatched.length,
    unresolvable: rows.filter(row => row.kind === 'unresolvable').length,
    other_platform: rows.filter(row => row.kind === 'other_platform').length,
    unreadable: rows.filter(row => row.kind === 'unreadable').length,
    prisma_engines_loaded: prisma.map(row => row.module),
    gz_importing_modules: rows.filter(row => (row.gz_imports || []).length > 0)
      .map(row => ({ module: row.module, gz_imports: row.gz_imports, needs_libz: row.needs_libz ?? null })),
    rows,
  };
  return summary;
}

function parseCli(args) {
  if (args[0] === 'verify' && args.length === 2) return { mode: 'verify', stamp: args[1] };
  if (args[0] === 'native-modules' && args.length === 2) return { mode: 'native-modules', root: args[1], reference: null };
  if (args[0] === 'native-modules' && args.length === 4 && args[2] === '--reference') {
    return { mode: 'native-modules', root: args[1], reference: args[3] };
  }
  throw new Error('usage: verify-node-shared-zlib.cjs [verify <build-stamp.json> | native-modules <app-root> [--reference <node>]]');
}

module.exports = { EXPECTED, readElf, checkNodeElf, validateStamp, findNativeModules, parseCli };

if (require.main === module) {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(64);
  }
  try {
    if (cli.mode === 'verify') {
      const proof = verify(cli.stamp);
      process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
      console.error(`TOYBACO_POSTIZ_NODE_SHARED_ZLIB=PASS node=${proof.node.version} sha256=${proof.node.sha256}`
        + ` needed_libz=true gz_dynamic=0 libz=${proof.zlib.mapped} zlib1g=${proof.zlib.zlib1g}`
        + ` versions.zlib=${proof.zlib.versions_zlib} build_seconds=${proof.build.seconds} jobs=${proof.build.jobs}`
        + ` (nproc=${proof.resources.nproc} cpu_quota=${proof.resources.cpu_quota} usable_mib=${proof.resources.usable_mib}`
        + ` jobs_by_memory=${proof.resources.jobs_by_memory} disk_mib=${proof.resources.disk_available_mib}`
        + ` deadline_check=${proof.resources.deadline_check}) after=${proof.ordering.after}`
        + ` gz_addon_poc=${proof.gz_addon_poc.direct_write_path}/${proof.gz_addon_poc.gz_bindings_to_libz}`
        + ` two_sided=patched${proof.gz_addon_poc.two_sided.patched_exit}/unpatched${proof.gz_addon_poc.two_sided.unpatched_exit}`);
    } else {
      const summary = nativeModules(cli.root, cli.reference);
      for (const row of summary.rows) {
        const outcome = row.kind === 'candidate'
          ? `load=${row.load.ok ? 'ok' : 'FAIL'}${row.reference ? ` reference=${row.reference.ok ? 'ok' : 'FAIL'}` : ''}`
            + `${row.load.ok ? '' : ` error=${row.load.error}`}`
          : `${row.kind} (${row.reason})`;
        const gz = (row.gz_imports || []).length > 0 ? ` gz_imports=${row.gz_imports.join(',')}` : '';
        console.error(`NODE_NATIVE_MODULE ${row.module} ${outcome}${gz}`);
      }
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      console.error(`TOYBACO_POSTIZ_NODE_NATIVE_MODULES=${summary.result} total=${summary.total} loaded=${summary.loaded}`
        + ` failed=${summary.failed} reference_mismatch=${summary.reference_mismatch}`
        + ` unresolvable=${summary.unresolvable} other_platform=${summary.other_platform} unreadable=${summary.unreadable}`
        + ` prisma_engines=${summary.prisma_engines_loaded.length} gz_importing=${summary.gz_importing_modules.length}`);
      if (summary.result !== 'PASS') process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Node shared-zlib runtime verification rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
