#!/usr/bin/env bash
# Long-polls the app's HTTP door (POST /agent/relay_poll) until something other than "none"
# arrives, prints one line "<http status> <body>", and exits. "none" answers are not printed, so
# the model runs only when there is something to act on.
#
# Usage: APP_HOST=<host from your start prompt> poll.sh <header-file>
#   <header-file> holds one line, "Authorization: Bearer <attachment>", mode 600, outside git.
# Env:
#   APP_HOST    the app's host, exactly as your start prompt names it (required, no default);
#   APP_BASE    a whole base URL instead (tests only);
#   POLL_DELAY  seconds to wait before the first poll (default 0), so a relay can wait by
#               starting the loop in the background.
# Exits: 0 with a line (a wake, a refusal, a failure status); 1 "pollFailed …" after 5 network
#   errors in a row; 2 bad usage; 3 another poll.sh already runs on this header file.
set -u

if [ -n "${APP_BASE:-}" ]; then
  base="$APP_BASE"
elif [ -n "${APP_HOST:-}" ]; then
  # Take the host alone, even when it comes as a URL ("https://<host>/…").
  APP_HOST=${APP_HOST#https://}; APP_HOST=${APP_HOST%%/*}
  base="https://$APP_HOST"
else
  echo "usage: APP_HOST=<host from your start prompt> poll.sh <header-file>" >&2
  exit 2
fi
header_file="${1:-}"
if [ -z "$header_file" ] || [ ! -r "$header_file" ]; then
  echo "usage: APP_HOST=<host> poll.sh <header-file> (the header file must exist)" >&2
  exit 2
fi
if [ "$(stat -c '%a' "$header_file" 2>/dev/null || stat -f '%Lp' "$header_file")" != "600" ]; then
  echo "the header file must be mode 600 (chmod 600 it)" >&2
  exit 2
fi

# One loop per header file: a second one would end the first one's polls (one open poll per relay).
if ! command -v flock >/dev/null 2>&1; then
  echo "poll.sh needs flock (util-linux), which this machine lacks" >&2
  exit 2
fi
exec 9>"$header_file.lock"
flock -n 9 || { echo "another poll.sh is already running on $header_file" >&2; exit 3; }

body_file="$(mktemp)"
child=""
# Children run in the background and are waited for, so INT and TERM (timeout's) end the loop at once.
stop() { [ -n "$child" ] && kill "$child" 2>/dev/null; exit "$1"; }
trap 'rm -f "$body_file" "$body_file.err" "$body_file.code"' EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
pause() { sleep "$1" & child=$!; wait "$child"; child=""; }

delay="${POLL_DELAY:-0}"
case "$delay" in ''|*[!0-9]*) delay=0 ;; esac
[ "$delay" -gt 0 ] && pause "$delay"

fails=0
while :; do
  started=$(date +%s)
  curl -sS --max-time 70 -o "$body_file" -w '%{http_code}' \
    -X POST "$base/agent/relay_poll" \
    -H "@$header_file" -H 'Content-Type: application/json' -d '{}' \
    >"$body_file.code" 2>"$body_file.err" &
  child=$!
  wait "$child"
  rc=$?
  child=""
  status="$(cat "$body_file.code" 2>/dev/null)"
  # Through the agent proxy a blocked host is exit 56 with 000: a failure, never a status.
  if [ "$rc" -eq 0 ] && [ -n "$status" ] && [ "$status" != "000" ]; then
    fails=0
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 5 ]; then
      printf 'pollFailed %s\n' "$(tr -d '\n\r' < "$body_file.err" | head -c 300)"
      exit 1
    fi
    pause $((fails * 2))
    continue
  fi
  body="$(cat "$body_file")"
  # A none is the key "none": true with no wake; a wake whose text says "none" is still a wake.
  if [ "$status" = "200" ] && printf '%s' "$body" | grep -q '"none":[[:space:]]*true' \
      && ! printf '%s' "$body" | grep -q '"wake"'; then
    again=$(printf '%s' "$body" | sed -n 's/.*"pollAgain":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    next="${again:-0}"
    # A "none" that came back fast (a superseded or cut-short poll) never makes a busy loop.
    if [ $(( $(date +%s) - started )) -lt 5 ] && [ "$next" -lt 2 ]; then next=2; fi
    pause "$next"
    continue
  fi
  printf '%s %s\n' "$status" "$body"
  exit 0
done
