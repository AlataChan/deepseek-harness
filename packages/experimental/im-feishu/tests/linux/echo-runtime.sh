#!/bin/sh
# Test-only descriptor/UID probe. This is not a Harness application or admission test.
set -eu
child_pid=''
cleanup() {
  if [ -n "$child_pid" ]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
printf 'identity:%s:%s\n' "$(id -u)" "$$"
while IFS= read -r line; do
  case "$line" in
    ping) printf 'pong\n' ;;
    child)
      /bin/sleep 600 &
      child_pid=$!
      printf 'child:%s\n' "$child_pid"
      ;;
    *) printf 'unsupported\n' ;;
  esac
done
