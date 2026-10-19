#!/usr/bin/env bash
# Decide whether one glibc test passed, from its evidence rather than from the
# exit status of "make test" (that convenience target exits 0 even when the test
# FAILs or is UNSUPPORTED). PASS only when:
#   - the .test-result file exists and its first line is exactly "PASS: <name>",
#   - it contains no FAIL/UNSUPPORTED/XFAIL/XPASS/ERROR result line,
#   - the make output printed the same "PASS: <name>" line.
# Exit 0 on PASS, 6 otherwise (with the reason on stderr).
#
# Usage: check-test-result.sh <test-result-file> <test-name> <make-log>
set -Eeuo pipefail
result_file="${1:?test-result file}"
test_name="${2:?test name}"
make_log="${3:?make log}"
fail() { printf 'check-test-result: %s: %s\n' "$test_name" "$*" >&2; exit 6; }

[ -f "$result_file" ] || fail 'no .test-result file'
first_line="$(head -n 1 "$result_file")"
[ "$first_line" = "PASS: $test_name" ] || fail "result is '$first_line'"
if grep -Eq '^(FAIL|UNSUPPORTED|XFAIL|XPASS|ERROR):' "$result_file"; then
  fail 'result file carries a non-PASS result line'
fi
[ -f "$make_log" ] || fail 'no make log'
grep -qx "PASS: $test_name" "$make_log" || fail 'make output has no PASS line for the test'
printf 'PASS: %s\n' "$test_name"
