#!/usr/bin/env bash
# Lance la Bibliothèque Spirituelle et ouvre le navigateur.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8420}"
node scripts/serve.mjs "$PORT" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
sleep 1
if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/"; fi
wait $SERVER_PID
