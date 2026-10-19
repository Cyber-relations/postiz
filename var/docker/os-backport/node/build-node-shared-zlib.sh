#!/usr/bin/env bash
# Build Node.js 22.23.2 from the exact release source with --shared-zlib, linked
# against the reviewed zlib1g source backport (+toybaco1), so the binary carries no
# zlib copy of its own for gz* and resolves zlib through the system libz.so.1.
#
# Provenance and evidence, in order:
#   - apt resolves the toolchain only from the fixed snapshot.debian.org index (as the
#     glibc builder): the base image's lists are purged, "apt-get update --error-on=any"
#     fails on any missing index, and every package apt installs or changes must have
#     its exact version in that index; the resolved package list (name=version) and its
#     SHA-256 go into the stamp;
#   - the zlib-backport stage's build stamp and .deb are checked, the base zlib1g must
#     be the reviewed prior version, and the rebuilt +toybaco1 package is installed;
#   - the glibc-backport stage's build stamp must be present (read-only mount): the
#     Dockerfile orders the native builds glibc -> node through that mount, so the two
#     all-CPU builds never run at the same time; its SHA-256 goes into the stamp;
#   - resources are checked before the long build (fail closed): disk space, memory
#     (MemAvailable and the cgroup memory.max), the cgroup cpu.max quota and, when a
#     deadline is given, the remaining time; make's -j comes from them (below) and every
#     value used goes into the stamp;
#   - the zlib headers come from the SHA-256-pinned zlib1g-dev .deb of the same Debian
#     source (unpacked, not installed); the link directory holds only a libz.so
#     symlink to the installed libz.so.1, so the static libz.a can never be linked;
#   - SHASUMS256.txt is verified with gpgv against the vendored, SHA-256-pinned Node
#     release key and must be signed by its exact primary fingerprint; the
#     SHASUMS256.txt bytes and the source tarball are SHA-256 pinned, and the tarball
#     line in the signed file must carry the same hash;
#   - ./configure --shared-zlib (log kept), make, then the ELF and runtime checks:
#     DT_NEEDED has libz.so.1, no RPATH/RUNPATH, no gz* in the dynamic symbol table,
#     no gz_* implementation in the symbol table, and the libz the built node maps at
#     run time is the +toybaco1 file byte for byte;
#   - a minimal N-API addon (gzprobe.c) loaded into the built node binds gz* to the
#     system libz.so.1 (LD_DEBUG=bindings shows gzwrite/gzprintf resolving to it, nm -D
#     lists them as undefined imports) and runs the CVE-2026-85091 direct-write path
#     cleanly through that libz; the OOB-vs-clean proof is the zlib stage's ASan
#     reproducer, this shows the addon path reaches the +toybaco1 fix;
#   - process.versions.zlib, a JS zlib interoperability check against the official
#     binary, and Node's own test/parallel/test-zlib-* subset (a failure that the
#     official binary does not also show fails the build).
# No scanner is run.
#
# Usage: build-node-shared-zlib.sh <node-dir> <zlib-out-dir> <glibc-out-dir> \
#          <zlib-src-dir> <out-dir>
#   <node-dir>       this script, the vendored release key and gzprobe.c
#   <zlib-out-dir>   the zlib-backport stage output (zlib1g .deb and build-stamp.json)
#   <glibc-out-dir>  the glibc-backport stage output (build-stamp.json is required)
#   <zlib-src-dir>   the reviewed zlib backport inputs (the adapted patch and the
#                    reproducer poc_cve_2026_85091.c), checksum-pinned here; used for the
#                    two-sided ASan reproducer (patched vs unpatched shared libz)
#   <out-dir>        receives node, LICENSE, build-stamp.json, build-environment.txt,
#                    configure.log and zlib-tests.tap
# Environment: TOYBACO_NODE_BUILD_DEADLINE_EPOCH (optional, Unix seconds). When set, the
# build fails closed unless the estimated time fits before it; when unset, the stamp
# records that no deadline was checked.
# Intended for a Debian trixie amd64 builder stage based on the pinned official
# node:22.23.2-trixie-slim image (its /usr/local/bin/node is the reference binary).
set -Eeuo pipefail
IFS=$'\n\t'
export LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive
log() { printf '[node-shared-zlib] %s\n' "$*"; }
die() { log "$2"; exit "$1"; }

NODE_DIR="$(cd "${1:?node dir}" && pwd -P)"
ZLIB_OUT="$(cd "${2:?zlib-backport out dir}" && pwd -P)"
GLIBC_OUT="$(cd "${3:?glibc-backport out dir}" && pwd -P)"
ZLIB_SRC_DIR="$(cd "${4:?zlib backport source dir}" && pwd -P)"
OUT_DIR="${5:?out dir}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"

# Exact Node release source.
NODE_VERSION='22.23.2'
NODE_DIST="https://nodejs.org/dist/v$NODE_VERSION"
NODE_TARBALL="node-v$NODE_VERSION.tar.xz"
NODE_TARBALL_SHA256='bbe768df8d5815d7fa76124052985332452e0a4742d39f32027550d1aab8f6fb'
SHASUMS_SHA256='778ac5b2fcdbd68d9c0ae9f4310674faa3af0910bd0d18e7f6597787c40a3e39'
# Node release key (README "Release keys", nodejs/release-keys keys/<fpr>.asc).
RELEASE_KEY_FPR='CC68F5A3106FF448322E48ED27F5E38D5B0A215F'
RELEASE_KEY_FILE="nodejs-release-key-$RELEASE_KEY_FPR.asc"
RELEASE_KEY_SHA256='e31e1aa40a8331f01d753cef475f7b9eab934fc25f5f0b36995bfd80bd66ad27'
RELEASE_KEYRING_SHA256='f678918aff78be1eecac10681ed4e0ee47bd61b173ce43c85a94729d551eb12d'
# deps/zlib/gzwrite.c of the release (upstream zlib 1.3.1); not compiled with --shared-zlib.
BUNDLED_GZWRITE_SHA256='469b1e58932ea11bdda2a153f6655f7b3c13254240fae157181b49ed1bc93b47'

# The reviewed zlib1g source backport and the headers of the same Debian source.
ZLIB_PRIOR='1:1.3.dfsg+really1.3.1-1+b1'
ZLIB_FIXED='1:1.3.dfsg+really1.3.1-1+toybaco1'
ZLIB_DEB='zlib1g_1.3.dfsg+really1.3.1-1+toybaco1_amd64.deb'
ZLIB_SOFILE='libz.so.1.3.1'
ZLIB_VERSION='1.3.1'
ZLIB_DEV_DEB='zlib1g-dev_1.3.dfsg+really1.3.1-1+b1_amd64.deb'
ZLIB_DEV_DEB_SHA256='76ed5c858e1aef38b7be93acce5910e457e77bd6271471b9d05fb42e78826224'
# zlib upstream 1.3.1 source for the two-sided ASan reproducer; the orig tarball SHA-256
# is the same pin as postiz/os-backport/zlib/build-zlib1g-backport.sh.
ZLIB_ORIG='zlib_1.3.dfsg+really1.3.1.orig.tar.gz'
ZLIB_ORIG_SHA256='60dd315c07f616887caa029408308a018ace66e3d142726a97db164b3b8f69fb'
ZLIB_BASE='https://deb.debian.org/debian/pool/main/z/zlib'
ADAPTED_PATCH_SHA256='2910727aea20ef7b71050e5161a6dfcac2e91788d9c69b32989a6829cfb5435a'
POC_SHA256='43231e593cb129ca032daf80a83d4d86a9f27d2c5155b42d06bd19aebd103d14'
GZWRITE_ORIG_SHA256='469b1e58932ea11bdda2a153f6655f7b3c13254240fae157181b49ed1bc93b47'
GZWRITE_PATCHED_SHA256='ce2da7e2567c7f3fd361cbdf56bc4354e179c1d91257ea26eeb281cbbe83e1ca'
ZLIB_DEV_SOURCE='zlib (1:1.3.dfsg+really1.3.1-1)'
# zlib.h of upstream 1.3.1; Debian carries no patch to it.
ZLIB_H_SHA256='8a5579af72ea4f427ff00a4150f0ccb3fc5c1e4379f726e101133b1ab9fc600c'

GLIBC_FIXED='2.41-12+deb13u4+toybaco1'

# make -j: min(nproc, cgroup cpu.max quota, (usable memory - reserve) / per job, cap).
# Usable memory is MemAvailable, lowered to cgroup memory.max - memory.current when the
# container has a limit. Node's BUILDING.md (v22.23.2): "at least 8GB of RAM is typically
# required when compiling with 4 parallel jobs (make -j4)", i.e. 2 GiB per job including
# the link. The reserve keeps 1 GiB for the test runner and the stage's other processes.
# Measured in private CI run 38799690924 (2 CPUs, 7 GB runner, -j2, no OOM): make took
# 9176 s, an upper bound of 306 CPU-minutes, so NODE_BUILD_CPU_MINUTES is 320 for the
# deadline check; NODE_BUILD_POST_MINUTES covers the checks, tests and PoC after make.
# The disk floor is provisional; the stamp records the measured build tree size.
NODE_BUILD_MIB_PER_JOB=2048
NODE_BUILD_RESERVE_MIB=1024
NODE_BUILD_MAX_JOBS=8
NODE_BUILD_MIN_DISK_MIB=8192
NODE_BUILD_CPU_MINUTES=320
NODE_BUILD_POST_MINUTES=20

APT_SNAPSHOT='20261015T000000Z'
SNAPSHOT_DEBIAN="http://snapshot.debian.org/archive/debian/$APT_SNAPSHOT"
SNAPSHOT_SECURITY="http://snapshot.debian.org/archive/debian-security/$APT_SNAPSHOT"
REFERENCE_NODE=/usr/local/bin/node

arch="$(dpkg --print-architecture)"
[ "$arch" = amd64 ] || die 2 "only amd64 is supported, got $arch"
MULTIARCH=x86_64-linux-gnu
SYSTEM_LIBZ="/usr/lib/$MULTIARCH/libz.so.1"
[ "$("$REFERENCE_NODE" -p process.versions.node)" = "$NODE_VERSION" ] \
  || die 2 "reference node is not $NODE_VERSION"

log 'verifying the vendored release key bytes'
printf '%s  %s\n' "$RELEASE_KEY_SHA256" "$NODE_DIR/$RELEASE_KEY_FILE" | sha256sum -c -

log 'checking the zlib-backport stage output'
"$REFERENCE_NODE" - "$ZLIB_OUT" "$ZLIB_FIXED" "$ZLIB_DEB" <<'EOF'
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [dir, fixed, debName] = process.argv.slice(2);
const stamp = JSON.parse(fs.readFileSync(path.join(dir, 'build-stamp.json'), 'utf8'));
assert.equal(stamp.cve, 'CVE-2026-85091');
assert.equal(stamp.binary_package, 'zlib1g');
assert.equal(stamp.installed_fixed, fixed);
assert.equal(stamp.architecture, 'amd64');
assert.equal(stamp.patched_marker_present, true);
assert.equal(stamp.reproducer.patched_exit, 0);
assert.equal(stamp.deb, debName);
const deb = path.join(dir, debName);
const stat = fs.lstatSync(deb);
assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'zlib1g .deb must be a regular file');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(deb)).digest('hex'), stamp.deb_sha256,
  'zlib1g .deb bytes differ from the zlib-backport stamp');
EOF
zlib_deb_sha="$(sha256sum "$ZLIB_OUT/$ZLIB_DEB" | cut -d' ' -f1)"
zlib_stamp_sha="$(sha256sum "$ZLIB_OUT/build-stamp.json" | cut -d' ' -f1)"

log 'checking the glibc-backport stage output (native build order glibc -> node)'
"$REFERENCE_NODE" - "$GLIBC_OUT" "$GLIBC_FIXED" <<'EOF'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const [dir, fixed] = process.argv.slice(2);
const file = path.join(dir, 'build-stamp.json');
const stat = fs.lstatSync(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'glibc build stamp must be a regular file');
const stamp = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(stamp.source_package, 'glibc');
assert.equal(stamp.installed_fixed, fixed);
assert.equal(stamp.strfmon_regression_test, 'PASS');
EOF
glibc_stamp_sha="$(sha256sum "$GLIBC_OUT/build-stamp.json" | cut -d' ' -f1)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

log "pinning apt to snapshot.debian.org $APT_SNAPSHOT"
mkdir -p /etc/apt/toybaco-disabled-sources
for source in /etc/apt/sources.list.d/*; do
  if [ -e "$source" ]; then mv "$source" /etc/apt/toybaco-disabled-sources/; fi
done
: > /etc/apt/sources.list
cat > /etc/apt/sources.list.d/toybaco-snapshot.sources <<EOF
Types: deb
URIs: $SNAPSHOT_DEBIAN
Suites: trixie trixie-updates
Components: main
Check-Valid-Until: no

Types: deb
URIs: $SNAPSHOT_SECURITY
Suites: trixie-security
Components: main
Check-Valid-Until: no
EOF
# Drop every index the base image fetched, so only the snapshot can resolve packages.
rm -rf /var/lib/apt/lists/*
APT_OPTS=(-o Acquire::Retries=5 -o Acquire::http::Timeout=120)
dpkg-query -W -f='${Package}=${Version}\n' | LC_ALL=C sort -u > "$work/packages-before.txt"
apt-get "${APT_OPTS[@]}" update -qq --error-on=any
apt-get "${APT_OPTS[@]}" install -y -qq --no-install-recommends \
  ca-certificates curl xz-utils gpg gpgv python3 g++ make binutils libasan8 patch >/dev/null

log "checking that every installed or changed package comes from the $APT_SNAPSHOT index"
# $(FILENAME) is apt's own format field, not a shell expansion.
# shellcheck disable=SC2016
apt-get indextargets --format '$(FILENAME)' 'Created-By: Packages' > "$work/index-files.txt"
[ -s "$work/index-files.txt" ] || die 3 'no snapshot Packages index is present'
for suite in trixie trixie-updates trixie-security; do
  grep -q "_${APT_SNAPSHOT}_dists_${suite}_main_binary-${arch}_Packages" "$work/index-files.txt" \
    || die 3 "the $APT_SNAPSHOT Packages index for $suite is missing"
done
while IFS= read -r index_file; do
  # Inside the pipeline stdout feeds awk, so the reason goes to stderr.
  /usr/lib/apt/apt-helper cat-file "$index_file" || { log "cannot read the snapshot index $index_file" >&2; exit 3; }
done < "$work/index-files.txt" \
  | awk '/^Package: /{name=$2} /^Version: /{print name "=" $2}' | LC_ALL=C sort -u > "$work/snapshot-versions.txt"
[ -s "$work/snapshot-versions.txt" ] || die 3 'the snapshot Packages index is empty'
dpkg-query -W -f='${Package}=${Version}\n' | LC_ALL=C sort -u > "$work/packages-after.txt"
LC_ALL=C comm -13 "$work/packages-before.txt" "$work/packages-after.txt" > "$work/packages-installed.txt"
snapshot_checked="$(wc -l < "$work/packages-installed.txt" | tr -d ' ')"
[ "$snapshot_checked" -gt 0 ] || die 3 'apt installed no toolchain package from the snapshot'
LC_ALL=C comm -23 "$work/packages-installed.txt" "$work/snapshot-versions.txt" > "$work/packages-outside-snapshot.txt"
if [ -s "$work/packages-outside-snapshot.txt" ]; then
  log 'installed versions missing from the snapshot index:'; cat "$work/packages-outside-snapshot.txt" >&2
  die 3 "packages outside the $APT_SNAPSHOT snapshot were installed"
fi
log "snapshot check: $snapshot_checked installed or changed packages are in the $APT_SNAPSHOT index"

log 'replacing the base zlib1g with the reviewed source backport'
base_zlib="$(dpkg-query -W -f='${Version}' zlib1g)"
[ "$base_zlib" = "$ZLIB_PRIOR" ] \
  || die 3 "base zlib1g is $base_zlib, not the reviewed $ZLIB_PRIOR"
[ "$(dpkg-deb -f "$ZLIB_OUT/$ZLIB_DEB" Package)" = zlib1g ] || die 3 'backport .deb is not zlib1g'
[ "$(dpkg-deb -f "$ZLIB_OUT/$ZLIB_DEB" Version)" = "$ZLIB_FIXED" ] || die 3 'backport .deb version mismatch'
dpkg -i "$ZLIB_OUT/$ZLIB_DEB" >/dev/null
[ "$(dpkg-query -W -f='${Version}' zlib1g)" = "$ZLIB_FIXED" ] || die 3 'zlib1g backport not installed'
[ "$(readlink "$SYSTEM_LIBZ")" = "$ZLIB_SOFILE" ] || die 3 "$SYSTEM_LIBZ does not point to $ZLIB_SOFILE"

dpkg-query -W -f='${binary:Package}=${Version}\n' | LC_ALL=C sort > "$OUT_DIR/build-environment.txt"
build_env_sha="$(sha256sum "$OUT_DIR/build-environment.txt" | cut -d' ' -f1)"
build_env_count="$(wc -l < "$OUT_DIR/build-environment.txt" | tr -d ' ')"
log "build environment: $build_env_count packages, sha256 $build_env_sha"

export GNUPGHOME="$work/gnupg"
mkdir -m 0700 "$GNUPGHOME"

log 'unpacking the zlib headers of the same Debian source (not installed)'
curl -fsSL -o "$work/$ZLIB_DEV_DEB" "$SNAPSHOT_DEBIAN/pool/main/z/zlib/$ZLIB_DEV_DEB" \
  || curl -fsSL -o "$work/$ZLIB_DEV_DEB" "https://deb.debian.org/debian/pool/main/z/zlib/$ZLIB_DEV_DEB"
printf '%s  %s\n' "$ZLIB_DEV_DEB_SHA256" "$work/$ZLIB_DEV_DEB" | sha256sum -c -
[ "$(dpkg-deb -f "$work/$ZLIB_DEV_DEB" Source)" = "$ZLIB_DEV_SOURCE" ] || die 3 'zlib1g-dev is from another source'
dpkg-deb -x "$work/$ZLIB_DEV_DEB" "$work/zlib-dev"
zlib_include="$work/zlib-dev/usr/include"
[ "$(sha256sum "$zlib_include/zlib.h" | cut -d' ' -f1)" = "$ZLIB_H_SHA256" ] || die 3 'unexpected zlib.h'
grep -q "^#define ZLIB_VERSION \"$ZLIB_VERSION\"" "$zlib_include/zlib.h" || die 3 'zlib.h is not 1.3.1'
zconf_sha="$(sha256sum "$zlib_include/zconf.h" | cut -d' ' -f1)"
zlib_link="$work/zlib-link"
mkdir "$zlib_link"
ln -s "$SYSTEM_LIBZ" "$zlib_link/libz.so"

log "fetching Node.js v$NODE_VERSION source and SHASUMS256.txt(.sig)"
mkdir "$work/dist"
for f in "$NODE_TARBALL" SHASUMS256.txt SHASUMS256.txt.sig; do
  curl -fsSL --retry 5 -o "$work/dist/$f" "$NODE_DIST/$f"
done
gpg --batch --dearmor < "$NODE_DIR/$RELEASE_KEY_FILE" > "$work/release-keyring.gpg"
printf '%s  %s\n' "$RELEASE_KEYRING_SHA256" "$work/release-keyring.gpg" | sha256sum -c -
gpgv --status-fd 3 --keyring "$work/release-keyring.gpg" \
  "$work/dist/SHASUMS256.txt.sig" "$work/dist/SHASUMS256.txt" 3>"$work/gpgv-status" 2>"$work/gpgv-log" \
  || { cat "$work/gpgv-log" >&2; die 4 'SHASUMS256.txt signature is not valid'; }
grep -Eq "^\[GNUPG:\] VALIDSIG [0-9A-F]{40} .* $RELEASE_KEY_FPR\$" "$work/gpgv-status" \
  || { cat "$work/gpgv-status" >&2; die 4 "SHASUMS256.txt is not signed by $RELEASE_KEY_FPR"; }
log "SHASUMS256.txt signature: VALIDSIG primary $RELEASE_KEY_FPR"
printf '%s  %s\n' "$SHASUMS_SHA256" "$work/dist/SHASUMS256.txt" | sha256sum -c -
grep -Fxq "$NODE_TARBALL_SHA256  $NODE_TARBALL" "$work/dist/SHASUMS256.txt" \
  || die 4 'signed SHASUMS256.txt does not list the pinned tarball hash'
(cd "$work/dist" && printf '%s  %s\n' "$NODE_TARBALL_SHA256" "$NODE_TARBALL" | sha256sum -c -)

log 'extracting the verified source'
mkdir "$work/src"
tar -xJf "$work/dist/$NODE_TARBALL" -C "$work/src" --strip-components=1 --no-same-owner
src="$work/src"
[ "$(sha256sum "$src/deps/zlib/gzwrite.c" | cut -d' ' -f1)" = "$BUNDLED_GZWRITE_SHA256" ] \
  || die 4 'unexpected bundled deps/zlib/gzwrite.c'
cp "$src/LICENSE" "$OUT_DIR/LICENSE"

log 'configure --shared-zlib'
configure_args=(
  --verbose
  --prefix=/usr/local
  --shared-zlib
  "--shared-zlib-includes=$zlib_include"
  "--shared-zlib-libpath=$zlib_link"
)
(cd "$src" && ./configure "${configure_args[@]}") > "$OUT_DIR/configure.log" 2>&1 \
  || { tail -n 40 "$OUT_DIR/configure.log" >&2; die 5 'configure failed'; }
grep -Eq "[\"']node_shared_zlib[\"']: [\"']true[\"']" "$src/config.gypi" \
  || die 5 'config.gypi does not set node_shared_zlib'
grep -Fq -- "-L$zlib_link" "$src/config.gypi" || die 5 'config.gypi lacks the zlib link directory'
grep -Eq "[\"']-lz[\"']" "$src/config.gypi" || die 5 'config.gypi does not link -lz'
grep -Fq "$zlib_include" "$src/config.gypi" || die 5 'config.gypi lacks the zlib include directory'
grep -E 'node_shared_zlib' "$OUT_DIR/configure.log" >/dev/null || die 5 'configure log does not show node_shared_zlib'
sed -n 's/^exec /NODE_CONFIGURE exec /p' "$src/config.status"
grep -E 'node_shared_zlib|INFO: configure completed' "$OUT_DIR/configure.log" | sed 's/^/NODE_CONFIGURE_LOG /'
grep -E 'node_shared_zlib|-lz|zlib-link|zlib-dev' "$src/config.gypi" | sed 's/^/NODE_CONFIG_GYPI /'

log 'checking resources before the long build (fail closed)'
nproc_count="$(nproc)"
cgroup_cpu_max=unavailable
cpu_quota="$nproc_count"
if [ -r /sys/fs/cgroup/cpu.max ]; then
  cgroup_cpu_max="$(cat /sys/fs/cgroup/cpu.max)"
  if [[ "$cgroup_cpu_max" =~ ^([0-9]+)\ ([0-9]+)$ ]]; then
    cpu_quota=$(( BASH_REMATCH[1] / BASH_REMATCH[2] ))
  fi
elif [ -r /sys/fs/cgroup/cpu/cpu.cfs_quota_us ] && [ -r /sys/fs/cgroup/cpu/cpu.cfs_period_us ]; then
  quota_us="$(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us)"
  period_us="$(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)"
  cgroup_cpu_max="$quota_us $period_us"
  if [ "$quota_us" -gt 0 ]; then cpu_quota=$(( quota_us / period_us )); fi
fi
[ "$cpu_quota" -ge 1 ] || cpu_quota=1
mem_available_mib=$(( $(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo) / 1024 ))
cgroup_memory_max=unavailable
cgroup_memory_current=unavailable
memory_limit_mib="$mem_available_mib"
if [ -r /sys/fs/cgroup/memory.max ]; then
  cgroup_memory_max="$(cat /sys/fs/cgroup/memory.max)"
  cgroup_memory_current="$(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo unavailable)"
elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
  cgroup_memory_max="$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)"
  cgroup_memory_current="$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || echo unavailable)"
  # cgroup v1 reports "no limit" as a huge number.
  if [ "${#cgroup_memory_max}" -ge 19 ]; then cgroup_memory_max=max; fi
fi
if [[ "$cgroup_memory_max" =~ ^[0-9]+$ ]] && [[ "$cgroup_memory_current" =~ ^[0-9]+$ ]]; then
  cgroup_free_mib=$(( (cgroup_memory_max - cgroup_memory_current) / 1048576 ))
  if [ "$cgroup_free_mib" -lt "$memory_limit_mib" ]; then memory_limit_mib="$cgroup_free_mib"; fi
fi
jobs_by_memory=$(( (memory_limit_mib - NODE_BUILD_RESERVE_MIB) / NODE_BUILD_MIB_PER_JOB ))
[ "$jobs_by_memory" -ge 1 ] || die 9 "not enough memory for one build job: usable ${memory_limit_mib} MiB, reserve $NODE_BUILD_RESERVE_MIB MiB, per job $NODE_BUILD_MIB_PER_JOB MiB"
jobs="$nproc_count"
for bound in "$cpu_quota" "$jobs_by_memory" "$NODE_BUILD_MAX_JOBS"; do
  if [ "$bound" -lt "$jobs" ]; then jobs="$bound"; fi
done
disk_available_mib=$(( $(df -Pk "$src" | awk 'NR == 2 { print $4 }') / 1024 ))
[ "$disk_available_mib" -ge "$NODE_BUILD_MIN_DISK_MIB" ] \
  || die 9 "not enough disk for the build tree: ${disk_available_mib} MiB < $NODE_BUILD_MIN_DISK_MIB MiB"
required_minutes=$(( (NODE_BUILD_CPU_MINUTES + jobs - 1) / jobs + NODE_BUILD_POST_MINUTES ))
deadline_epoch="${TOYBACO_NODE_BUILD_DEADLINE_EPOCH:-}"
remaining_minutes=null
deadline_check=not_provided
if [ -n "$deadline_epoch" ]; then
  [[ "$deadline_epoch" =~ ^[0-9]+$ ]] || die 9 "invalid TOYBACO_NODE_BUILD_DEADLINE_EPOCH: $deadline_epoch"
  remaining_minutes=$(( (deadline_epoch - $(date +%s)) / 60 ))
  [ "$remaining_minutes" -ge "$required_minutes" ] \
    || die 9 "not enough time: ${remaining_minutes} min left, about ${required_minutes} min needed with -j$jobs"
  deadline_check=pass
fi
printf 'NODE_RESOURCES nproc=%s cgroup_cpu_max=%s cpu_quota=%s mem_available_mib=%s cgroup_memory_max=%s cgroup_memory_current=%s usable_mib=%s reserve_mib=%s per_job_mib=%s max_jobs=%s jobs_by_memory=%s jobs=%s disk_available_mib=%s min_disk_mib=%s required_minutes=%s remaining_minutes=%s deadline_check=%s\n' \
  "$nproc_count" "${cgroup_cpu_max// /_}" "$cpu_quota" "$mem_available_mib" "$cgroup_memory_max" "$cgroup_memory_current" \
  "$memory_limit_mib" "$NODE_BUILD_RESERVE_MIB" "$NODE_BUILD_MIB_PER_JOB" "$NODE_BUILD_MAX_JOBS" "$jobs_by_memory" "$jobs" \
  "$disk_available_mib" "$NODE_BUILD_MIN_DISK_MIB" "$required_minutes" "$remaining_minutes" "$deadline_check"

log "make -j$jobs"
build_start="$(date +%s)"
(cd "$src" && make -j"$jobs") > "$work/make.log" 2>&1 \
  || { tail -n 60 "$work/make.log" >&2; die 5 'make failed'; }
build_end="$(date +%s)"
build_seconds=$((build_end - build_start))
built="$src/out/Release/node"
[ -f "$built" ] && [ -x "$built" ] || die 5 'out/Release/node was not produced'
log "build: ${build_seconds}s with $jobs jobs"
# Measured peak of the whole container (cgroup v2 memory.peak), for calibrating the
# per-job and reserve constants; "unavailable" where the kernel does not expose it.
memory_peak_mib=unavailable
if [ -r /sys/fs/cgroup/memory.peak ] && [[ "$(cat /sys/fs/cgroup/memory.peak)" =~ ^[0-9]+$ ]]; then
  memory_peak_mib=$(( $(cat /sys/fs/cgroup/memory.peak) / 1048576 ))
fi
build_tree_mib="$(du -sm "$src" | cut -f1)"
printf 'NODE_BUILD seconds=%s jobs=%s cpu_minutes_upper_bound=%s cgroup_memory_peak_mib=%s build_tree_mib=%s\n' \
  "$build_seconds" "$jobs" "$(( (build_seconds * jobs + 59) / 60 ))" "$memory_peak_mib" "$build_tree_mib"

log 'checking the ELF of the built binary'
readelf -d "$built" > "$work/dynamic.txt"
needed="$(sed -n 's/.*(NEEDED).*Shared library: \[\(.*\)\]/\1/p' "$work/dynamic.txt" | paste -sd, -)"
grep -Eq '\(NEEDED\).*\[libz\.so\.1\]' "$work/dynamic.txt" || die 6 "DT_NEEDED lacks libz.so.1: $needed"
if grep -Eq '\((RPATH|RUNPATH)\)' "$work/dynamic.txt"; then die 6 'built node carries RPATH/RUNPATH'; fi
nm -D "$built" > "$work/dynsym.txt"
gz_dynamic="$(grep -c ' gz' "$work/dynsym.txt" || true)"
[ "$gz_dynamic" = 0 ] || { grep ' gz' "$work/dynsym.txt" >&2; die 6 'gz* symbols in the dynamic symbol table'; }
nm "$built" > "$work/symtab.txt"
gz_impl="$(grep -Ec ' (gz_comp|gz_write|gz_init|gz_zero|gzwrite|gzprintf|gzvprintf)$' "$work/symtab.txt" || true)"
[ "$gz_impl" = 0 ] || { grep -E ' (gz_comp|gz_write|gz_init|gz_zero|gzwrite|gzprintf|gzvprintf)$' "$work/symtab.txt" >&2; die 6 'a gz* implementation is linked into node'; }
cr_z_dynamic="$(grep -c ' Cr_z_' "$work/dynsym.txt" || true)"
cr_z_gz="$(grep -c 'Cr_z_gz' "$work/symtab.txt" || true)"
[ "$cr_z_gz" = 0 ] || die 6 "V8's private zlib copy links gz* code"
printf 'NODE_ELF NEEDED=%s\n' "$needed"
printf 'NODE_ELF nm -D gz*=%s gz_impl(symtab)=%s Cr_z_ exports(V8 private copy, no gz*)=%s\n' \
  "$gz_dynamic" "$gz_impl" "$cr_z_dynamic"

log 'checking the libz the built binary maps at run time'
libz_mapped="$("$built" -e "
const fs = require('node:fs');
const seen = new Set();
for (const line of fs.readFileSync('/proc/self/maps', 'utf8').split('\n')) {
  const file = line.split(/\s+/)[5];
  if (file && /\/libz\.so/.test(file)) seen.add(fs.realpathSync(file));
}
console.log([...seen].join(','));
")"
[ "$libz_mapped" = "/usr/lib/$MULTIARCH/$ZLIB_SOFILE" ] || die 6 "unexpected mapped libz: $libz_mapped"
libz_owner="$(dpkg-query -S "/usr/lib/$MULTIARCH/$ZLIB_SOFILE" | cut -d: -f1-2)"
[ "$libz_owner" = "zlib1g:$arch" ] || die 6 "libz owner is $libz_owner"
libz_sha="$(sha256sum "/usr/lib/$MULTIARCH/$ZLIB_SOFILE" | cut -d' ' -f1)"
deb_libz_sha="$(dpkg-deb --fsys-tarfile "$ZLIB_OUT/$ZLIB_DEB" | tar -xO "./usr/lib/$MULTIARCH/$ZLIB_SOFILE" | sha256sum | cut -d' ' -f1)"
[ "$libz_sha" = "$deb_libz_sha" ] || die 6 'mapped libz differs from the file in the backport .deb'
versions_zlib="$("$built" -p process.versions.zlib)"
[ "$versions_zlib" = "$ZLIB_VERSION" ] || die 6 "process.versions.zlib is $versions_zlib"
[ "$("$built" -p process.versions.node)" = "$NODE_VERSION" ] || die 6 'built node version mismatch'
printf 'NODE_LIBZ mapped=%s owner=%s version=%s sha256=%s matches_backport_deb=true\n' \
  "$libz_mapped" "$libz_owner" "$(dpkg-query -W -f='${Version}' zlib1g)" "$libz_sha"
printf 'NODE_VERSIONS node=%s zlib=%s (reference bundled=%s)\n' \
  "$("$built" -p process.versions.node)" "$versions_zlib" "$("$REFERENCE_NODE" -p process.versions.zlib)"

log 'JS zlib interoperability with the official binary'
cat > "$work/interop.cjs" <<'EOF'
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const [mode, file] = process.argv.slice(2);
const fs = require('node:fs');
const input = Buffer.concat([crypto.createHash('sha512').update('toybaco').digest(),
  Buffer.alloc(200000, 'node-shared-zlib '), crypto.createHash('sha256').update('end').digest()]);
if (mode === 'produce') {
  fs.writeFileSync(file, JSON.stringify({
    gzip: zlib.gzipSync(input, { level: 9 }).toString('base64'),
    deflate: zlib.deflateSync(input).toString('base64'),
    raw: zlib.deflateRawSync(input, { level: 1 }).toString('base64'),
    crc32: zlib.crc32(input),
  }));
} else {
  const other = JSON.parse(fs.readFileSync(file, 'utf8'));
  const assert = require('node:assert/strict');
  assert.ok(zlib.gunzipSync(Buffer.from(other.gzip, 'base64')).equals(input), 'gunzip');
  assert.ok(zlib.inflateSync(Buffer.from(other.deflate, 'base64')).equals(input), 'inflate');
  assert.ok(zlib.inflateRawSync(Buffer.from(other.raw, 'base64')).equals(input), 'inflateRaw');
  assert.equal(zlib.crc32(input), other.crc32, 'crc32');
  assert.ok(zlib.brotliDecompressSync(zlib.brotliCompressSync(input)).equals(input), 'brotli');
  assert.ok(zlib.unzipSync(zlib.gzipSync(input)).equals(input), 'self gzip');
  console.log('ok');
}
EOF
"$REFERENCE_NODE" "$work/interop.cjs" produce "$work/interop-reference.json"
"$built" "$work/interop.cjs" produce "$work/interop-built.json"
[ "$("$built" "$work/interop.cjs" consume "$work/interop-reference.json")" = ok ] || die 7 'built node cannot read the official output'
[ "$("$REFERENCE_NODE" "$work/interop.cjs" consume "$work/interop-built.json")" = ok ] || die 7 'official node cannot read the built output'
log 'JS zlib interop: gzip/deflate/raw/crc32 both directions, brotli and self round trip PASS'

log 'running test/parallel/test-zlib-* with the built binary'
run_zlib_tests() {
  local shell="$1" tap="$2" rc=0
  (cd "$src" && python3 tools/test.py --mode=release "--shell=$shell" -p tap -j "$jobs" \
    'test/parallel/test-zlib-*') > "$tap" 2>&1 || rc=$?
  printf '%s' "$rc"
}
tap_count() { grep -Ec "$1" "$2" || true; }
built_rc="$(run_zlib_tests "$built" "$OUT_DIR/zlib-tests.tap")"
tests_total="$(tap_count '^(not )?ok [0-9]+ ' "$OUT_DIR/zlib-tests.tap")"
tests_failed="$(tap_count '^not ok [0-9]+ ' "$OUT_DIR/zlib-tests.tap")"
tests_skipped="$(tap_count '^ok [0-9]+ .*# (skip|SKIP)' "$OUT_DIR/zlib-tests.tap")"
[ "$tests_total" -ge 50 ] || { tail -n 40 "$OUT_DIR/zlib-tests.tap" >&2; die 8 "only $tests_total zlib tests ran"; }
regressions=0
reference_failed=0
if [ "$tests_failed" != 0 ]; then
  grep -E '^not ok [0-9]+ ' "$OUT_DIR/zlib-tests.tap" >&2
  run_zlib_tests "$REFERENCE_NODE" "$work/zlib-tests-reference.tap" >/dev/null
  reference_failed="$(tap_count '^not ok [0-9]+ ' "$work/zlib-tests-reference.tap")"
  while IFS= read -r name; do
    if ! grep -Eq "^not ok [0-9]+ $name( |\$)" "$work/zlib-tests-reference.tap"; then
      log "regression (passes with the official binary): $name"
      regressions=$((regressions + 1))
    fi
  done < <(sed -n 's/^not ok [0-9]* \([^ ]*\).*/\1/p' "$OUT_DIR/zlib-tests.tap")
fi
printf 'NODE_ZLIB_TESTS total=%s passed=%s failed=%s skipped=%s regressions=%s runner_exit=%s reference_failed=%s\n' \
  "$tests_total" "$((tests_total - tests_failed))" "$tests_failed" "$tests_skipped" "$regressions" "$built_rc" "$reference_failed"
[ "$regressions" = 0 ] || die 8 'zlib test regressions against the official binary'

log 'gzwrite PoC: build an N-API addon and bind gz* to the system libz'
addon="$work/gzprobe.node"
gcc -shared -fPIC -O2 -I"$src/src" -I"$zlib_include" "$NODE_DIR/gzprobe.c" \
  -o "$addon" -L"$zlib_link" -lz
# (a) resolution target: the addon needs libz.so.1 and imports gz* as undefined symbols.
addon_needed="$(readelf -d "$addon" | sed -n 's/.*(NEEDED).*Shared library: \[\(.*\)\]/\1/p' | paste -sd, -)"
case ",$addon_needed," in *,libz.so.1,*) : ;; *) die 8 "addon DT_NEEDED lacks libz.so.1: $addon_needed";; esac
# zlib's exported symbols are versioned, so undefined refs read as e.g. "U gzwrite@ZLIB_1.2.9".
addon_gz_undef="$(nm -D "$addon" | grep -cE '^ +U gz(open|write|printf|dopen|close|clearerr)(@.*)?$' || true)"
[ "$addon_gz_undef" -ge 4 ] || { nm -D "$addon" | grep ' gz' >&2; die 8 "addon does not import gz* as undefined: $addon_gz_undef"; }
# LD_DEBUG=bindings: every gz* the addon uses must bind to the system libz, never to node.
# LD_BIND_NOW resolves the addon's gz* at load (not lazily on call), so the bindings are
# logged even though the harness only loads and calls once; dlopen then call forces them.
LD_DEBUG=bindings LD_DEBUG_OUTPUT="$work/ld" LD_BIND_NOW=1 "$built" -e \
  "const a={exports:{}};process.dlopen(a,process.argv[1]);a.exports.directWritePath()" \
  "$addon" >/dev/null 2>&1 || true
ld_log="$(cat "$work"/ld.* 2>/dev/null || true)"
# glibc prints: "binding file <addon> [0] to <lib> [0]: normal symbol `gzwrite' [VER]".
gz_bindings="$(printf '%s\n' "$ld_log" | grep -E "binding file [^:]*gzprobe\.node .* to [^:]*: normal symbol \`gz(write|printf|open|dopen|close|clearerr)'" || true)"
[ -n "$gz_bindings" ] || { printf '%s\n' "$ld_log" | grep -E "gzprobe|gzwrite" | tail -5 >&2; die 8 'LD_DEBUG did not show the addon gz* bindings'; }
bad_bindings="$(printf '%s\n' "$gz_bindings" | grep -vE "to [^:]*/libz\.so\.1[0-9.]*[^:]*: normal symbol" || true)"
[ -z "$bad_bindings" ] || { printf '%s\n' "$bad_bindings" >&2; die 8 'an addon gz* symbol did not bind to the system libz'; }
gz_to_libz="$(printf '%s\n' "$gz_bindings" | grep -cE "to [^:]*/libz\.so\.1" || true)"
# (b) same input as the backport regression: the direct-write path runs cleanly (no
# SIGABRT/SIGSEGV) through the +toybaco1 libz and gzwrite returns 0 on the forced failure.
poc_out="$("$built" -e \
  "const a={exports:{}};process.dlopen(a,process.argv[1]);const z=a.exports.zlibVersion();const r=a.exports.directWritePath();console.log(JSON.stringify({zlibVersion:z,gzwrite:r}))" \
  "$addon")"
poc_rc=$?
[ "$poc_rc" = 0 ] || die 8 "gzwrite PoC addon crashed on the direct-write path: exit $poc_rc"
poc_zlib="$("$built" -e "const a={exports:{}};process.dlopen(a,process.argv[1]);process.stdout.write(a.exports.zlibVersion())" "$addon")"
poc_gzwrite="$(printf '%s' "$poc_out" | sed -n 's/.*"gzwrite":\(-\{0,1\}[0-9]*\).*/\1/p')"
[ "$poc_zlib" = "$ZLIB_VERSION" ] || die 8 "addon zlibVersion() is $poc_zlib"
[ "$poc_gzwrite" = 0 ] || die 8 "addon gzwrite() on the forced-failure path returned $poc_gzwrite, expected 0"
printf 'NODE_GZ_ADDON_POC needed=%s gz_undefined_imports=%s gz_bindings_to_libz=%s zlibVersion=%s direct_write_path=clean gzwrite_return=%s\n' \
  "$addon_needed" "$addon_gz_undef" "$gz_to_libz" "$poc_zlib" "$poc_gzwrite"
printf '%s\n' "$gz_bindings" | sed 's/^ *//; s/^/NODE_GZ_BINDING /'

log 'two-sided ASan reproducer: patched vs unpatched shared libz on the direct-write path'
# The reproducer and the adapted patch are the shipped, pinned bytes of the zlib1g
# backport; the direct-write OOB detection needs ASan-instrumented zlib code, so this
# builds the 1.3.1 source (patched and unpatched) as ASan shared libraries and runs the
# reproducer against each. The addon above proves the installed +toybaco1 libz is
# reached and the path is clean; this proves the same path is OOB unpatched / clean
# patched, so a one-sided clean run is never the only evidence.
poc_src="$ZLIB_SRC_DIR/poc_cve_2026_85091.c"
adapted_patch="$ZLIB_SRC_DIR/toybaco-zlib-gzwrite-cve-2026-85091.patch"
sha256sum -c - <<EOF
$ADAPTED_PATCH_SHA256  $adapted_patch
$POC_SHA256  $poc_src
EOF
zwork="$work/zlib-asan"
mkdir -p "$zwork"
curl -fsSL --retry 5 -o "$zwork/$ZLIB_ORIG" "$ZLIB_BASE/$ZLIB_ORIG" \
  || curl -fsSL --retry 5 -o "$zwork/$ZLIB_ORIG" "$SNAPSHOT_DEBIAN/pool/main/z/zlib/$ZLIB_ORIG"
printf '%s  %s\n' "$ZLIB_ORIG_SHA256" "$zwork/$ZLIB_ORIG" | sha256sum -c -
zlib_core=(adler32.c crc32.c deflate.c trees.c zutil.c compress.c uncompr.c gzclose.c
  gzlib.c gzread.c gzwrite.c infback.c inffast.c inflate.c inftrees.c)
for variant in unpatched patched; do
  d="$zwork/$variant"
  mkdir -p "$d"
  tar xzf "$zwork/$ZLIB_ORIG" -C "$d" --strip-components=1
  gz_pre="$(sha256sum "$d/gzwrite.c" | cut -d' ' -f1)"
  [ "$gz_pre" = "$GZWRITE_ORIG_SHA256" ] || die 8 "two-sided: unexpected gzwrite.c preimage ($variant): $gz_pre"
  if [ "$variant" = patched ]; then
    ( cd "$d" && patch -p1 -F0 < "$adapted_patch" >/dev/null )
    gz_post="$(sha256sum "$d/gzwrite.c" | cut -d' ' -f1)"
    [ "$gz_post" = "$GZWRITE_PATCHED_SHA256" ] || die 8 "two-sided: unexpected gzwrite.c postimage: $gz_post"
  fi
  ( cd "$d" && gcc -O1 -g -fsanitize=address -fPIC -DHAVE_UNISTD_H=1 -DHAVE_STDARG_H=1 \
      -shared "${zlib_core[@]}" -o "$zwork/libz_asan_$variant.so" )
  gcc -O1 -g -fsanitize=address -fno-sanitize-recover=all -I"$d" "$poc_src" \
    -L"$zwork" "-lz_asan_$variant" -Wl,-rpath,"$zwork" -o "$zwork/poc_$variant"
done
set +e
ASAN_OPTIONS=abort_on_error=0:exitcode=99:detect_leaks=0 "$zwork/poc_unpatched" >"$zwork/unpatched.out" 2>&1
two_sided_unpatched_exit=$?
ASAN_OPTIONS=abort_on_error=0:exitcode=99:detect_leaks=0 "$zwork/poc_patched" >"$zwork/patched.out" 2>&1
two_sided_patched_exit=$?
set -e
two_sided_unpatched_asan=false
grep -q 'heap-buffer-overflow' "$zwork/unpatched.out" && two_sided_unpatched_asan=true
[ "$two_sided_patched_exit" = 0 ] \
  || { tail -n 20 "$zwork/patched.out" >&2; die 8 "two-sided: patched shared libz did not exit 0: $two_sided_patched_exit"; }
if ! { [ "$two_sided_unpatched_exit" != 0 ] && [ "$two_sided_unpatched_asan" = true ]; }; then
  tail -n 20 "$zwork/unpatched.out" >&2
  die 8 "two-sided: unpatched shared libz did not abort with an ASan overflow: exit=$two_sided_unpatched_exit asan=$two_sided_unpatched_asan"
fi
printf 'NODE_GZ_TWO_SIDED patched_exit=%s unpatched_exit=%s unpatched_asan_overflow=%s\n' \
  "$two_sided_patched_exit" "$two_sided_unpatched_exit" "$two_sided_unpatched_asan"
grep -m1 'ERROR: AddressSanitizer' "$zwork/unpatched.out" | sed 's/^/NODE_GZ_TWO_SIDED_ASAN /' || true

install -m 0755 "$built" "$OUT_DIR/node"
node_sha="$(sha256sum "$OUT_DIR/node" | cut -d' ' -f1)"

"$REFERENCE_NODE" - "$OUT_DIR/build-stamp.json" <<EOF
const fs = require('node:fs');
const stamp = {
  schema_version: 1,
  component: 'node',
  node_version: '$NODE_VERSION',
  architecture: '$arch',
  source: {
    tarball: '$NODE_TARBALL',
    tarball_sha256: '$NODE_TARBALL_SHA256',
    shasums_sha256: '$SHASUMS_SHA256',
    signature: 'SHASUMS256.txt.sig',
    signer_fingerprint: '$RELEASE_KEY_FPR',
    release_key_sha256: '$RELEASE_KEY_SHA256',
    release_keyring_sha256: '$RELEASE_KEYRING_SHA256',
    signature_valid: true,
    bundled_gzwrite_sha256: '$BUNDLED_GZWRITE_SHA256',
  },
  configure: { args: ['--verbose', '--prefix=/usr/local', '--shared-zlib', '--shared-zlib-includes=<zlib1g-dev>/usr/include',
    '--shared-zlib-libpath=<link dir: libz.so -> $SYSTEM_LIBZ>'], node_shared_zlib: true },
  build: { seconds: $build_seconds, jobs: $jobs, cpu_minutes_upper_bound: $(( (build_seconds * jobs + 59) / 60 )) },
  resources: {
    formula: 'jobs = min(nproc, cgroup cpu.max quota, floor((usable MiB - reserve) / per_job), max_jobs)',
    nproc: $nproc_count, cgroup_cpu_max: '$cgroup_cpu_max', cpu_quota: $cpu_quota,
    mem_available_mib: $mem_available_mib, cgroup_memory_max: '$cgroup_memory_max',
    cgroup_memory_current: '$cgroup_memory_current', usable_mib: $memory_limit_mib,
    reserve_mib: $NODE_BUILD_RESERVE_MIB, per_job_mib: $NODE_BUILD_MIB_PER_JOB, max_jobs: $NODE_BUILD_MAX_JOBS,
    jobs_by_memory: $jobs_by_memory, jobs: $jobs,
    disk_available_mib: $disk_available_mib, min_disk_mib: $NODE_BUILD_MIN_DISK_MIB,
    cpu_minutes_estimate: $NODE_BUILD_CPU_MINUTES, post_minutes_estimate: $NODE_BUILD_POST_MINUTES,
    required_minutes: $required_minutes, deadline_epoch: ${deadline_epoch:-null},
    remaining_minutes: $remaining_minutes, deadline_check: '$deadline_check',
    cgroup_memory_peak_mib_after_make: '$memory_peak_mib', build_tree_mib_after_make: $build_tree_mib,
  },
  ordering: { after: 'glibc-backport', glibc_installed_fixed: '$GLIBC_FIXED', glibc_build_stamp_sha256: '$glibc_stamp_sha' },
  build_environment: { apt_snapshot: '$APT_SNAPSHOT', installed_packages_sha256: '$build_env_sha',
    installed_package_count: $build_env_count, snapshot_checked_packages: $snapshot_checked },
  zlib_backport: { installed_fixed: '$ZLIB_FIXED', deb: '$ZLIB_DEB', deb_sha256: '$zlib_deb_sha',
    build_stamp_sha256: '$zlib_stamp_sha', headers_deb: '$ZLIB_DEV_DEB', headers_deb_sha256: '$ZLIB_DEV_DEB_SHA256',
    zlib_h_sha256: '$ZLIB_H_SHA256', zconf_h_sha256: '$zconf_sha' },
  elf: { needed: '$needed'.split(','), runpath: null, gz_dynamic_symbols: $gz_dynamic,
    gz_implementation_symbols: $gz_impl, v8_private_zlib_exports: $cr_z_dynamic, v8_private_zlib_gz_symbols: $cr_z_gz },
  runtime: { libz_mapped: '$libz_mapped', libz_owner: '$libz_owner', libz_sha256: '$libz_sha',
    libz_matches_backport_deb: true, versions_zlib: '$versions_zlib' },
  js_zlib_interop: 'PASS',
  gz_addon_poc: { needed_libz: true, gz_undefined_imports: $addon_gz_undef,
    gz_bindings_to_libz: $gz_to_libz, bound_elsewhere: 0, zlib_version: '$poc_zlib',
    store_mode: 'wb0', direct_write_path: 'clean', gzwrite_return: $poc_gzwrite,
    two_sided: { patched_exit: $two_sided_patched_exit, unpatched_exit: $two_sided_unpatched_exit,
      unpatched_asan_overflow: $two_sided_unpatched_asan } },
  zlib_tests: { pattern: 'test/parallel/test-zlib-*', total: $tests_total, failed: $tests_failed,
    skipped: $tests_skipped, regressions: $regressions, reference_failed: $reference_failed },
  node_sha256: '$node_sha',
};
fs.writeFileSync(process.argv[2], JSON.stringify(stamp, null, 2) + '\n');
EOF
log "done: node ($node_sha) + build-stamp.json in $OUT_DIR"
