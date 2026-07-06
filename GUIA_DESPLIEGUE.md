# 🚀 Guía de despliegue — AirFlux Dashboard

Publicaremos la página en tres servicios (todos con plan gratis):

| Servicio | Rol |
|---|---|
| **GitHub** | Guarda el código (repositorio) |
| **Vercel** | Publica la página web con URL oficial |
| **Supabase** | Vigilante 24/7: revisa sensores cada 30 min y envía WhatsApp aunque nadie tenga la página abierta |

Tiempo total: ~20 minutos.

---

## PARTE 1 — GitHub (subir el código)

1. Entra a https://github.com/new
2. **Repository name**: `airflux-dashboard` · deja **Public** (o Private, Vercel funciona igual) · clic en **Create repository**.
3. En la pantalla del repo nuevo, clic en el enlace **"uploading an existing file"**.
4. Arrastra TODO el contenido de la carpeta `airflux-web` (el archivo `index.html`, `vercel.json`, `GUIA_DESPLIEGUE.md` y la carpeta `supabase`).
   - ⚠️ Si el navegador no permite arrastrar carpetas, sube primero `index.html` y `vercel.json`, y luego usa **Add file → Upload files** navegando a `supabase/functions/vigilante/` con el botón "choose your files" (GitHub crea las carpetas si escribes la ruta en el nombre, p. ej. `supabase/setup.sql`).
5. Abajo, clic en **Commit changes**.

✅ Listo: el código está en `https://github.com/TU-USUARIO/airflux-dashboard`

---

## PARTE 2 — Vercel (publicar la página)

1. Entra a https://vercel.com/new
2. Si es primera vez: **Continue with GitHub** y autoriza.
3. En **Import Git Repository** busca `airflux-dashboard` y clic **Import**.
4. Configuración:
   - **Framework Preset**: `Other`
   - **Build Command**: vacío (no tocar)
   - **Output Directory**: vacío (no tocar)
5. Clic **Deploy**. Espera ~30 segundos.

✅ Tu página queda en `https://airflux-dashboard-XXXX.vercel.app`

**Extras:**
- Cada vez que edites un archivo en GitHub, Vercel republica solo.
- Dominio propio (ej. `monitoreo.airflux.cl`): en Vercel → Settings → Domains → Add, y agrega el registro CNAME que te indique en tu proveedor DNS.

---

## PARTE 3 — Supabase (vigilante 24/7 + WhatsApp)

### 3.1 Activar CallMeBot (si no lo has hecho)
1. Agrega **+34 623 78 95 90** a tus contactos.
2. Envíale por WhatsApp: `I allow callmebot to send me messages`
3. Guarda la **API key** que te responde.

### 3.2 Crear la función "vigilante"
1. Entra a https://supabase.com/dashboard → tu proyecto → **Edge Functions** (menú izquierdo).
2. Clic **Deploy a new function** → **Via Editor** (editor en el navegador).
3. Nombre: `vigilante`.
4. Borra el código de ejemplo y pega TODO el contenido de `supabase/functions/vigilante/index.ts`.
5. Clic **Deploy function**.

### 3.3 Configurar los secretos (número y API key)
1. **Edge Functions → Secrets** (o Settings → Edge Functions).
2. Agrega:
   - `CALLMEBOT_PHONE` = tu número con código de país, ej. `+56912345678`
   - `CALLMEBOT_APIKEY` = la API key de CallMeBot
   (Las claves `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen automáticamente.)

### 3.4 Crear la tabla y programar el cron
1. Menú **SQL Editor** → **New query**.
2. Pega el contenido de `supabase/setup.sql`.
3. **Antes de ejecutar**, reemplaza en el texto:
   - `TU-PROYECTO` → tu Reference ID (Settings → General)
   - `TU_ANON_KEY` → tu anon key (Settings → API Keys)
4. Clic **Run**.

### 3.5 Probar
- En **Edge Functions → vigilante → Test** (o abre en el navegador
  `https://TU-PROYECTO.supabase.co/functions/v1/vigilante` con el header
  `Authorization: Bearer TU_ANON_KEY` usando el botón de test del dashboard).
- Debe responder un JSON con el estado de los 6 sensores.
- Si algún sensor está caído y configuraste los secretos, te llegará el WhatsApp.

✅ Desde ahora Supabase revisa los sensores **cada 30 minutos, 24/7**.

---

## Resumen de URLs finales

| Qué | Dónde |
|---|---|
| Página oficial | `https://airflux-dashboard-XXXX.vercel.app` |
| Código | `https://github.com/TU-USUARIO/airflux-dashboard` |
| Vigilante | `https://TU-PROYECTO.supabase.co/functions/v1/vigilante` |

## Problemas frecuentes

- **No llega el WhatsApp de prueba** → verifica que activaste CallMeBot con el mismo número que pusiste en `CALLMEBOT_PHONE` y que incluye el `+` y código de país.
- **El cron no corre** → SQL Editor: `select * from cron.job;` debe mostrar `vigilante-airflux`. Revisa que las extensiones `pg_cron` y `pg_net` estén activas (Database → Extensions).
- **La página no muestra datos** → es un problema de ThingSpeak o de las keys de lectura; abre la consola del navegador (F12) y mándame el error.
