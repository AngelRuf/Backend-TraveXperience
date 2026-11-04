# Propuesta: notificaciones push web (NO implementada)

Librería: [`web-push`](https://www.npmjs.com/package/web-push) (protocolo Web Push + VAPID).

## Variables de entorno
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generar una vez con `npx web-push generate-vapid-keys`) y
`VAPID_SUBJECT=mailto:contacto@dominio.com`.

## Colección MongoDB `PushSubscription`
| Campo | Tipo | Nota |
|---|---|---|
| `userId` | Number (opcional) | id MySQL; null si es anónimo |
| `endpoint` | String, **único** | URL del servicio push del navegador |
| `keys.p256dh`, `keys.auth` | String | claves de la suscripción |
| `userAgent` | String | para depurar |
| `topics` | [String] | ej. `eventos`, `cerca_de_mi`, `itinerario` |
| `lastSuccessAt`, `failures` | Date, Number | |
| `createdAt` | Date | índice TTL opcional (ej. 1 año sin éxito) |

## Rutas
- `GET /push/public-key` — pública; devuelve la clave VAPID pública.
- `POST /push/subscribe` — `optionalAuth`; guarda/actualiza (upsert por `endpoint`).
- `POST /push/unsubscribe` — borra por `endpoint`.
- `POST /admin/push/send` — solo administradores; envía a `topics`/`userId`.

Todas con `Cache-Control: no-store` (ya es el valor por defecto de la API).

## Envío y limpieza
`webpush.sendNotification(subscription, JSON.stringify({ title, body, url, icon }))`.
Si responde 404/410, borrar la suscripción. Envíos en lotes pequeños (`Promise.allSettled`).

## Frontend (PWA)
El Service Worker escucha `push` y `notificationclick`; el cliente pide permiso con
`Notification.requestPermission()` solo tras una acción del usuario, y luego
`registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
iOS solo soporta push con la PWA instalada en la pantalla de inicio (iOS 16.4+).
