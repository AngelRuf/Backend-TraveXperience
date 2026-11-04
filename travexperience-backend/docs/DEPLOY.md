# Despliegue y liberación — Backend TraveXperience (Opción B: API en Render)

## Arquitectura del flujo
```
git push / tag vX.Y.Z
      │
      ▼
GitHub Actions ── test ──► build ──► deploy ──► (release si es tag)
                    │         │         │
          secretos+sintaxis   │   Render Deploy Hook (commit exacto)
          + Jest              │         │
                      .tar.gz+sha256    ▼
                      (artefacto)   espera /version == commit
                                        │
                                        ▼
                                  smoke test (/health, /version,
                                  caché+ETag, /local/nearby, CORS)
```
Los workflows están en `.github/workflows/` (`ci-cd.yml` y `rollback.yml`) y los scripts en `scripts/ci/`.

## Configuración única (una sola vez)

**1. Render** (servicio web existente `backend-travexperience`)
- Settings → Build & Deploy → **Auto-Deploy: No** (el despliegue lo dispara el pipeline, tras pasar las pruebas).
- Build Command `npm ci --omit=optional` · Start Command `npm start` · **Health Check Path `/health`**.
- Environment: variables de `.env.example` (ver `render.yaml`). En producción: `NODE_ENV=production`,
  `CORS_ORIGINS=<origen del frontend>`, `API_PUBLIC_URL=https://backend-travexperience.onrender.com/api/v1`.
- Settings → **Deploy Hook**: copia la URL (contiene una clave; es secreta).

**2. GitHub** (Settings → Secrets and variables → Actions)
| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `RENDER_DEPLOY_HOOK_URL` | URL del Deploy Hook de Render |
| Variable | `PROD_URL` | `https://backend-travexperience.onrender.com` |
| Variable | `CORS_TEST_ORIGIN` | origen del frontend (opcional; activa la prueba de CORS) |

Opcional: Settings → Environments → `production` → *Required reviewers* para exigir aprobación manual antes de desplegar.

## Liberar una versión
```bash
npm version patch          # o minor / major: actualiza package.json y crea el commit + tag vX.Y.Z
git push origin main --follow-tags
```
El pipeline corre pruebas, genera el artefacto, despliega, verifica y publica el *Release* con el `.tar.gz`.
La versión desplegada se consulta en `GET /version` → `{ version, commit, ... }`.

## Verificación manual
```bash
bash scripts/ci/smoke-test.sh https://backend-travexperience.onrender.com https://TU-FRONTEND
```

## Si el despliegue falla / recuperar el servicio
1. **Diagnosticar:** Render → Logs; Actions → paso que falló (el resumen del job lo indica).
2. **Revertir:** Actions → *Rollback (re-desplegar versión anterior)* → Run workflow → `ref = v1.0.0` (último tag estable).
   Vuelve a desplegar ese commit exacto y repite el smoke test.
   Alternativa: Render → Events → *Rollback* a un deploy anterior.
3. **Servicio dormido (plan gratuito):** `curl https://backend-travexperience.onrender.com/health` lo despierta (~30–60 s).
4. **Variable mal configurada:** corrígela en Render → *Manual Deploy* → *Clear build cache & deploy*, o re-ejecuta el workflow.
5. **Reconstruir desde cero:** crea un Web Service en Render apuntando al repo, usa los comandos de arriba, copia las
   variables desde `.env.example`, y actualiza `RENDER_DEPLOY_HOOK_URL`.

## Desarrollo local de los scripts
```bash
npm run verify:syntax      # "compilación": sintaxis de todos los .js
npm test                   # requiere JWT_SECRET en el entorno o en .env
npm run build:artifact     # genera dist/*.tar.gz
```
