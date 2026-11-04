#!/usr/bin/env bash
# Falla si hay credenciales en el repositorio. Revisa SOLO archivos versionados.
set -euo pipefail
cd "$(dirname "$0")/../.."
status=0

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "✗ .env está versionado. Quítalo: git rm --cached .env (y rota sus credenciales)."; status=1
fi

# Patrones de secretos comunes. Se excluyen plantillas, pruebas y documentación.
PATTERNS='AIza[0-9A-Za-z_-]{35}|sk_(live|test)_[0-9A-Za-z]{16,}|whsec_[0-9A-Za-z]{16,}|-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----|mongodb(\+srv)?://[^:/[:space:]]+:[^@[:space:]]+@|api\.render\.com/deploy/srv-[0-9a-z]+\?key='
if git ls-files -z -- . ':!:*.example' ':!:Tests/*' ':!:*.md' ':!:package-lock.json' ':!:uploads/*' ':!:.github/*' ':!:scripts/ci/check-no-secrets.sh' \
   | xargs -0 grep -InE "$PATTERNS" 2>/dev/null; then
  echo "✗ Posibles secretos encontrados (arriba). Muévelos a variables de entorno."; status=1
fi

[ "$status" -eq 0 ] && echo "✓ Sin secretos versionados."
exit "$status"
