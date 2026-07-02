#!/bin/bash
# Starts the API and the web server as sibling processes in one container.
# Either one dying brings the whole container down (so Docker/Synology
# restarts it cleanly) instead of silently running half-broken.
set -e

cd /app/api
npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate

PORT=4000 node /app/api/apps/api/dist/main.js &
API_PID=$!

(cd /app/web && PORT=3000 HOSTNAME=0.0.0.0 node apps/web/server.js) &
WEB_PID=$!

terminate() {
  kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap terminate TERM INT

wait -n "$API_PID" "$WEB_PID"
EXIT_CODE=$?
terminate
wait
exit "$EXIT_CODE"
