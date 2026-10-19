#!/usr/bin/env bash
# Rebuild Debian trixie glibc (libc6 + libc-bin) from pinned source with the
# official 2.41 stable-branch backports for CVE-2026-5435 and CVE-2026-19499, at
# the same ABI and architecture as the runtime base image.
#
# Reproducibility and evidence, in order:
#   - apt resolves build dependencies only from a fixed snapshot.debian.org index:
#     the base image's lists are purged, "apt-get update --error-on=any" fails on any
#     missing index, and every package apt installs or changes must have its exact
#     version in that index; the resolved package list (name=version) is recorded
#     with its SHA-256;
#   - the exact Debian source is checksum-pinned;
#   - the patch series file and every patch are checksum-pinned, the series names
#     exactly the pinned patch files in order, each patch's
#     "From <sha>" header must be the expected upstream commit, quilt applies them
#     at fuzz 0, "quilt applied" must end with exactly the series, and the before/
#     after bytes of each patched file must match;
#   - the version is bumped to +toybaco1 with a fixed-date changelog stanza (no dch);
#   - binary-arch packages are built (no biarch, and no biarch .deb may appear;
#     nocheck, so upstream's full test
#     suite is not run) and the regression test the CVE-2026-19499 fix added is then
#     built and run in Debian's build tree; only its .test-result evidence decides
#     PASS (check-test-result.sh), anything else fails the build (exit 6). Upstream
#     added no test with the CVE-2026-5435 fix;
#   - the runtime smoke is compiled and linked (it is executed later, in the
#     runtime stage, against the installed libc);
#   - the rebuilt libc6 is checked as an ELF: libc.so.6 is a non-empty regular file
#     whose DT_SONAME is libc.so.6 and whose machine matches the architecture.
# No scanner is run.
#
# Usage: build-glibc-backport.sh <backport-dir> <out-dir>
#   <backport-dir>  directory with this script, series, the patches, smoke-glibc.c
#                   and check-test-result.sh
#   <out-dir>       receives the .debs, glibc-smoke, build-environment.txt and
#                   build-stamp.json
# Honours $TMPDIR for the (large) build tree. Intended for a Debian trixie builder stage.
set -Eeuo pipefail
IFS=$'\n\t'
export LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive SOURCE_DATE_EPOCH=1760486400
log() { printf '[glibc-backport] %s\n' "$*"; }
die() { log "$2"; exit "$1"; }

BACKPORT_DIR="$(cd "${1:?backport dir}" && pwd -P)"
OUT_DIR="${2:?out dir}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"

# Fixed apt index for build dependencies.
APT_SNAPSHOT='20261015T000000Z'
SNAPSHOT_DEBIAN="http://snapshot.debian.org/archive/debian/$APT_SNAPSHOT"
SNAPSHOT_SECURITY="http://snapshot.debian.org/archive/debian-security/$APT_SNAPSHOT"

# Pinned Debian trixie source for the installed glibc 2.41-12+deb13u4.
DSC_SHA256=0915324aa646bb99abfaa9aa6ecb734b30babd28454a3e51f3152912370fbd3e
ORIG_SHA256=f24aa441021121a79266f0d75242706cab8843a47901fefe74527491807f1998
DEBIAN_SHA256=dda4153511bfd543502d18e5bc9323110996fe9c531f14ae3fad6eb17f027c7d
BASE=https://deb.debian.org/debian/pool/main/g/glibc
DSC=glibc_2.41-12+deb13u4.dsc
ORIG=glibc_2.41.orig.tar.xz
DEBIAN=glibc_2.41-12+deb13u4.debian.tar.xz
BASE_VERSION='2.41-12+deb13u4'
TOYBACO_VERSION='2.41-12+deb13u4+toybaco1'
CHANGELOG_DATE='Thu, 15 Oct 2026 00:00:00 +0000'

# Reviewed patch series (official glibc release/2.41/master commits), in order.
SERIES_SHA256=b91cb8d1f64c4f902bb9ef6457a094e30bb3b4c36e6b8ce0186c684bc3e911a4
CHECK_TEST_RESULT_SHA256=9495b6b4e3dfc328d5db2d93aea7b31fab21c765699ca1aefae34f17c919528a
PATCH_SHA256=(
  'a3940397eefc0ea51ca0a84bc06a90236d413a4acf8119087f5c9c94e3fc76ba  0000-resolv-declare-p-class-type-syms.patch'
  '38289cf413002206fb647b6d05981c13535b28d1cde144c03bc032f4dd539e5e  0001-resolv-ns_sprintrrf-class-type.patch'
  'b2d78661fe7b678259914f5d477a379a385a7a09306c0f9229f7db75a447ff3c  0002-resolv-ns_sprintrrf-unknown-records.patch'
  '442c818cb98e2f6574ff31c277574cc524d7ea249cb198d23b3dd4669b513563  0003-resolv-ns_sprintrrf-inet_ntop-failure.patch'
  '30dc13347a8c63383eeb21868f91ce345651b2fd2067aaae75ad1305e0053348  0004-resolv-ns_sprintrrf-cve-2026-5435.patch'
  'aaa730edd654b954bc7f2b82eaadee091d87c47c5ea250a9f579172cfbda6b96  0005-stdlib-strfmon-cve-2026-19499.patch'
)
PATCH_COMMITS=(
  127d20da1c7f55008e723a0b7a3f693256323a2b
  2b789d4ca95c73dc6fc456bf8a767e8b586e2539
  6448c1174ae74756e9db3ba26463a450e38be6c1
  1c77f57252fd8cfeb30c988a001cd1aab172483b
  0e8c56b386d72ba2ddf15784423f2e894c63a241
  5256941bc811248670eda4636dccd0a390d34dec
)
FIX_CVE_2026_5435=0e8c56b386d72ba2ddf15784423f2e894c63a241
FIX_CVE_2026_19499=5256941bc811248670eda4636dccd0a390d34dec
RESOLV_H_PRE=4e03025f418e7236d8e8cd0b2dc19f938f899bbd97d69aa841a5d1290fd194b8
RESOLV_H_POST=046ab85c28e3f8499ff2cdd0cff3b19d8a05273307af1219bb5e0c49e0783cb6
RES_DEBUG_PRE=d25e1eccf6e8b28053a663eaa5eaf78b755e98fe4402398f89e3229eaad2a57b
RES_DEBUG_POST=cc673553d29977916f0fca775a7c82b1ff4b8037d926cb1cfc7e01b58a1f92e6
NS_PRINT_PRE=c8add002f247f56f415f175136d73c98d2ccbf407e0dc77b446cd913a1ac1a70
NS_PRINT_POST=8036a5d9e7de9401994df8d0250919f64e0a89f9bf19785aaa7bbf333f933eec
STRFMON_PRE=6de7a5ee80ed8fdcbd787fec970ae0b23866cd4253f76e299d33721299b69b79
STRFMON_POST=a80f33f4c46fd15ecc59d07d859409375c72e3d0daef5e12ad59f1999e52c799

json_array() {
  local out='' item
  for item in "$@"; do out+="\"$item\","; done
  printf '[%s]' "${out%,}"
}

log 'verifying the reviewed series, patches and helper bytes'
(
  cd "$BACKPORT_DIR"
  printf '%s  %s\n' "$SERIES_SHA256" series "$CHECK_TEST_RESULT_SHA256" check-test-result.sh | sha256sum -c -
  printf '%s\n' "${PATCH_SHA256[@]}" | sha256sum -c -
)
mapfile -t SERIES < <(grep -v '^$' "$BACKPORT_DIR/series")
[ "${#SERIES[@]}" -eq "${#PATCH_COMMITS[@]}" ] || die 3 'series length differs from the reviewed commits'
pinned_patches=()
for entry in "${PATCH_SHA256[@]}"; do
  pinned_patches+=("${entry#*  }")
done
[ "${pinned_patches[*]}" = "${SERIES[*]}" ] || die 3 "series entries differ from the checksum-pinned patches: ${SERIES[*]}"
patch_commits=()
for patch in "${SERIES[@]}"; do
  patch_commits+=("$(sed -n '1s/^From \([0-9a-f]\{40\}\) .*/\1/p' "$BACKPORT_DIR/$patch")")
done
[ "${patch_commits[*]}" = "${PATCH_COMMITS[*]}" ] || die 3 "patch From: headers differ: ${patch_commits[*]}"
[ "${patch_commits[4]}" = "$FIX_CVE_2026_5435" ] || die 3 'CVE-2026-5435 fix commit mismatch'
[ "${patch_commits[5]}" = "$FIX_CVE_2026_19499" ] || die 3 'CVE-2026-19499 fix commit mismatch'

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

log "pinning apt to snapshot.debian.org $APT_SNAPSHOT"
mkdir -p /etc/apt/toybaco-disabled-sources
for source in /etc/apt/sources.list.d/*; do
  [ -e "$source" ] && mv "$source" /etc/apt/toybaco-disabled-sources/
done
: > /etc/apt/sources.list
cat > /etc/apt/sources.list.d/toybaco-snapshot.sources <<EOF
Types: deb deb-src
URIs: $SNAPSHOT_DEBIAN
Suites: trixie trixie-updates
Components: main
Check-Valid-Until: no

Types: deb deb-src
URIs: $SNAPSHOT_SECURITY
Suites: trixie-security
Components: main
Check-Valid-Until: no
EOF
# Drop every index the base image fetched, so only the snapshot can resolve packages.
rm -rf /var/lib/apt/lists/*
APT_OPTS=(-o Acquire::Retries=5 -o Acquire::http::Timeout=120)
dpkg-query -W -f='${Package}=${Version}\n' | LC_ALL=C sort -u > "$work/packages-before.txt"
log 'installing build dependencies from the snapshot'
apt-get "${APT_OPTS[@]}" update -qq --error-on=any
apt-get "${APT_OPTS[@]}" install -y -qq --no-install-recommends \
  ca-certificates curl dpkg-dev quilt patch xz-utils file build-essential binutils >/dev/null
# Same build profile as dpkg-buildpackage below, so no biarch (multilib) packages;
# dpkg-buildpackage re-checks the pinned source's own Build-Depends.
apt-get "${APT_OPTS[@]}" build-dep -y -qq --build-profiles=nobiarch glibc >/dev/null

log "checking that every installed or changed package comes from the $APT_SNAPSHOT index"
# $(FILENAME) is apt's own format field, not a shell expansion.
# shellcheck disable=SC2016
apt-get indextargets --format '$(FILENAME)' 'Created-By: Packages' > "$work/index-files.txt"
[ -s "$work/index-files.txt" ] || die 3 'no snapshot Packages index is present'
index_arch="$(dpkg --print-architecture)"
for suite in trixie trixie-updates trixie-security; do
  grep -q "_${APT_SNAPSHOT}_dists_${suite}_main_binary-${index_arch}_Packages" "$work/index-files.txt" \
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
[ "$snapshot_checked" -gt 0 ] || die 3 'apt installed no build dependency from the snapshot'
LC_ALL=C comm -23 "$work/packages-installed.txt" "$work/snapshot-versions.txt" > "$work/packages-outside-snapshot.txt"
if [ -s "$work/packages-outside-snapshot.txt" ]; then
  log 'installed versions missing from the snapshot index:'; cat "$work/packages-outside-snapshot.txt" >&2
  die 3 "packages outside the $APT_SNAPSHOT snapshot were installed"
fi
log "snapshot check: $snapshot_checked installed or changed packages are in the $APT_SNAPSHOT index"

dpkg-query -W -f='${binary:Package}=${Version}\n' | LC_ALL=C sort > "$OUT_DIR/build-environment.txt"
build_env_sha="$(sha256sum "$OUT_DIR/build-environment.txt" | cut -d' ' -f1)"
build_env_count="$(wc -l < "$OUT_DIR/build-environment.txt" | tr -d ' ')"
log "build environment: $build_env_count packages, sha256 $build_env_sha"

cd "$work"
log 'fetching pinned Debian source'
for f in "$DSC" "$ORIG" "$DEBIAN"; do
  curl -fsSL -o "$f" "$BASE/$f" || curl -fsSL -o "$f" "$SNAPSHOT_DEBIAN/pool/main/g/glibc/$f"
done
printf '%s  %s\n%s  %s\n%s  %s\n' \
  "$DSC_SHA256" "$DSC" "$ORIG_SHA256" "$ORIG" "$DEBIAN_SHA256" "$DEBIAN" | sha256sum -c -

log 'extracting source (applies the Debian series, including git-updates.diff)'
dpkg-source -x "$DSC" src >/dev/null
cd src
[ "$(dpkg-parsechangelog -S Version)" = "$BASE_VERSION" ] \
  || die 3 "unexpected base version: $(dpkg-parsechangelog -S Version)"
pre_rh="$(sha256sum include/resolv.h | cut -d' ' -f1)"
pre_rd="$(sha256sum resolv/res_debug.c | cut -d' ' -f1)"
pre_ns="$(sha256sum resolv/ns_print.c | cut -d' ' -f1)"
pre_sf="$(sha256sum stdlib/strfmon_l.c | cut -d' ' -f1)"
[ "$pre_rh" = "$RESOLV_H_PRE" ] || die 3 "unexpected include/resolv.h preimage: $pre_rh"
[ "$pre_rd" = "$RES_DEBUG_PRE" ] || die 3 "unexpected res_debug.c preimage: $pre_rd"
[ "$pre_ns" = "$NS_PRINT_PRE" ] || die 3 "unexpected ns_print.c preimage: $pre_ns"
[ "$pre_sf" = "$STRFMON_PRE" ] || die 3 "unexpected strfmon_l.c preimage: $pre_sf"

log 'adding the backport series to debian/patches via quilt'
for patch in "${SERIES[@]}"; do
  cp "$BACKPORT_DIR/$patch" "debian/patches/$patch"
  printf '%s\n' "$patch" >> debian/patches/series
done
export QUILT_PATCHES=debian/patches
quilt push -a --fuzz=0 >/dev/null
mapfile -t applied < <(quilt applied | tail -n "${#SERIES[@]}" | sed 's#.*/##')
[ "${applied[*]}" = "${SERIES[*]}" ] || die 3 "quilt applied differs from the series: ${applied[*]}"
post_rh="$(sha256sum include/resolv.h | cut -d' ' -f1)"
post_rd="$(sha256sum resolv/res_debug.c | cut -d' ' -f1)"
post_ns="$(sha256sum resolv/ns_print.c | cut -d' ' -f1)"
post_sf="$(sha256sum stdlib/strfmon_l.c | cut -d' ' -f1)"
[ "$post_rh" = "$RESOLV_H_POST" ] || die 3 "unexpected include/resolv.h postimage: $post_rh"
[ "$post_rd" = "$RES_DEBUG_POST" ] || die 3 "unexpected res_debug.c postimage: $post_rd"
[ "$post_ns" = "$NS_PRINT_POST" ] || die 3 "unexpected ns_print.c postimage: $post_ns"
[ "$post_sf" = "$STRFMON_POST" ] || die 3 "unexpected strfmon_l.c postimage: $post_sf"
grep -q 'tst-strfmon-bug34510' stdlib/Makefile || die 3 'strfmon regression test not registered'

log 'recording the Debian changelog entry (fixed date, reproducible)'
{
  printf 'glibc (%s) trixie; urgency=high\n\n' "$TOYBACO_VERSION"
  printf '  * Backport the official glibc 2.41 stable-branch fixes:\n'
  printf '    - resolv: out-of-bounds write in ns_sprintrrf TSIG printing\n'
  printf '      (CVE-2026-5435), upstream 0e8c56b3 with prerequisites 127d20da,\n'
  printf '      2b789d4c, 6448c117, 1c77f572 from release/2.41/master.\n'
  printf '    - stdlib: buffer overflow in strfmon right-justification padding\n'
  printf '      (CVE-2026-19499), upstream 5256941b from release/2.41/master.\n'
  printf '    See postiz/os-backport/glibc in the Toybaco control repository.\n\n'
  printf ' -- Toybaco <support@toybaco.jp>  %s\n\n' "$CHANGELOG_DATE"
  cat debian/changelog
} > debian/changelog.toybaco
mv debian/changelog.toybaco debian/changelog
[ "$(dpkg-parsechangelog -S Version)" = "$TOYBACO_VERSION" ] \
  || die 3 "changelog bump failed: $(dpkg-parsechangelog -S Version)"

log 'compiling and linking the runtime smoke (executed later against the installed libc)'
smoke_compiles=false
if gcc -O2 -o "$OUT_DIR/glibc-smoke" "$BACKPORT_DIR/smoke-glibc.c" \
    && [ -s "$OUT_DIR/glibc-smoke" ] && [ -x "$OUT_DIR/glibc-smoke" ]; then
  smoke_compiles=true
fi
[ "$smoke_compiles" = true ] || die 5 'runtime smoke was not compiled and linked'
smoke_sha="$(sha256sum "$OUT_DIR/glibc-smoke" | cut -d' ' -f1)"

log "building glibc binary-arch packages ($TOYBACO_VERSION, nobiarch, nocheck)"
build_log="$work/dpkg-buildpackage.log"
if ! DEB_BUILD_OPTIONS="nocheck parallel=$(nproc)" \
    dpkg-buildpackage -B -uc -us --build-profiles=nobiarch >"$build_log" 2>&1; then
  log 'dpkg-buildpackage failed; last lines:'; tail -n 25 "$build_log" >&2; exit 5
fi

log 'checking that no biarch package was built (nobiarch)'
built_packages=()
for deb in "$work"/*.deb; do
  [ -e "$deb" ] || continue
  built="$(dpkg-deb -f "$deb" Package)"
  case "$built" in
    libc6-i386|libc6-dev-i386|libc6-x32|libc6-dev-x32|libc6-amd64|libc6-dev-amd64|lib32*|libx32*|lib64*)
      die 5 "biarch package built despite nobiarch: $built" ;;
  esac
  built_packages+=("$built")
done
[ "${#built_packages[@]}" -gt 0 ] || die 5 'dpkg-buildpackage produced no .deb'

arch="$(dpkg-architecture -qDEB_HOST_ARCH)"
multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"

log 'running the upstream regression test the CVE-2026-19499 fix added'
# Debian's glibc packaging builds in <source>/build-tree/<DEB_HOST_ARCH>-<pass>
# (debian/rules: build-tree := build-tree; DEB_BUILDDIR ?= $(build-tree)/
# $(DEB_HOST_ARCH)-$(curpass); the tree sits next to debian/, which GLIBC_SOURCES
# filters out of the top-level listing). The only pass here is "libc"; "clean"
# removes the tree only before the build. "make test t=..." is a convenience target
# that exits 0 even when the test FAILs, so only the .test-result evidence decides.
builddir="$work/src/build-tree/${arch}-libc"
if ! { [ -d "$builddir" ] && [ -f "$builddir/Makefile" ] && [ -f "$builddir/config.make" ]; }; then
  die 6 "glibc build tree missing or not configured: $builddir"
fi
test_name='stdlib/tst-strfmon-bug34510'
test_log="$work/strfmon-test.log"
result_file="$builddir/$test_name.test-result"
rm -f "$result_file"
if ! LD_PRELOAD='' LANG='' LANGUAGE='' make -C "$builddir" test "t=$test_name" >"$test_log" 2>&1; then
  log "make test for $test_name failed; last lines:"; tail -n 20 "$test_log" >&2; exit 6
fi
[ -x "$builddir/$test_name" ] || die 6 "test binary $test_name was not built"
bash "$BACKPORT_DIR/check-test-result.sh" "$result_file" "$test_name" "$test_log" || exit 6
strfmon_test='PASS'
# Upstream added no regression test with the CVE-2026-5435 fix: 0e8c56b3 and its
# prerequisites 2b789d4c, 6448c117 and 1c77f572 change only resolv/ns_print.c, and the
# prerequisite 127d20da only moves the internal __p_class_syms/__p_type_syms
# declarations from resolv/res_debug.c to include/resolv.h (no exported symbol or ABI
# change), so that ns_print.c can use them.

declare -A deb_name deb_sha
for pkg in libc6 libc-bin; do
  deb="$work/${pkg}_${TOYBACO_VERSION}_${arch}.deb"
  [ -f "$deb" ] || die 5 "$pkg .deb not produced: $(basename "$deb")"
  [ "$(dpkg-deb -f "$deb" Package)" = "$pkg" ] || die 5 "$pkg package field mismatch"
  [ "$(dpkg-deb -f "$deb" Version)" = "$TOYBACO_VERSION" ] || die 5 "$pkg version mismatch"
  [ "$(dpkg-deb -f "$deb" Architecture)" = "$arch" ] || die 5 "$pkg architecture mismatch"
  cp "$deb" "$OUT_DIR/"
  deb_name[$pkg]="$(basename "$deb")"
  deb_sha[$pkg]="$(sha256sum "$OUT_DIR/$(basename "$deb")" | cut -d' ' -f1)"
done

log 'checking the rebuilt libc6 as an ELF (same soname, same machine)'
inspect="$work/inspect-libc6"
dpkg-deb -x "$OUT_DIR/${deb_name[libc6]}" "$inspect"
libc_so="$inspect/usr/lib/$multiarch/libc.so.6"
if ! { [ -f "$libc_so" ] && [ ! -L "$libc_so" ] && [ -s "$libc_so" ]; }; then
  die 5 'rebuilt libc6 lacks a regular libc.so.6'
fi
elf_soname="$(readelf -d "$libc_so" | sed -n 's/.*(SONAME).*\[\(.*\)\]$/\1/p')"
[ "$elf_soname" = 'libc.so.6' ] || die 5 "rebuilt libc.so.6 DT_SONAME is '$elf_soname'"
elf_machine_name="$(readelf -h "$libc_so" | sed -n 's/^ *Machine: *//p')"
case "$arch" in
  amd64) [ "$elf_machine_name" = 'Advanced Micro Devices X86-64' ] && elf_machine=62 ;;
  arm64) [ "$elf_machine_name" = 'AArch64' ] && elf_machine=183 ;;
  *) false ;;
esac || die 5 "rebuilt libc.so.6 machine '$elf_machine_name' does not match $arch"

cat > "$OUT_DIR/build-stamp.json" <<EOF
{
  "cves": ["CVE-2026-5435", "CVE-2026-19499"],
  "source_package": "glibc",
  "base_version": "$BASE_VERSION",
  "installed_fixed": "$TOYBACO_VERSION",
  "architecture": "$arch",
  "series_sha256": "$SERIES_SHA256",
  "applied_series": $(json_array "${applied[@]}"),
  "patch_commits": $(json_array "${patch_commits[@]}"),
  "upstream_fix_commits": {
    "CVE-2026-5435": "${patch_commits[4]}",
    "CVE-2026-19499": "${patch_commits[5]}"
  },
  "patched_files": {
    "include/resolv.h": { "preimage_sha256": "$pre_rh", "postimage_sha256": "$post_rh" },
    "resolv/res_debug.c": { "preimage_sha256": "$pre_rd", "postimage_sha256": "$post_rd" },
    "resolv/ns_print.c": { "preimage_sha256": "$pre_ns", "postimage_sha256": "$post_ns" },
    "stdlib/strfmon_l.c": { "preimage_sha256": "$pre_sf", "postimage_sha256": "$post_sf" }
  },
  "strfmon_regression_test": "$strfmon_test",
  "smoke_compiles": $smoke_compiles,
  "smoke": { "file": "glibc-smoke", "sha256": "$smoke_sha" },
  "elf": { "soname": "$elf_soname", "machine": $elf_machine },
  "build_environment": {
    "apt_snapshot": "$APT_SNAPSHOT",
    "installed_packages_sha256": "$build_env_sha",
    "installed_package_count": $build_env_count,
    "snapshot_checked_packages": $snapshot_checked
  },
  "built_packages": $(json_array "${built_packages[@]}"),
  "debs": {
    "libc6": { "file": "${deb_name[libc6]}", "sha256": "${deb_sha[libc6]}" },
    "libc-bin": { "file": "${deb_name[libc-bin]}", "sha256": "${deb_sha[libc-bin]}" }
  }
}
EOF
log "done: ${deb_name[libc6]}, ${deb_name[libc-bin]}, glibc-smoke + build-stamp.json in $OUT_DIR ($test_name=$strfmon_test)"
