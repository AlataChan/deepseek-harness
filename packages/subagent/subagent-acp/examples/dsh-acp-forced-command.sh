#!/bin/bash
# Root-owned forced command. The configuration contains deployment paths and limits, not client input.
set -eu
if (( BASH_VERSINFO[0] < 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] < 1) )); then
  echo 'The ACP supervisor requires Bash 5.1 or newer' >&2
  exit 78
fi
config=/etc/dsh-acp-worker.env
if [ ! -f "$config" ] || [ -L "$config" ] || [ "$(stat -c %u "$config")" != 0 ]; then
  echo 'ACP worker configuration must be a root-owned regular file' >&2
  exit 78
fi
case "$(stat -c %a "$config")" in 444|644) ;; *) echo 'ACP worker configuration must not be writable by its worker' >&2; exit 78 ;; esac
case ${SSH_ORIGINAL_COMMAND-} in ''|dsh-acp) ;; *) echo 'Only the fixed ACP command is accepted' >&2; exit 64 ;; esac
. "$config"
for seconds in "$DSH_ACP_MAX_RUNTIME_SECONDS" "$DSH_ACP_STOP_SECONDS" "$DSH_ACP_CLEANUP_SECONDS"; do
  case $seconds in ''|*[!0-9]*) echo 'ACP worker deadlines must be positive integers' >&2; exit 78 ;; esac
  if [ "${#seconds}" -gt 4 ] || [ "$seconds" -lt 1 ] || [ "$seconds" -gt 3600 ]; then echo 'ACP worker deadline is outside 1..3600 seconds' >&2; exit 78; fi
done
if [ "$DSH_ACP_CLEANUP_SECONDS" -le "$DSH_ACP_STOP_SECONDS" ]; then echo 'Cleanup budget must exceed the unit stop deadline' >&2; exit 78; fi
for path in "$DSH_ACP_NODE" "$DSH_ACP_CLI" "$DSH_ACP_PATCH" "$DSH_ACP_WORKSPACE" "$DSH_ACP_HOME" "$DSH_ACP_DSH_HOME" "$DSH_ACP_TMPDIR"; do
  case $path in /*) ;; *) echo 'ACP worker paths must be absolute' >&2; exit 78 ;; esac
done
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
unit="dsh-acp-$(cat /proc/sys/kernel/random/uuid).service"
child=
relay=
runtime_directory=
exec 3<&0
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  load_state=$(timeout -k 1 "$DSH_ACP_CLEANUP_SECONDS" systemctl --user show "$unit" --property=LoadState --value) || status=1
  if [ "${load_state-}" != not-found ]; then
    timeout -k 1 "$DSH_ACP_CLEANUP_SECONDS" systemctl --user stop "$unit" || status=1
  fi
  for owned_pid in "$child" "$relay"; do
    if [ -n "$owned_pid" ] && kill -0 "$owned_pid" 2>/dev/null; then kill -KILL "$owned_pid" 2>/dev/null || status=1; fi
    if [ -n "$owned_pid" ]; then wait "$owned_pid" 2>/dev/null || :; fi # Reap owned clients; retain the primary status.
  done
  if [ -n "$runtime_directory" ]; then
    rm -f -- "$runtime_directory/stdin" || status=1
    rmdir -- "$runtime_directory" || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
runtime_directory=$(mktemp -d "$XDG_RUNTIME_DIR/dsh-acp.XXXXXX")
mkfifo "$runtime_directory/stdin"
cat <&3 >"$runtime_directory/stdin" &
relay=$!
systemd-run --user --quiet --pipe --wait --collect --unit="$unit" \
  --property=KillMode=control-group --property="RuntimeMaxSec=$DSH_ACP_MAX_RUNTIME_SECONDS" \
  --property="TimeoutStopSec=$DSH_ACP_STOP_SECONDS" --property=NoNewPrivileges=yes \
  --property=UMask=0077 --property="WorkingDirectory=$DSH_ACP_WORKSPACE" \
  --setenv="HOME=$DSH_ACP_HOME" --setenv="DSH_HOME=$DSH_ACP_DSH_HOME" \
  --setenv="TMPDIR=$DSH_ACP_TMPDIR" --setenv=DSH_TELEMETRY_DISABLED=1 \
  "$DSH_ACP_NODE" "$DSH_ACP_CLI" --profile acp --patch "$DSH_ACP_PATCH" <"$runtime_directory/stdin" &
child=$!
exec 3<&-
wait -n "$child" "$relay"
