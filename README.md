# Restream MVP

Base de un servicio de multistreaming: Nginx-RTMP recibe la señal de OBS y sus
webhooks autorizan la emisión; la API guarda la configuración y ejecuta un único
proceso FFmpeg que copia audio y video a cada destino.

## Componentes

- `nginx/nginx.conf`: entrada RTMP en el puerto 1935 y callbacks de publicación.
- `backend/`: API Express/TypeScript, persistencia SQLite con secretos cifrados y
	administración del ciclo de vida de FFmpeg.

El panel Next.js no forma parte de este primer corte. La API incluye endpoints
mínimos para provisionar streams y devolver la configuración de OBS.

## Requisitos y arranque

Usa Node.js 22.13 o posterior, FFmpeg instalado y Nginx compilado con
`nginx-rtmp-module`. Ajusta la ruta de `load_module` en `nginx/nginx.conf` para
la distribución elegida y cambia en ambos callbacks el token de ejemplo por el
mismo valor secreto de `RTMP_WEBHOOK_TOKEN`. La API debe ser alcanzable desde
Nginx como `api:3001`; mantén los callbacks en una red privada.

```sh
cd backend
npm install
export DASHBOARD_API_TOKEN="$(openssl rand -hex 32)"
export RTMP_WEBHOOK_TOKEN="$(openssl rand -hex 32)"
export SECRET_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm run dev
```

En otra terminal, inicia Nginx con `nginx/nginx.conf`. No expongas el endpoint
de aprovisionamiento directamente a Internet: `DASHBOARD_API_TOKEN` es un
token de servicio para este MVP, no sustituye autenticación y autorización por
usuario.

## Provisionar un stream

La URL pública para OBS debe apuntar al host accesible por el streamer; en esta
respuesta `rtmpUrl` usa el host HTTP de la petición como valor inicial. En
producción conviene configurar una URL RTMP pública fija.

```sh
curl -X POST http://localhost:3001/api/streams \
	-H "Authorization: Bearer $DASHBOARD_API_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"ownerId":"user-123","destinations":[{"platform":"twitch","url":"rtmp://live.twitch.tv/app/STREAM_KEY"},{"platform":"youtube","url":"rtmp://a.rtmp.youtube.com/live2/STREAM_KEY"}]}'
```

Las plataformas admitidas por la API son `twitch`, `youtube`, `facebook` y
`custom`. Para Facebook, envía la URL RTMP/RTMPS y la clave que te proporciona
Live Producer como un único campo `url`.

La respuesta contiene `rtmpUrl` y `streamKey`; en OBS configura el servidor
`rtmp://HOST:1935/live` y pega esa clave. `GET /api/streams/user-123` devuelve
de nuevo la clave bajo el mismo token de servicio. No registres ni compartas
las URLs de destino: contienen credenciales.

## Límites conocidos del MVP

- SQLite guarda cifrados con AES-256-GCM tanto la clave de entrada como las
	URLs secretas de destino; `SECRET_ENCRYPTION_KEY` debe persistirse fuera de
	la base de datos y respaldarse de forma segura.
- `-c:v copy -c:a copy` evita recodificar, pero los destinos deben aceptar los
	códecs y el contenedor de entrada. Una falla de FFmpeg se reintenta cinco
	veces y se reporta en el log del backend.
- No hay autenticación de usuarios, gestión de estado visible, cuotas, métricas,
	TLS ni alta disponibilidad. Para producción añade identidad por usuario,
	rate limiting, almacenamiento de secretos administrado, monitoreo y límites
	de recursos por stream.
- `on_publish_done` detiene el relé; también se compara `clientid` para evitar
	que el cierre atrasado de una conexión anterior detenga una reconexión nueva.