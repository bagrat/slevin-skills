#!/usr/bin/env bash
# Long-polls the app's HTTP door (POST /agent/relay_poll) until a wake or a refusal arrives,
# prints that one JSON line, and exits. "none" answers are not printed, so the model runs only
# when there is something to deliver.
#
# Usage: poll.sh <header-file>
#   <header-file> holds one line, "Authorization: Bearer <attachment>", mode 600, outside git.
# Env:   APP_HOST (default preview.slevin.app)
set -u
host="${APP_HOST:-preview.slevin.app}"
header_file="${1:?usage: poll.sh <header-file>}"
fails=0
started=$(date +%s)
while :; do
  if out=$(curl -sS --max-time 70 -X POST "https://$host/agent/relay_poll" \
      -H "@$header_file" -H 'Content-Type: application/json' -d '{}' 2>&1); then
    fails=0
  else
    fails=$((fails + 1))
    if [ "$fails" -ge 5 ]; then
      printf '{"pollFailed":"%s"}\n' "$(printf '%s' "$out" | tr -d '\n\r"\\' | head -c 300)"
      exit 1
    fi
    sleep $((fails * 2))
    continue
  fi
  case "$out" in
    *'"none"'*)
      again=$(printf '%s' "$out" | sed -n 's/.*"pollAgain":[[:space:]]*\([0-9][0-9]*\).*/\1/p')
      sleep "${again:-0}"
      started=$(date +%s)
      ;;
    *)
      printf 'waited=%s %s\n' "$(( $(date +%s) - started ))" "$out"
      exit 0
      ;;
  esac
done
