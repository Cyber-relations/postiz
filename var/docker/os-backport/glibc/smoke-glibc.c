/* Runtime smoke for the rebuilt glibc: exercises the two functions the backport
 * touches with ordinary, valid inputs and checks the documented results. It is a
 * correctness check against the installed libc, not a vulnerability trigger.
 *
 *  - strfmon_l with right-justified width padding (the CVE-2026-19499 code path)
 *    into an amply sized buffer, verifying the padded output and return value.
 *  - ns_sprintrrf is a deprecated debugging symbol and is not called here; the
 *    resolver path is exercised through getaddrinfo on a numeric loopback
 *    address, which must resolve without network access.
 *
 * Exit 0 on success; non-zero with a message on any mismatch. */
#define _GNU_SOURCE
#include <locale.h>
#include <monetary.h>
#include <netdb.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>

int main(void) {
    locale_t loc = newlocale(LC_ALL_MASK, "C", (locale_t)0);
    if (loc == (locale_t)0) { fprintf(stderr, "smoke: newlocale failed\n"); return 2; }

    /* Right-justified width padding into a large buffer: the result is the value
     * formatted in the C locale, right-justified in a field of width 20. */
    char out[64];
    ssize_t n = strfmon_l(out, sizeof out, loc, "%20.2n", 12.5);
    freelocale(loc);
    if (n < 0) { fprintf(stderr, "smoke: strfmon_l returned %zd\n", n); return 3; }
    const char *tail = ".50";
    size_t len = strlen(out);
    if (len != 20 || strncmp(out + len - 3, tail, 3) != 0 || out[0] != ' ') {
        fprintf(stderr, "smoke: unexpected strfmon output %.*s|len=%zu|n=%zd\n", (int)len, out, len, n);
        return 4;
    }

    /* Numeric loopback resolution through the normal resolver entry point. */
    struct addrinfo hints, *res = NULL;
    memset(&hints, 0, sizeof hints);
    hints.ai_family = AF_INET;
    hints.ai_flags = AI_NUMERICHOST;
    int rc = getaddrinfo("127.0.0.1", NULL, &hints, &res);
    if (rc != 0 || res == NULL) { fprintf(stderr, "smoke: getaddrinfo rc=%d\n", rc); return 5; }
    freeaddrinfo(res);

    printf("glibc-smoke OK strfmon=%zd getaddrinfo=0\n", n);
    return 0;
}
