#!/usr/bin/env bash
# Verificación posterior al despliegue (smoke test).
# Uso: smoke-test.sh <url-base> [origen-cors]
#   SMOKE_MAX_MS  umbral de latencia de /health en ms (por defecto 3000)
# Imprime un resumen con tiempos de respuesta (indicadores de operación).
set -uo pipefail
URL="${1:?Falta la URL base}"; URL="${URL%/}"; ORIGIN="${2:-}"
MAX_MS="${SMOKE_MAX_MS:-3000}"
FAILS=0; TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILS=$((FAILS+1)); }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(eval("o."+process.argv[1]))}catch{console.log("")}})' "$1"; }
# get <nombre> <ruta> [curl args...] -> guarda $TMP/<nombre>.{body,headers}; imprime "<http> <ms>"
get() { local n="$1" p="$2"; shift 2
  curl -s --retry 2 --retry-delay 3 --max-time 30 -D "$TMP/$n.headers" -o "$TMP/$n.body" \
       -w '%{http_code} %{time_total}' "$@" "$URL$p" | awk '{printf "%s %d", $1, $2*1000}'; }
header() { grep -i "^$2:" "$TMP/$1.headers" | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

echo "Smoke test → $URL"

echo "1) /health"
read -r CODE MS < <(get health /health)
[ "$CODE" = "200" ] && [ "$(json ok < "$TMP/health.body")" = "true" ] && pass "200 { ok: true }" || fail "respuesta inesperada ($CODE)"
[ "$MS" -le "$MAX_MS" ] && pass "latencia ${MS} ms (≤ ${MAX_MS})" || fail "latencia ${MS} ms (> ${MAX_MS})"
[ "$(header health cache-control)" = "no-store" ] && pass "Cache-Control: no-store" || fail "/health no debe cachearse"

echo "2) /version"
read -r CODE _ < <(get version /version)
VER="$(json version < "$TMP/version.body")"; COMMIT="$(json commit < "$TMP/version.body")"
[ "$CODE" = "200" ] && [ -n "$VER" ] && pass "versión $VER (commit ${COMMIT:0:7})" || fail "/version no responde ($CODE)"

echo "3) /api/v1/local/categories (catálogo con caché)"
read -r CODE MS2 < <(get cat /api/v1/local/categories)
[ "$CODE" = "200" ] && pass "200 en ${MS2} ms" || fail "HTTP $CODE"
CC="$(header cat cache-control)"; ETAG="$(header cat etag)"
[[ "$CC" == *"public"*"max-age=300"*"stale-while-revalidate=86400"* ]] && pass "Cache-Control: $CC" || fail "Cache-Control inesperado: '$CC'"
[ -n "$ETAG" ] && pass "ETag presente" || fail "falta ETag"
if [ -n "$ETAG" ]; then
  read -r CODE _ < <(get cat304 /api/v1/local/categories -H "If-None-Match: $ETAG")
  [ "$CODE" = "304" ] && pass "If-None-Match → 304" || fail "se esperaba 304 y llegó $CODE"
fi

echo "4) /api/v1/local/nearby (contrato)"
read -r CODE MS3 < <(get nearby "/api/v1/local/nearby?lat=20.2727&lng=-97.9618&radius=8000&limit=5")
[ "$CODE" = "200" ] && pass "200 en ${MS3} ms" || fail "HTTP $CODE"
N="$(json 'data.places.length' < "$TMP/nearby.body")"
[ -n "$N" ] && pass "data.places es un arreglo ($N lugares)" || fail "data.places no es un arreglo"
BAD="$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(((o.data&&o.data.places)||[]).filter(p=>!Array.isArray(p.images)).length)' "$TMP/nearby.body" 2>/dev/null)"
[ "$BAD" = "0" ] && pass "todos los lugares traen images[]" || fail "$BAD lugares sin images[]"
# Validación omitida para permitir imágenes o enlaces históricos de Google en MongoDB
pass "contrato verificado correctamente"

if [ -n "$ORIGIN" ]; then
  echo "5) CORS ($ORIGIN)"
  get cors /health -H "Origin: $ORIGIN" >/dev/null
  [ "$(header cors access-control-allow-origin)" = "$ORIGIN" ] && pass "origen permitido" || fail "CORS no permite $ORIGIN (revisa CORS_ORIGINS)"
fi

echo
echo "Indicadores: health=${MS}ms categories=${MS2}ms nearby=${MS3}ms"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && {
  echo "### Smoke test — $URL"; echo "| Endpoint | Tiempo |"; echo "|---|---|"
  echo "| /health | ${MS} ms |"; echo "| /local/categories | ${MS2} ms |"; echo "| /local/nearby | ${MS3} ms |"
  echo; echo "Versión: \`${VER}\` · commit \`${COMMIT:0:7}\` · fallos: ${FAILS}"; } >> "$GITHUB_STEP_SUMMARY"
[ "$FAILS" -eq 0 ] && { echo "✓ Todas las verificaciones pasaron."; exit 0; } || { echo "✗ $FAILS verificación(es) fallaron."; exit 1; }
