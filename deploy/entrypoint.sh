#!/bin/sh
# Container entrypoint. Roles: web (default), worker, scheduler, or any command.
set -eu

DATA="${CSI_DATA_DIR:-/data}"
SEED="${CSI_SEED_DIR:-/app/seed-data}"

prepare_data() {
  if [ ! -d "$DATA/companies" ]; then
    echo "first start: copying the curated data from the image into $DATA"
    cp -R "$SEED/companies" "$DATA/companies"
    cp "$SEED/peer-groups.json" "$SEED/discovery.json" "$DATA/"
  fi
  mkdir -p "$DATA/logs" "$DATA/backups" "$DATA/uploads"
}

case "${1:-web}" in
  web)
    prepare_data
    # Refuse to serve data that breaks the rules; then rebuild benchmark.db from the live data.
    npx tsx scripts/validate-data.ts
    npx tsx scripts/seed.ts
    INTERNAL_TOKEN="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
    export INTERNAL_TOKEN
    node_modules/.bin/next start -H "${BIND:-0.0.0.0}" -p "${PORT:-3000}" &
    pid=$!
    trap 'kill -TERM "$pid" 2>/dev/null' TERM INT
    # Public pages were pre-built from the image's data: refresh them from the live data once the server answers.
    i=0
    until node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
      i=$((i + 1))
      [ "$i" -ge 90 ] && { echo "server did not become healthy"; break; }
      sleep 1
    done
    node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/internal/revalidate',{method:'POST',headers:{'x-internal-token':process.env.INTERNAL_TOKEN}}).then(r=>console.log('public pages refreshed from live data:',r.status)).catch(e=>console.error('page refresh failed:',e.message))"
    unset INTERNAL_TOKEN
    wait "$pid"
    ;;
  worker)
    prepare_data
    exec npx tsx scripts/worker.ts
    ;;
  scheduler)
    prepare_data
    exec npx tsx scripts/scheduler.ts
    ;;
  *)
    exec "$@"
    ;;
esac
