#!/usr/bin/env bash
# Espera hasta que GET <url>/version devuelva el commit esperado.
# Uso: wait-for-deploy.sh <url> <commit-sha> [timeout-segundos=900]
# Tolera 502/404/timeouts (Render en frío o compilando la nueva versión).
set -uo pipefail
URL="${1:?Falta la URL base}"; EXPECTED="${2:?Falta el commit esperado}"; TIMEOUT="${3:-900}"
INTERVAL="${WAIT_INTERVAL:-15}"
START=$(date +%s)

json_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]]||"")}catch{console.log("")}})' "$1"; }

while true; do
  BODY="$(curl -s --max-time 30 "${URL%/}/version" || true)"
  COMMIT="$(printf '%s' "$BODY" | json_field commit)"
  ELAPSED=$(( $(date +%s) - START ))
  if [ -n "$COMMIT" ] && [[ "$EXPECTED" == "$COMMIT"* || "$COMMIT" == "$EXPECTED"* ]]; then
    echo "✓ Versión desplegada (${COMMIT:0:7}) tras ${ELAPSED}s."; exit 0
  fi
  echo "… esperando despliegue (${ELAPSED}s) — sirviendo: ${COMMIT:-sin respuesta}, esperado: ${EXPECTED:0:7}"
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then echo "✗ Tiempo agotado (${TIMEOUT}s)."; exit 1; fi
  sleep "$INTERVAL"
done
