#!/bin/sh
set -eu
umask 077
if [ "$(id -u)" = 0 ]; then
  mkdir -p /app/data/uploads /app/backups /run/nora
  chown node:node /app/data /app/data/uploads /app/backups /run/nora
  if [ -f /run/secrets/groq_api_key ]; then
    gosu node rm -f /run/nora/groq_api_key
    install -m 400 /run/secrets/groq_api_key /run/nora/groq_api_key
    chown node:node /run/nora/groq_api_key
  fi
  export AI_KEY_FILE=/run/nora/groq_api_key
  exec gosu node sh /app/scripts/entrypoint.sh "$@"
fi
if [ "${1:-}" = maintenance ]; then
  while true; do
    npm run maintenance || true
    sleep 86400
  done
fi
npx prisma migrate deploy
exec "$@"
