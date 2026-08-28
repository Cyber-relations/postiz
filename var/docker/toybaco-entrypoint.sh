#!/bin/sh
set -eu

service_pids=''

stop_services() {
  exit_code=$?
  trap '' HUP INT TERM
  trap - EXIT
  if [ -n "$service_pids" ]; then
    kill -TERM $service_pids 2>/dev/null || true
  fi

  for service_pid in $service_pids; do
    wait "$service_pid" 2>/dev/null || true
  done
  exit "$exit_code"
}

trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
trap stop_services EXIT

start_in() {
  service_directory=$1
  shift
  (
    cd "$service_directory"
    exec "$@"
  ) &
  service_pids="$service_pids $!"
}

start_in /app/apps/backend \
  node --experimental-require-module ./dist/apps/backend/src/main.js
start_in /app/apps/orchestrator \
  node --experimental-require-module ./dist/apps/orchestrator/src/main.js
start_in /app/apps/frontend \
  node /app/node_modules/next/dist/bin/next start -p 4200
start_in /app \
  nginx -g 'daemon off; pid /tmp/nginx.pid;'

set +e
wait -n
service_exit=$?
set -e

# A long-lived service exiting cleanly is still a container failure.
if [ "$service_exit" -eq 0 ]; then
  service_exit=1
fi
exit "$service_exit"
