#!/usr/bin/env bash
# Genera el artefacto de liberación: dist/travexperience-backend-<version>-<sha7>.tar.gz
# (+ .sha256). Contiene el código listo para desplegar (sin node_modules, sin .env,
# sin uploads) y un build-info.json que identifica la versión.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="$(node -p "require('./package.json').version")"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
SHORT="${SHA:0:7}"
NAME="travexperience-backend-${VERSION}-${SHORT}"

echo "→ Verificando sintaxis..."
node scripts/ci/check-syntax.js

rm -rf dist && mkdir -p "dist/stage/${NAME}"
cp -r index.js package.json package-lock.json .env.example README-B.md src scripts "dist/stage/${NAME}/"

cat > "dist/stage/${NAME}/build-info.json" <<JSON
{
  "name": "travexperience-backend",
  "version": "${VERSION}",
  "commit": "${SHA}",
  "ref": "${GITHUB_REF_NAME:-local}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

tar -czf "dist/${NAME}.tar.gz" -C dist/stage "${NAME}"
rm -rf dist/stage

# El artefacto nunca debe llevar credenciales.
if tar -tzf "dist/${NAME}.tar.gz" | grep -E '(^|/)\.env$'; then
  echo "✗ El artefacto incluye un .env"; exit 1
fi

( cd dist && sha256sum "${NAME}.tar.gz" > "${NAME}.tar.gz.sha256" )
echo "✓ Artefacto: dist/${NAME}.tar.gz ($(du -h "dist/${NAME}.tar.gz" | cut -f1))"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "artifact_name=${NAME}" >> "$GITHUB_OUTPUT"
exit 0
