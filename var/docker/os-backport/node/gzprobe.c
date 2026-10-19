/* Minimal N-API addon that calls gz* through the system zlib (libz.so.1), used by
 * build-node-shared-zlib.sh as the gzwrite PoC for CVE-2026-85091. It never links
 * zlib statically: the built Node exports no gz*, so the addon's gz* bind to the
 * installed zlib1g (+toybaco1) libz.so.1, which is the point of --shared-zlib.
 *
 * directWritePath() reproduces the exact direct-write failure path of the backport's
 * reproducer (poc_cve_2026_85091.c): a gz handle in store mode ("wb0") over a read-only
 * fd makes gz_comp()'s write() fail on the direct path (len >= state->size). Store mode
 * is used so output is produced and the write() is attempted inside gzwrite() whatever
 * the data compresses to; a compressing handle can buffer a highly compressible 1 MiB
 * input without writing, so the failure would not be reached (observed in run
 * 38830835787). In unpatched 1.3.1 the failure left strm.next_in pointing into the
 * caller's buffer with avail_in > 0; a later gzprintf() after gzclearerr() then derived
 * an out-of-bounds write from that stale pointer. With the +toybaco1 libz the pointer
 * is reset, so the sequence completes cleanly and gzwrite() returns 0. The OOB-vs-clean
 * proof is the builder's ASan reproducer (poc_cve_2026_85091.c) against the patched and
 * unpatched source, not this addon. */
#define NAPI_VERSION 8
#include <node_api.h>
#include "zlib.h"
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define WRITE_SIZE (1024 * 1024)

static napi_value ZlibVersion(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_create_string_utf8(env, zlibVersion(), NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value DirectWritePath(napi_env env, napi_callback_info info) {
  unsigned char *big = malloc(WRITE_SIZE);
  int result = -2;
  if (big) {
    for (int i = 0; i < WRITE_SIZE; i++) big[i] = (unsigned char)(i * 1103515245 + 12345);
    int fd = open("/dev/zero", O_RDONLY);
    if (fd >= 0) {
      gzFile gz = gzdopen(fd, "wb0"); /* store mode: write() is attempted regardless of entropy */
      if (gz) {
        result = gzwrite(gz, big, WRITE_SIZE); /* direct path; gz_comp() write() fails -> 0 */
        gzclearerr(gz);
        gzprintf(gz, "x");                     /* stale-pointer consumer; safe when patched */
        gzclose(gz);
      } else {
        close(fd);
      }
    }
    free(big);
  }
  napi_value out;
  napi_create_int32(env, result, &out);
  return out;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "zlibVersion", NAPI_AUTO_LENGTH, ZlibVersion, NULL, &fn);
  napi_set_named_property(env, exports, "zlibVersion", fn);
  napi_create_function(env, "directWritePath", NAPI_AUTO_LENGTH, DirectWritePath, NULL, &fn);
  napi_set_named_property(env, exports, "directWritePath", fn);
  return exports;
}
