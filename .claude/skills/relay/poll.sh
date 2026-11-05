#!/usr/bin/env bash
# Long-polls the app's HTTP door (POST /agent/relay_poll) until something other than "none"
# arrives, prints one line "<http status> <body>", and exits. "none" answers are not printed, so
# the model runs only when there is something to act on.
#
# Usage: poll.sh <header-file>
#   <header-file> holds one line, "Authorization: Bearer <attachment>", mode 600, outside git.
# Env:   APP_HOST (default preview.slevin.app), or APP_BASE for a whole base URL (tests)
set -u
base="${APP_BASE:-https://${APP_HOST:-preview.slevin.app}}"
header_file="${1:?usage: poll.sh <header-file>}"
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT
fails=0
while :; do
  if status=$(curl -sS --max-time 70 -o "$body_file" -w '%{http_code}' \
      -X POST "$base/agent/relay_poll" \
      -H "@$header_file" -H 'Content-Type: application/json' -d '{}' 2>"$body_file.err"); then
    fails=0
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 5 ]; then
      printf 'pollFailed %s\n' "$(tr -d '\n\r' < "$body_file.err" | head -c 300)"
      rm -f "$body_file.err"
      exit 1
    fi
    sleep $((fails * 2))
    continue
  fi
  body="$(cat "$body_file")"
  if [ "$status" = "200" ] && printf '%s' "$body" | grep -q '"none"'; then
    again=$(printf '%s' "$body" | sed -n 's/.*"pollAgain":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
    sleep "${again:-0}"
    continue
  fi
  rm -f "$body_file.err"
  printf '%s %s\n' "$status" "$body"
  exit 0
done
