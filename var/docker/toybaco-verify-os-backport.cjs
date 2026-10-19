'use strict';
// Runtime installer and verifier for the OS source backports in the Postiz runtime
// image (zlib1g and glibc). It never runs or suppresses a scanner. Driven by
// config/postiz-os-backport.json, so each package is defined in one place.
//
//   --install <build-out-dir> <backport-config.json>
//     Root-only, during the image build. Reads the builder stage's build-stamp.json
//     in <build-out-dir>, matches it to a package entry in the config, requires the
//     base image's binaries to be the exact reviewed prior version (a different
//     base, for example a Debian fix, fails closed and needs a new review), checks
//     the .deb bytes against the stamp, installs the rebuilt +toybaco1 package(s)
//     with dpkg, saves the stamp under STAMP_DIR, and for glibc runs the runtime
//     smoke against the installed libc and records the result.
//
//   verify <backport-config.json>
//     Verifies every configured backport is installed at its +toybaco1 version with
//     the ABI unchanged (the real ELF DT_SONAME and machine of the shared object,
//     in the package's own layout), reads each saved stamp and runtime record, and
//     prints the combined installed-source proof (JSON on stdout) consumed by
//     verify-postiz-os-backport-classification.mjs. The TOYBACO_POSTIZ_OS_BACKPORT=
//     summary goes to stderr.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const POLICY = 'toybaco-postiz-os-source-backport-v1';
const STAMP_DIR = '/usr/local/share/toybaco/os-backport';
const stampPathFor = sourcePackage => path.join(STAMP_DIR, `${sourcePackage}-build-stamp.json`);
const runtimeRecordPathFor = sourcePackage => path.join(STAMP_DIR, `${sourcePackage}-runtime-smoke.json`);
// ELF e_machine per Debian architecture.
const ELF_MACHINE = Object.freeze({ amd64: 62, arm64: 183 });
const SMOKE_OUTPUT = /^glibc-smoke OK strfmon=\d+ getaddrinfo=0\n?$/;
const HEX64 = /^[0-9a-f]{64}$/;
// Debian glibc's biarch packages, which a nobiarch build must not produce.
const BIARCH_PACKAGE = /^(?:libc6-(?:dev-)?(?:i386|x32|amd64)|lib32.*|libx32.*|lib64.*)$/;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${binary} ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  return result.stdout;
}
const dpkgField = (pkg, field) => run('dpkg-query', ['-W', `-f=\${${field}}`, pkg]).trim();

function regularFile(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular file required: ${file}`);
  return fs.readFileSync(file);
}

// Minimal ELF64 little-endian reader: machine and DT_SONAME, found through the
// program headers (PT_DYNAMIC and the PT_LOAD mapping of DT_STRTAB), so it does not
// depend on section headers or on binutils being present in the runtime image.
function readElf(bytes) {
  assert.ok(bytes.length >= 64 && bytes.readUInt32BE(0) === 0x7f454c46, 'not an ELF file');
  assert.equal(bytes[4], 2, 'only ELF64 is supported');
  assert.equal(bytes[5], 1, 'only little-endian ELF is supported');
  const machine = bytes.readUInt16LE(18);
  const phoff = Number(bytes.readBigUInt64LE(0x20));
  const phentsize = bytes.readUInt16LE(0x36);
  const phnum = bytes.readUInt16LE(0x38);
  const loads = [];
  let dynamic = null;
  for (let i = 0; i < phnum; i += 1) {
    const at = phoff + i * phentsize;
    assert.ok(at + 56 <= bytes.length, 'truncated program header');
    const type = bytes.readUInt32LE(at);
    const offset = Number(bytes.readBigUInt64LE(at + 8));
    const vaddr = Number(bytes.readBigUInt64LE(at + 0x10));
    const filesz = Number(bytes.readBigUInt64LE(at + 0x20));
    if (type === 1) loads.push({ offset, vaddr, filesz });
    if (type === 2) dynamic = { offset, filesz };
  }
  if (!dynamic) return { machine, soname: null };
  const toOffset = vaddr => {
    const seg = loads.find(s => vaddr >= s.vaddr && vaddr < s.vaddr + s.filesz);
    assert.ok(seg, 'DT_STRTAB is not mapped by a PT_LOAD segment');
    return seg.offset + (vaddr - seg.vaddr);
  };
  let strtab = null;
  let sonameOffset = null;
  for (let at = dynamic.offset; at + 16 <= dynamic.offset + dynamic.filesz; at += 16) {
    const tag = bytes.readBigInt64LE(at);
    const value = Number(bytes.readBigUInt64LE(at + 8));
    if (tag === 0n) break;
    if (tag === 5n) strtab = value; // DT_STRTAB
    if (tag === 14n) sonameOffset = value; // DT_SONAME
  }
  if (strtab === null || sonameOffset === null) return { machine, soname: null };
  const start = toOffset(strtab) + sonameOffset;
  const end = bytes.indexOf(0, start);
  assert.ok(end > start, 'DT_SONAME string is not terminated');
  return { machine, soname: bytes.toString('latin1', start, end) };
}

// dpkg path-exclude/path-include filters in configuration order (dpkg.cfg, then
// dpkg.cfg.d in lexical order); the last matching filter decides. Patterns are
// fnmatch(3) globs without FNM_PATHNAME, so '*' also matches '/'.
function dpkgPathFilters(configRoot = '/etc/dpkg') {
  const files = [path.join(configRoot, 'dpkg.cfg')];
  try {
    for (const name of fs.readdirSync(path.join(configRoot, 'dpkg.cfg.d')).sort()) {
      files.push(path.join(configRoot, 'dpkg.cfg.d', name));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const filters = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const line of text.split('\n')) {
      const match = /^\s*path-(exclude|include)(?:\s*=\s*|\s+)(\S+)\s*$/.exec(line);
      if (match) filters.push({ include: match[1] === 'include', pattern: globPattern(match[2]) });
    }
  }
  return filters;
}

function globPattern(glob) {
  let source = '';
  for (const character of glob) {
    if (character === '*') source += '.*';
    else if (character === '?') source += '.';
    else source += character.replace(/[\\^$.+()|{}[\]]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function excludedByDpkg(file, filters) {
  let excluded = false;
  for (const filter of filters) if (filter.pattern.test(file)) excluded = !filter.include;
  return excluded;
}

function validateConfig(configBytes) {
  const config = JSON.parse(configBytes);
  assert.equal(config.policy, POLICY, 'unexpected backport policy');
  assert.ok(Array.isArray(config.packages) && config.packages.length >= 1, 'config has no packages');
  for (const pkg of config.packages) {
    assert.ok(pkg.source_package && Array.isArray(pkg.binary_packages) && pkg.binary_packages.length >= 1,
      'package entry must name a source and binary packages');
    assert.ok(pkg.installed_prior && pkg.installed_fixed && pkg.installed_prior !== pkg.installed_fixed,
      'package entry must have distinct prior/fixed versions');
    assert.ok(typeof pkg.soname === 'string' && pkg.soname.length > 0, 'package entry must name a soname');
    assert.ok(['symlink', 'file'].includes(pkg.soname_layout), 'package entry must name its soname layout');
    if (pkg.soname_layout === 'symlink') assert.ok(pkg.sofile, 'a symlink layout names the versioned object file');
  }
  return config;
}
const packageBySource = (config, sourcePackage) => {
  const pkg = config.packages.find(p => p.source_package === sourcePackage);
  assert.ok(pkg, `config has no package ${sourcePackage}`);
  return pkg;
};

// zlib stamps carry {deb, deb_sha256}; multi-binary stamps carry {debs:{name:{file,sha256}}}.
function stampDebs(stamp) {
  if (stamp.debs) return stamp.debs;
  return { zlib1g: { file: stamp.deb, sha256: stamp.deb_sha256 } };
}

// The build stage's record. Common fields plus package-specific evidence.
function validateStamp(stamp, pkg) {
  assert.equal(stamp.source_package || 'zlib', pkg.source_package, 'stamp source package differs from the config');
  assert.equal(stamp.installed_fixed, pkg.installed_fixed, 'stamp version differs from the config');
  assert.match(stamp.architecture, /^[a-z0-9-]+$/);
  const debs = stampDebs(stamp);
  for (const name of pkg.binary_packages) {
    const entry = debs[name];
    assert.ok(entry && entry.file && HEX64.test(entry.sha256), `stamp lacks a .deb for ${name}`);
    const epochless = pkg.installed_fixed.replace(/^\d+:/, '');
    assert.equal(entry.file, `${name}_${epochless}_${stamp.architecture}.deb`, `stamp .deb name for ${name}`);
  }
  if (pkg.source_package === 'zlib') {
    assert.equal(stamp.patched_marker_present, true);
    assert.notEqual(stamp.reproducer.unpatched_exit, 0);
    assert.equal(stamp.reproducer.patched_exit, 0);
    assert.equal(stamp.reproducer.asan_overflow_before, true);
    assert.equal(stamp.reproducer.asan_clean_after, true);
  } else if (pkg.source_package === 'glibc') {
    assert.equal(stamp.strfmon_regression_test, 'PASS', 'strfmon regression test must pass in the build');
    assert.equal(stamp.smoke_compiles, true, 'the runtime smoke must have been compiled and linked');
    assert.ok(stamp.smoke && stamp.smoke.file === 'glibc-smoke' && HEX64.test(stamp.smoke.sha256),
      'stamp must carry the linked runtime smoke');
    assert.equal(stamp.series_sha256, pkg.series_sha256, 'patch series bytes differ from the config');
    assert.deepEqual(stamp.applied_series, pkg.patch_series, 'quilt applied series differs from the config');
    assert.deepEqual(stamp.patch_commits, pkg.patch_commits, 'patch From: commits differ from the config');
    for (const c of pkg.cves) {
      assert.equal(stamp.upstream_fix_commits[c.cve], c.upstream_fix_commit, `${c.cve} fix commit`);
    }
    for (const [file, hashes] of Object.entries(pkg.patched_files)) {
      assert.equal(stamp.patched_files[file].preimage_sha256, hashes.preimage_sha256, `stamp preimage ${file}`);
      assert.equal(stamp.patched_files[file].postimage_sha256, hashes.postimage_sha256, `stamp postimage ${file}`);
      assert.notEqual(hashes.preimage_sha256, hashes.postimage_sha256, `backport must change ${file}`);
    }
    assert.equal(stamp.elf.soname, pkg.soname, 'built shared object SONAME');
    assert.equal(stamp.elf.machine, ELF_MACHINE[stamp.architecture], 'built shared object machine');
    const env = stamp.build_environment;
    assert.ok(env && env.apt_snapshot === pkg.build_apt_snapshot, 'build used the pinned apt snapshot');
    assert.ok(HEX64.test(env.installed_packages_sha256) && env.installed_package_count > 0,
      'build environment package list recorded');
    assert.ok(Number.isInteger(env.snapshot_checked_packages) && env.snapshot_checked_packages > 0,
      'every package apt installed was checked against the snapshot index');
    assert.ok(Array.isArray(stamp.built_packages) && pkg.binary_packages.every(name => stamp.built_packages.includes(name)),
      'the build lists the packages it produced');
    assert.ok(!stamp.built_packages.some(name => BIARCH_PACKAGE.test(name)), 'no biarch package was built (nobiarch)');
    if (pkg.build_environment_sha256 !== null) {
      assert.equal(env.installed_packages_sha256, pkg.build_environment_sha256,
        'build environment differs from the reviewed one');
    }
  }
}

// The soname of the installed package in its own layout: a symlink to the
// versioned object file (zlib) or the shared object itself (glibc since 2.34).
// The real ELF must carry DT_SONAME == soname and the architecture's machine.
function verifyLibrary(pkg, files, architecture, root = '/') {
  const at = file => path.join(root, file);
  const candidates = files.filter(file => path.basename(file) === pkg.soname);
  assert.equal(candidates.length, 1, `${pkg.source_package} must ship exactly one ${pkg.soname}`);
  const sonamePath = candidates[0];
  const stat = fs.lstatSync(at(sonamePath));
  let objectPath;
  if (pkg.soname_layout === 'symlink') {
    assert.ok(stat.isSymbolicLink(), `${sonamePath} must be a symlink`);
    const target = fs.readlinkSync(at(sonamePath));
    assert.equal(target, pkg.sofile, `${pkg.soname} resolves to unexpected ${target}`);
    objectPath = path.join(path.dirname(sonamePath), target);
    assert.ok(files.includes(objectPath), `${pkg.source_package} must ship ${objectPath}`);
  } else {
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${sonamePath} must be a regular file`);
    objectPath = sonamePath;
  }
  const elf = readElf(regularFile(at(objectPath)));
  assert.equal(elf.soname, pkg.soname, `${objectPath} DT_SONAME is ${elf.soname}`);
  assert.equal(elf.machine, ELF_MACHINE[architecture], `${objectPath} ELF machine is ${elf.machine}`);
  return { soname: pkg.soname, object: path.basename(objectPath), elf_soname: elf.soname,
    elf_machine: elf.machine, soname_unchanged: true };
}

function verifyInstalled(pkg, architecture) {
  const binaries = {};
  const filters = dpkgPathFilters();
  for (const name of pkg.binary_packages) {
    const version = dpkgField(name, 'Version');
    const status = dpkgField(name, 'Status');
    const arch = dpkgField(name, 'Architecture');
    assert.equal(version, pkg.installed_fixed, `installed ${name} is not the backport: ${version}`);
    assert.equal(status, 'install ok installed', `installed ${name} status: ${status}`);
    assert.equal(arch, architecture, `installed ${name} architecture ${arch}`);
    const verified = spawnSync('dpkg', ['--verify', name], { encoding: 'utf8', timeout: 120000 });
    assert.equal(verified.status, 0, `dpkg --verify ${name} failed`);
    const unexpected = verified.stdout.split('\n').filter(Boolean).filter(line => {
      const missing = /^missing\s+(?:c\s+)?(\/\S+)$/.exec(line);
      return !(missing && excludedByDpkg(missing[1], filters));
    });
    assert.equal(unexpected.length, 0, `dpkg --verify ${name} reported changes: ${unexpected.join('; ')}`);
    binaries[name] = { version, status, architecture: arch };
  }
  const files = run('dpkg-query', ['-L', ...pkg.binary_packages]).split('\n').map(s => s.trim()).filter(Boolean);
  return { binaries, abi: verifyLibrary(pkg, files, architecture) };
}

// glibc only: run the linked smoke against the installed libc, plus ldd --version
// and a Node dns.lookup through getaddrinfo, and record the result.
function runtimeSmoke(outDir, stamp) {
  const smoke = path.join(outDir, stamp.smoke.file);
  const bytes = regularFile(smoke);
  assert.equal(sha256(bytes), stamp.smoke.sha256, 'runtime smoke binary differs from the stamp');
  const result = spawnSync(smoke, [], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `runtime smoke failed: ${(result.stderr || '').trim()}`);
  assert.match(result.stdout, SMOKE_OUTPUT, 'runtime smoke output');
  const ldd = run('ldd', ['--version']).split('\n')[0].trim();
  assert.match(ldd, /\b2\.41\b/, `ldd --version reports ${ldd}`);
  const lookup = spawnSync(process.execPath, ['-e',
    "require('node:dns').lookup('localhost',{family:4},(e,a)=>{if(e){console.error(e.code);process.exit(2)}console.log(a)})"],
  { encoding: 'utf8', timeout: 30000 });
  assert.equal(lookup.status, 0, `node dns.lookup failed: ${(lookup.stderr || '').trim()}`);
  return { smoke_binary_sha256: stamp.smoke.sha256, smoke_exit: result.status,
    smoke_stdout: result.stdout.trim(), ldd_version: ldd, node_dns_lookup: lookup.stdout.trim() };
}

function packageProof(pkg) {
  const stamp = JSON.parse(regularFile(stampPathFor(pkg.source_package)));
  validateStamp(stamp, pkg);
  const installed = verifyInstalled(pkg, stamp.architecture);
  const proof = {
    source_package: pkg.source_package,
    cves: pkg.cves.map(c => c.cve),
    installed_fixed: pkg.installed_fixed,
    architecture: stamp.architecture,
    abi: installed.abi,
    binaries: installed.binaries,
    debs: stampDebs(stamp),
  };
  if (pkg.source_package === 'zlib') {
    proof.reproducer = {
      unpatched_exit: stamp.reproducer.unpatched_exit, patched_exit: stamp.reproducer.patched_exit,
      asan_overflow_before: stamp.reproducer.asan_overflow_before, asan_clean_after: stamp.reproducer.asan_clean_after,
    };
    proof.patched_marker_present = true;
  } else if (pkg.source_package === 'glibc') {
    proof.strfmon_regression_test = stamp.strfmon_regression_test;
    proof.smoke_compiles = stamp.smoke_compiles;
    proof.patched_files = stamp.patched_files;
    proof.build_environment = stamp.build_environment;
    proof.runtime_smoke = JSON.parse(regularFile(runtimeRecordPathFor(pkg.source_package)));
    assert.equal(proof.runtime_smoke.smoke_binary_sha256, stamp.smoke.sha256, 'runtime smoke record binary');
  }
  return proof;
}

function verify(configPath) {
  const configBytes = regularFile(configPath);
  const config = validateConfig(configBytes);
  return {
    schema_version: 2,
    result: 'PASS',
    policy: POLICY,
    patch_config_sha256: sha256(configBytes),
    public_revision: process.env.TOYBACO_SOURCE_COMMIT || '',
    packages: config.packages.map(packageProof),
  };
}

function summary(proof) {
  return proof.packages.map(p =>
    `TOYBACO_POSTIZ_OS_BACKPORT=PASS ${p.source_package} ${Object.keys(p.binaries).map(n => `${n}=${p.binaries[n].version}`).join(' ')}`
    + ` soname=${p.abi.soname} elf_soname=${p.abi.elf_soname} arch=${p.architecture}`).join('\n');
}

function install(outDir, configPath) {
  assert.equal(process.getuid(), 0, '--install must run as root during the image build');
  const config = validateConfig(regularFile(configPath));
  const stampBytes = regularFile(path.join(outDir, 'build-stamp.json'));
  const stamp = JSON.parse(stampBytes);
  const pkg = packageBySource(config, stamp.source_package || 'zlib');
  validateStamp(stamp, pkg);
  // Fail closed when the base no longer carries the reviewed vulnerable version.
  for (const name of pkg.binary_packages) {
    const prior = dpkgField(name, 'Version');
    assert.equal(prior, pkg.installed_prior,
      `base ${name} is ${prior}, not the reviewed ${pkg.installed_prior}; review the backport before rebuilding`);
  }
  const debs = stampDebs(stamp);
  const debPaths = [];
  for (const name of pkg.binary_packages) {
    const deb = path.join(outDir, debs[name].file);
    assert.equal(sha256(regularFile(deb)), debs[name].sha256, `rebuilt ${name} .deb bytes differ from the stamp`);
    assert.equal(run('dpkg-deb', ['-f', deb, 'Package']).trim(), name);
    assert.equal(run('dpkg-deb', ['-f', deb, 'Version']).trim(), pkg.installed_fixed);
    debPaths.push(deb);
  }
  run('dpkg', ['-i', ...debPaths]);
  fs.mkdirSync(STAMP_DIR, { recursive: true, mode: 0o755 });
  const saved = stampPathFor(pkg.source_package);
  fs.writeFileSync(saved, stampBytes, { mode: 0o444 });
  fs.chmodSync(saved, 0o444);
  if (pkg.source_package === 'glibc') {
    const record = runtimeSmoke(outDir, stamp);
    const recordPath = runtimeRecordPathFor(pkg.source_package);
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', { mode: 0o444 });
    fs.chmodSync(recordPath, 0o444);
  }
  return packageProof(pkg);
}

// The accepted command lines. Exported so contract tests can check generated
// invocations (Dockerfile, publisher workflow) against the real parser.
function parseCli(args) {
  if (args[0] === '--install' && args.length === 3) return { mode: 'install', outDir: args[1], config: args[2] };
  if (args[0] === 'verify' && args.length === 2) return { mode: 'verify', config: args[1] };
  throw new Error('usage: verify-os-backport.cjs [--install <build-out-dir> <config.json> | verify <config.json>]');
}

module.exports = { POLICY, STAMP_DIR, ELF_MACHINE, stampPathFor, runtimeRecordPathFor, validateConfig,
  validateStamp, verifyLibrary, readElf, dpkgPathFilters, excludedByDpkg, parseCli };

if (require.main === module) {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(64);
  }
  try {
    if (cli.mode === 'install') {
      console.error(summary({ packages: [install(cli.outDir, cli.config)] }));
    } else {
      const proof = verify(cli.config);
      process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
      console.error(summary(proof));
    }
  } catch (error) {
    console.error(`OS backport runtime verification rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
