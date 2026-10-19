#!/usr/bin/env bash
# Rebuild Debian trixie zlib1g from pinned source with the CVE-2026-85091 source
# backport, at the same ABI and architecture as the runtime base image, and prove
# the fix with a native reproducer. Intended to run in a Debian trixie builder
# stage that has apt and a C toolchain. It fetches the exact Debian source
# (checksum-pinned), applies the reviewed adapted patch, bumps the package version
# to +toybaco1, builds the zlib1g .deb, and writes a build stamp consumed by the
# runtime verifier and the classifier. No scanner is run or suppressed here.
#
# Usage: build-zlib1g-backport.sh <backport-dir> <out-dir>
#   <backport-dir>  directory holding this script, the patch, the poc and backport.json
#   <out-dir>       directory to receive the built zlib1g_*.deb and build-stamp.json
set -Eeuo pipefail
IFS=$'\n\t'
export LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive
log() { printf '[zlib-backport] %s\n' "$*"; }

BACKPORT_DIR="$(cd "${1:?backport dir}" && pwd -P)"
OUT_DIR="${2:?out dir}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"
PATCH="$BACKPORT_DIR/toybaco-zlib-gzwrite-cve-2026-85091.patch"
POC="$BACKPORT_DIR/poc_cve_2026_85091.c"

# Pinned Debian trixie source for the exact installed upstream (1.3.1), matching
# the runtime base's zlib1g 1:1.3.dfsg+really1.3.1-1+b1.
DSC_SHA256=ede2791e29c1d3b422f9208bdd7edf040c20445ea1e7453a72037576e64fa197
ORIG_SHA256=60dd315c07f616887caa029408308a018ace66e3d142726a97db164b3b8f69fb
DEBIAN_SHA256=9ed525955ce9fb0c1b39be8ff98f73450dbfc6305a9a27e6149c8972d38a0a9e
BASE=https://deb.debian.org/debian/pool/main/z/zlib
DSC=zlib_1.3.dfsg+really1.3.1-1.dsc
ORIG=zlib_1.3.dfsg+really1.3.1.orig.tar.gz
DEBIAN=zlib_1.3.dfsg+really1.3.1-1.debian.tar.xz
TOYBACO_VERSION='1:1.3.dfsg+really1.3.1-1+toybaco1'
CHANGELOG_DATE='Thu, 15 Oct 2026 00:00:00 +0000'

log 'installing build dependencies'
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl build-essential dpkg-dev debhelper quilt autoconf file xz-utils patch >/dev/null

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
log 'fetching pinned Debian source'
for f in "$DSC" "$ORIG" "$DEBIAN"; do curl -fsSL -o "$f" "$BASE/$f"; done
printf '%s  %s\n%s  %s\n%s  %s\n' \
  "$DSC_SHA256" "$DSC" "$ORIG_SHA256" "$ORIG" "$DEBIAN_SHA256" "$DEBIAN" | sha256sum -c -

log 'verifying the reviewed adapted patch is byte-identical to the shipped copy'
sha256sum -c - <<EOF
2910727aea20ef7b71050e5161a6dfcac2e91788d9c69b32989a6829cfb5435a  $PATCH
43231e593cb129ca032daf80a83d4d86a9f27d2c5155b42d06bd19aebd103d14  $POC
EOF

log 'extracting source (zlib has an empty Debian patch series)'
dpkg-source -x "$DSC" src >/dev/null
cd src
orig_gzwrite_sha="$(sha256sum gzwrite.c | cut -d' ' -f1)"
[ "$orig_gzwrite_sha" = 469b1e58932ea11bdda2a153f6655f7b3c13254240fae157181b49ed1bc93b47 ] \
  || { log "unexpected original gzwrite.c: $orig_gzwrite_sha"; exit 3; }

log 'adding the backport to the Debian patch series via quilt'
mkdir -p debian/patches
cp "$PATCH" debian/patches/toybaco-zlib-gzwrite-cve-2026-85091.patch
printf 'toybaco-zlib-gzwrite-cve-2026-85091.patch\n' >> debian/patches/series
export QUILT_PATCHES=debian/patches
quilt push -a --fuzz=0 >/dev/null
patched_gzwrite_sha="$(sha256sum gzwrite.c | cut -d' ' -f1)"
[ "$patched_gzwrite_sha" = ce2da7e2567c7f3fd361cbdf56bc4354e179c1d91257ea26eeb281cbbe83e1ca ] \
  || { log "unexpected patched gzwrite.c: $patched_gzwrite_sha"; exit 3; }
grep -q 'state->strm.next_in = state->in;' gzwrite.c || { log 'patched marker missing'; exit 3; }

log 'recording the Debian changelog entry'
# A fixed stanza (not dch) keeps the entry, and therefore SOURCE_DATE_EPOCH and
# the .deb timestamps that dpkg-buildpackage derives from it, reproducible.
{
  printf 'zlib (%s) trixie; urgency=high\n\n' "$TOYBACO_VERSION"
  printf '  * Backport upstream df84af25 to fix CVE-2026-85091 (gzwrite/gzvprintf\n'
  printf '    out-of-bounds write). See postiz/os-backport/zlib in the Toybaco\n'
  printf '    control repository.\n\n'
  printf ' -- Toybaco <support@toybaco.jp>  %s\n\n' "$CHANGELOG_DATE"
  cat debian/changelog
} > debian/changelog.toybaco
mv debian/changelog.toybaco debian/changelog
[ "$(dpkg-parsechangelog -S Version)" = "$TOYBACO_VERSION" ] \
  || { log "changelog version bump failed: $(dpkg-parsechangelog -S Version)"; exit 3; }
[ "$(dpkg-parsechangelog -S Date)" = "$CHANGELOG_DATE" ] \
  || { log "changelog date mismatch: $(dpkg-parsechangelog -S Date)"; exit 3; }

log 'native reproducer: build unpatched vs patched, run the PoC under AddressSanitizer'
run_poc() {
  local tag="$1"
  local d="$work/repro-$tag"
  rm -rf "$d"; mkdir -p "$d"; cd "$d"
  tar xzf "$work/$ORIG" --strip-components=1
  [ "$tag" = patched ] && patch -p1 -F0 < "$PATCH" >/dev/null
  CFLAGS='-fsanitize=address -fno-sanitize-recover=all -O1 -g' ./configure --static >/dev/null 2>&1
  make -s libz.a >/dev/null 2>&1
  gcc -fsanitize=address -fno-sanitize-recover=all -O1 -g -I. "$POC" libz.a -o poc
  set +e
  ASAN_OPTIONS=abort_on_error=0:exitcode=99 ./poc >"$d/out" 2>"$d/err"
  echo $? > "$d/rc"
  set -e
}
run_poc unpatched
run_poc patched
unpatched_rc="$(cat "$work/repro-unpatched/rc")"
patched_rc="$(cat "$work/repro-patched/rc")"
asan_before=false; grep -q 'heap-buffer-overflow' "$work/repro-unpatched/err" && asan_before=true
asan_after=true; grep -q 'AddressSanitizer' "$work/repro-patched/err" && asan_after=false
log "reproducer unpatched_exit=$unpatched_rc patched_exit=$patched_rc asan_before=$asan_before asan_after=$asan_after"
if ! { [ "$unpatched_rc" != 0 ] && [ "$patched_rc" = 0 ] && [ "$asan_before" = true ] && [ "$asan_after" = true ]; }; then
  log 'reproducer did not show FAIL-before / PASS-after'; exit 4
fi

cd "$work/src"
log "building zlib1g .deb ($TOYBACO_VERSION)"
# Build only the native-architecture runtime library. The nobiarch profile drops
# the 32/64-bit alternate packages (lib32z1/lib64z1/libn32z1), which is what the
# runtime image needs and which avoids the gcc-multilib build dependency those
# alternates pull in. nocheck skips the upstream test suite for a faster rebuild;
# the fix is proven by the native reproducer above, not by that suite.
build_log="$work/dpkg-buildpackage.log"
if ! DEB_BUILD_OPTIONS="${DEB_BUILD_OPTIONS:+$DEB_BUILD_OPTIONS }nocheck" \
    dpkg-buildpackage -b -uc -us --build-profiles=nobiarch >"$build_log" 2>&1; then
  log 'dpkg-buildpackage failed; last lines:'; tail -n 20 "$build_log" >&2; exit 5
fi
arch="$(dpkg --print-architecture)"
multiarch="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
# Debian .deb file names drop the epoch.
deb="$work/zlib1g_${TOYBACO_VERSION#*:}_${arch}.deb"
[ -f "$deb" ] || { log "zlib1g .deb not produced: $(basename "$deb")"; exit 5; }
[ "$(dpkg-deb -f "$deb" Package)" = zlib1g ] || { log 'built package is not zlib1g'; exit 5; }
[ "$(dpkg-deb -f "$deb" Version)" = "$TOYBACO_VERSION" ] || { log 'built zlib1g version mismatch'; exit 5; }
[ "$(dpkg-deb -f "$deb" Architecture)" = "$arch" ] || { log 'built zlib1g architecture mismatch'; exit 5; }
# Same ABI: the soname symlink and the versioned object file keep the base package's names.
contents="$(dpkg-deb -c "$deb")"
grep -Eq " \./usr/lib/${multiarch}/libz\.so\.1 -> libz\.so\.1\.3\.1\$" <<<"$contents" \
  || { log 'built zlib1g lacks libz.so.1 -> libz.so.1.3.1'; exit 5; }
grep -Eq " \./usr/lib/${multiarch}/libz\.so\.1\.3\.1\$" <<<"$contents" \
  || { log 'built zlib1g lacks libz.so.1.3.1'; exit 5; }
cp "$deb" "$OUT_DIR/"
deb_sha="$(sha256sum "$OUT_DIR/$(basename "$deb")" | cut -d' ' -f1)"

cat > "$OUT_DIR/build-stamp.json" <<EOF
{
  "cve": "CVE-2026-85091",
  "binary_package": "zlib1g",
  "installed_fixed": "$TOYBACO_VERSION",
  "upstream_fix_commit": "df84af25dc1942490e1d1c899a07619152a46148",
  "patched_file_original_sha256": "$orig_gzwrite_sha",
  "patched_file_patched_sha256": "$patched_gzwrite_sha",
  "patched_marker_present": true,
  "reproducer": {
    "unpatched_exit": $unpatched_rc,
    "patched_exit": $patched_rc,
    "asan_overflow_before": $asan_before,
    "asan_clean_after": $asan_after
  },
  "architecture": "$arch",
  "deb": "$(basename "$deb")",
  "deb_sha256": "$deb_sha"
}
EOF
log "done: $(basename "$deb") + build-stamp.json in $OUT_DIR"
