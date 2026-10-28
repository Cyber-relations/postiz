#!/usr/bin/env node
// Pure OS classification of the raw Critical/High scan of the Postiz runtime
// image. It does NOT replace, filter or suppress Trivy: it reads the raw report of
// a run with fixed and unfixed findings included, lists every Critical/High row
// and decides PASS/FAIL from them.
//
// Each row gets exactly one disposition:
//   backported           a reviewed CVE on a reviewed binary package at the
//                        verified +toybaco1 source backport (zlib1g for
//                        CVE-2026-85091; libc6 / libc-bin for CVE-2026-5435 and
//                        CVE-2026-19499). The code is fixed; the version-based
//                        finding stays because Debian trixie has no fixed version.
//   fixed_unapplied      the scanner names a fixed version that the image lacks
//                        (any package; FAIL, the same meaning as the push gate).
//   reviewed_unexpected  any other row on a reviewed package (zlib1g, libc6,
//                        libc-bin): FAIL until reviewed.
//   unreviewed_unfixed   an unfixed row on a package nobody has reviewed yet:
//                        counted and listed; FAIL only when STRICT_UNREVIEWED.
//
// The backport set is pinned in code (BACKPORTS); widening it needs a review here,
// not only in the config. The pinned push-gate Trivy (--ignore-unfixed=true) is a
// separate step and is not changed by this classification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const IMAGE = '951034765053.dkr.ecr.ap-northeast-1.amazonaws.com/toybaco/postiz';
export const DEBIAN_FAMILY = 'debian';
export const DEBIAN_RELEASE = /^13\.\d+$/;
export const POLICY = 'toybaco-postiz-os-source-backport-v1';
// The reviewed source backports, pinned in code. Each names the source package, the
// binary packages whose rows are backported, the CVEs, and the fixed upstream
// commit per CVE. Adding or widening one requires a review here and in the config.
export const BACKPORTS = Object.freeze({
  zlib: Object.freeze({
    binary_packages: Object.freeze(['zlib1g']),
    installed_fixed: '1:1.3.dfsg+really1.3.1-1+toybaco1',
    soname: 'libz.so.1',
    soname_layout: 'symlink',
    cves: Object.freeze({ 'CVE-2026-85091': 'df84af25dc1942490e1d1c899a07619152a46148' }),
  }),
  glibc: Object.freeze({
    binary_packages: Object.freeze(['libc6', 'libc-bin']),
    installed_fixed: '2.41-12+deb13u4+toybaco1',
    soname: 'libc.so.6',
    soname_layout: 'file',
    cves: Object.freeze({
      'CVE-2026-5435': '0e8c56b386d72ba2ddf15784423f2e894c63a241',
      'CVE-2026-19499': '5256941bc811248670eda4636dccd0a390d34dec',
    }),
  }),
});
// The exact raw scan: fixed+unfixed, Critical/High, OS and language packages, full
// inventory, the database the push gate just downloaded, JSON to the evidence dir.
export const SCANNER_ARGS = Object.freeze([
  'image', '--scanners', 'vuln', '--pkg-types', 'os,library', '--severity', 'CRITICAL,HIGH',
  '--ignore-unfixed=false', '--list-all-pkgs', '--exit-code', '1', '--no-progress',
  '--skip-db-update', '--format', 'json', '--output', '/evidence/raw-report.json',
]);
const SEVERITIES = ['CRITICAL', 'HIGH'];
// ELF e_machine for the published architecture.
const ELF_MACHINE = Object.freeze({ amd64: 62, arm64: 183 });
const SMOKE_OUTPUT = /^glibc-smoke OK strfmon=\d+ getaddrinfo=0$/;
// Unfixed rows on packages nobody has reviewed are counted but do not fail the
// publisher yet. Switch to true (a reviewed code change, no environment flag) after
// the reachability review of the 9 open advisories (45 rows measured on 2026-10-15)
// and their deferral entries; see docs/postiz-os-backport-policy.md.
export const STRICT_UNREVIEWED = false;

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
const equal = (a, b, label) => assert.equal(canonical(a), canonical(b), label);
const hash = value => { assert.match(value, /^[0-9a-f]{64}$/); return value; };
const array = value => { assert.ok(Array.isArray(value)); return value; };
const one = (values, label) => { assert.equal(values.length, 1, label); return values[0]; };
const noFix = finding => finding.FixedVersion === undefined || finding.FixedVersion === '';
const fixAvailable = finding => Boolean(finding.FixedVersion) || finding.Status === 'fixed';
// Trivy inventories Debian packages as separate Epoch / Version / Release fields
// while vulnerability rows carry the full epoch:version-release string.
const debianVersion = pkg => `${pkg.Epoch ? `${pkg.Epoch}:` : ''}${pkg.Version}${pkg.Release ? `-${pkg.Release}` : ''}`;

export const reviewedPackages = () => new Set(Object.values(BACKPORTS).flatMap(b => b.binary_packages));
// (cve, binaryPackage) -> the backport source entry that covers it, or undefined.
export function backportFor(cve, binaryPackage) {
  for (const [source, b] of Object.entries(BACKPORTS)) {
    if (b.cves[cve] && b.binary_packages.includes(binaryPackage)) return { source, ...b };
  }
  return undefined;
}

// Config must match the pinned backport set exactly.
export function validateConfig(config) {
  assert.equal(config.schema_version, 2);
  assert.equal(config.policy, POLICY);
  assert.equal(config.image, IMAGE);
  assert.equal(config.runtime_base.debian_release, 'trixie');
  assert.equal(config.runtime_base.architecture, 'amd64');
  assert.deepEqual(array(config.deferred_findings), [], 'glibc is backported, not deferred; no deferrals remain');
  const sources = config.packages.map(p => p.source_package);
  equal([...sources].sort(), Object.keys(BACKPORTS).sort(), 'config packages match the pinned backport set');
  for (const pkg of config.packages) {
    const b = BACKPORTS[pkg.source_package];
    assert.ok(b, `unreviewed source package ${pkg.source_package}`);
    equal([...pkg.binary_packages].sort(), [...b.binary_packages].sort(), `${pkg.source_package} binary packages`);
    assert.equal(pkg.installed_fixed, b.installed_fixed, `${pkg.source_package} fixed version`);
    assert.notEqual(pkg.installed_prior, pkg.installed_fixed);
    assert.equal(pkg.debian_fixed_version, null, `${pkg.source_package} has no Debian fixed version`);
    assert.equal(pkg.scanner_remains_unfixed, true);
    assert.equal(pkg.soname, b.soname);
    assert.equal(pkg.soname_layout, b.soname_layout, `${pkg.source_package} soname layout`);
    if (pkg.source_package === 'glibc') {
      assert.match(pkg.build_apt_snapshot, /^\d{8}T\d{6}Z$/, 'glibc build pins an apt snapshot');
      assert.ok(pkg.build_environment_sha256 === null || /^[0-9a-f]{64}$/.test(pkg.build_environment_sha256));
      hash(pkg.series_sha256);
      equal(pkg.patch_commits.slice(-2), [b.cves['CVE-2026-5435'], b.cves['CVE-2026-19499']],
        'glibc series ends with the two fix commits');
    }
    const cves = pkg.cves.map(c => c.cve);
    equal([...cves].sort(), Object.keys(b.cves).sort(), `${pkg.source_package} CVEs`);
    for (const c of pkg.cves) assert.equal(c.upstream_fix_commit, b.cves[c.cve], `${c.cve} fix commit`);
    for (const [file, h] of Object.entries(pkg.patched_files || {})) {
      assert.notEqual(hash(h.preimage_sha256), hash(h.postimage_sha256), `${file} must change`);
    }
    for (const key of ['dsc_sha256', 'orig_tarball_sha256', 'debian_tarball_sha256']) hash(pkg.debian_source[key]);
  }
  return config;
}

// The in-image proof printed by postiz/runtime/verify-os-backport.cjs: every
// configured backport installed at +toybaco1 with the ABI unchanged, plus the
// package-specific evidence (zlib reproducer; glibc strfmon regression test).
export function validateProof(proof, config, configSha, context) {
  assert.equal(proof.schema_version, 2);
  assert.equal(proof.result, 'PASS');
  assert.equal(proof.policy, POLICY);
  assert.equal(proof.patch_config_sha256, hash(configSha), 'in-image config must be the checked-out config');
  assert.equal(proof.public_revision, context.source_commit);
  equal(proof.packages.map(p => p.source_package).sort(), Object.keys(BACKPORTS).sort(),
    'proof covers every configured backport');
  for (const p of proof.packages) {
    const b = BACKPORTS[p.source_package];
    assert.ok(b, `proof names unreviewed source ${p.source_package}`);
    assert.equal(p.installed_fixed, b.installed_fixed);
    equal(p.cves.slice().sort(), Object.keys(b.cves).sort(), `${p.source_package} proof CVEs`);
    assert.equal(p.abi.soname, b.soname);
    assert.equal(p.abi.soname_unchanged, true, `${p.source_package} ABI must be unchanged`);
    assert.equal(p.abi.elf_soname, b.soname, `${p.source_package} ELF DT_SONAME must be ${b.soname}`);
    assert.equal(p.abi.elf_machine, ELF_MACHINE[config.runtime_base.architecture],
      `${p.source_package} ELF machine must match ${config.runtime_base.architecture}`);
    assert.equal(p.architecture, config.runtime_base.architecture);
    equal(Object.keys(p.binaries).sort(), [...b.binary_packages].sort(), `${p.source_package} binaries`);
    for (const name of b.binary_packages) {
      assert.equal(p.binaries[name].version, b.installed_fixed, `${name} installed at the backport`);
      assert.equal(p.binaries[name].status, 'install ok installed', `${name} installed`);
    }
    if (p.source_package === 'zlib') {
      assert.notEqual(p.reproducer.unpatched_exit, 0);
      assert.equal(p.reproducer.patched_exit, 0);
      assert.equal(p.reproducer.asan_overflow_before, true);
      assert.equal(p.reproducer.asan_clean_after, true);
      assert.equal(p.patched_marker_present, true);
    } else if (p.source_package === 'glibc') {
      assert.equal(p.strfmon_regression_test, 'PASS', 'glibc strfmon regression test must pass');
      assert.equal(p.smoke_compiles, true);
      const glibcConfig = config.packages.find(x => x.source_package === 'glibc');
      assert.equal(p.build_environment.apt_snapshot, glibcConfig.build_apt_snapshot, 'glibc built from the pinned snapshot');
      hash(p.build_environment.installed_packages_sha256);
      assert.ok(Number.isInteger(p.build_environment.snapshot_checked_packages) && p.build_environment.snapshot_checked_packages > 0,
        'glibc build dependencies were checked against the snapshot index');
      if (glibcConfig.build_environment_sha256 !== null) {
        assert.equal(p.build_environment.installed_packages_sha256, glibcConfig.build_environment_sha256,
          'glibc build environment differs from the reviewed one');
      }
      const smoke = p.runtime_smoke;
      assert.ok(smoke, 'glibc runtime smoke must have run in the runtime stage');
      assert.equal(smoke.smoke_exit, 0, 'glibc runtime smoke must exit 0');
      assert.match(smoke.smoke_stdout, SMOKE_OUTPUT, 'glibc runtime smoke output');
      assert.match(smoke.ldd_version, /\b2\.41\b/, 'ldd reports glibc 2.41');
      assert.ok(typeof smoke.node_dns_lookup === 'string' && smoke.node_dns_lookup.length > 0, 'Node dns.lookup resolved');
      hash(smoke.smoke_binary_sha256);
      for (const file of Object.keys(p.patched_files)) {
        assert.notEqual(p.patched_files[file].preimage_sha256, p.patched_files[file].postimage_sha256);
      }
    }
  }
}

export function validateScannerArgs(args) {
  equal(array(args), SCANNER_ARGS, 'exact raw scanner arguments (unfixed included, no filtering flags)');
}

// Classifies every Critical/High row of the unaltered raw report.
export function classifyRawReport(report, exitStatus, config) {
  assert.equal(report.SchemaVersion, 2);
  assert.equal(report.Metadata.OS.Family, DEBIAN_FAMILY);
  assert.match(String(report.Metadata.OS.Name), DEBIAN_RELEASE, 'Debian trixie (13.x) runtime');
  const results = array(report.Results);
  for (const cls of ['os-pkgs', 'lang-pkgs']) {
    assert.ok(results.some(r => r.Class === cls && Array.isArray(r.Packages) && r.Packages.length > 0),
      'complete OS and language inventory');
  }
  assert.equal(results.flatMap(r => r.ExperimentalModifiedFindings || []).length, 0, 'no prefiltered findings');
  // Each configured backport is present in the scanned inventory at +toybaco1.
  const osPackages = results.filter(r => r.Class === 'os-pkgs').flatMap(r => r.Packages || []);
  for (const pkg of config.packages) {
    for (const name of pkg.binary_packages) {
      const inv = osPackages.filter(p => p.Name === name);
      assert.equal(debianVersion(one(inv, `one inventoried ${name}`)), pkg.installed_fixed,
        `inventoried ${name} is the backport`);
    }
  }
  const rowCount = results.reduce((total, r) => total + (r.Vulnerabilities || []).length, 0);
  assert.equal(exitStatus, rowCount > 0 ? 1 : 0, 'raw scanner exit status matches the reported rows');

  const reviewed = reviewedPackages();
  const fixedBySource = Object.fromEntries(config.packages.map(p => [p.source_package, p.installed_fixed]));
  const rows = [];
  for (const result of results) {
    for (const finding of result.Vulnerabilities || []) {
      assert.ok(SEVERITIES.includes(finding.Severity),
        `row outside the scanned severities: ${finding.VulnerabilityID} ${finding.Severity}`);
      const row = { vulnerability: finding.VulnerabilityID, package: finding.PkgName, severity: finding.Severity,
        status: finding.Status || '', installed_version: finding.InstalledVersion,
        fixed_version: finding.FixedVersion || '', class: result.Class, target: result.Target };
      const backport = result.Class === 'os-pkgs' ? backportFor(finding.VulnerabilityID, finding.PkgName) : undefined;
      if (fixAvailable(finding)) {
        row.disposition = 'fixed_unapplied';
      } else if (backport && finding.InstalledVersion === fixedBySource[backport.source]) {
        row.disposition = 'backported';
        row.source_package = backport.source;
        row.upstream_fix_commit = backport.cves[finding.VulnerabilityID];
      } else if (result.Class === 'os-pkgs' && reviewed.has(finding.PkgName)) {
        row.disposition = 'reviewed_unexpected';
      } else {
        row.disposition = 'unreviewed_unfixed';
      }
      rows.push(row);
    }
  }
  return rows;
}

const ORDER = ['fixed_unapplied', 'reviewed_unexpected', 'unreviewed_unfixed', 'backported'];

export function evaluate(input, { strictUnreviewed = STRICT_UNREVIEWED } = {}) {
  const { config, configSha, context, proof, raw, rawExit, scannerArgs } = input;
  validateConfig(config);
  validateProof(proof, config, configSha, context);
  validateScannerArgs(scannerArgs);
  const rows = classifyRawReport(raw, rawExit, config)
    .sort((a, b) => ORDER.indexOf(a.disposition) - ORDER.indexOf(b.disposition)
      || a.package.localeCompare(b.package) || a.vulnerability.localeCompare(b.vulnerability));
  const of = disposition => rows.filter(r => r.disposition === disposition);
  const bySeverity = (list, severity) => list.filter(r => r.severity === severity).length;
  const unreviewed = of('unreviewed_unfixed');
  const backported = of('backported');
  const reasons = [];
  if (of('fixed_unapplied').length) reasons.push('fixed_unapplied');
  if (of('reviewed_unexpected').length) reasons.push('reviewed_package_unexpected');
  if (strictUnreviewed && unreviewed.length) reasons.push('unreviewed_unfixed');
  const backportedCves = new Set(backported.map(r => r.vulnerability));
  const expectedCves = new Set(Object.values(BACKPORTS).flatMap(b => Object.keys(b.cves)));
  return {
    schema_version: 3,
    result: reasons.length ? 'FAIL' : 'PASS',
    reasons,
    strict_unreviewed: strictUnreviewed,
    policy: POLICY,
    evaluator: 'scripts/verify-postiz-os-backport-classification.mjs',
    evaluation_kind: 'independent_os_raw_scan_classification',
    scanner_vex_filtering: false,
    image: IMAGE,
    source: { commit: context.source_commit, ref: context.source_ref },
    scanner: { arguments: [...SCANNER_ARGS], exit_status: rawExit },
    counts: {
      raw_critical: bySeverity(rows, 'CRITICAL'), raw_high: bySeverity(rows, 'HIGH'),
      backported: backported.length,
      fixed_unapplied: of('fixed_unapplied').length,
      reviewed_unexpected: of('reviewed_unexpected').length,
      unreviewed_unfixed_rows: unreviewed.length,
      unreviewed_unique: new Set(unreviewed.map(r => r.vulnerability)).size,
    },
    rows,
    backported_cves_observed: [...backportedCves].sort(),
    backported_cves_not_observed: [...expectedCves].filter(c => !backportedCves.has(c)).sort(),
    patch_config_sha256: hash(configSha),
    installed_source_proof: proof,
    raw_report: raw,
  };
}

// The judgement line and one line per Critical/High row, for the job log.
export function summary(result) {
  const c = result.counts;
  const head = `TOYBACO_PZ_OS_CVE=${result.result}`
    + (result.reasons.length ? ` reason=${result.reasons.join(',')}` : '')
    + ` backported=${c.backported} unreviewed_unfixed_rows=${c.unreviewed_unfixed_rows}`
    + ` unreviewed_unique=${c.unreviewed_unique} fixed_unapplied=${c.fixed_unapplied}`
    + ` reviewed_unexpected=${c.reviewed_unexpected} raw_critical=${c.raw_critical} raw_high=${c.raw_high}`
    + ` strict_unreviewed=${result.strict_unreviewed}`
    + ` backported_cves=${result.backported_cves_observed.join(',') || '-'}`
    + ` not_observed=${result.backported_cves_not_observed.join(',') || '-'}`;
  return [head, ...result.rows.map(r => `PZ_OS_CVE_ROW ${r.disposition} ${r.package} ${r.vulnerability}`
    + ` ${r.severity} status=${r.status || '-'} installed=${r.installed_version}`
    + ` fixed=${r.fixed_version || '-'}`)].join('\n');
}

function regular(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), basename(path) + ': expected a regular non-symlink file');
  return readFileSync(path);
}
const json = path => JSON.parse(regular(path));

function main() {
  const [dir, configPath] = process.argv.slice(2);
  assert.ok(dir && configPath, 'usage: verify-postiz-os-backport-classification.mjs <evidence-dir> <config>');
  const configBytes = regular(resolve(configPath));
  const result = evaluate({
    config: JSON.parse(configBytes),
    configSha: sha(configBytes),
    context: json(join(dir, 'context.json')),
    proof: json(join(dir, 'installed-proof.json')),
    raw: json(join(dir, 'raw-report.json')),
    rawExit: Number(regular(join(dir, 'raw-exit.txt')).toString().trim()),
    scannerArgs: json(join(dir, 'scanner-args.json')),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  console.error(summary(result));
  if (result.result !== 'PASS') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error('TOYBACO_PZ_OS_CVE=FAIL reason=integrity ' + error.message.split('\n')[0]);
    process.exitCode = 1;
  }
}
