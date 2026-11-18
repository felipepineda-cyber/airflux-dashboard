# SenFePin · Privacidad, seguridad, analítica y publicidad

Revisión del 18 de noviembre de 2026. Para ver lo que falta confirmar, corre `node revisar-publicacion.cjs`.

## 1. Estado del proyecto

| Pieza | Cómo funciona | Cómo se supo |
|---|---|---|
| Sitio | HTML estático (`index.html`, `norma.html`), sin compilación, alojado en Vercel; se publica al subir a `main` | Código |
| Datos de sensores | El navegador los pide a la API de ThingSpeak con las *read keys* de cada canal | Ejecución + código |
| Base de datos y acceso | Supabase `stuxspraehjbxyiujsnu`: Auth, tablas `config_*`, `estaciones`, `mediciones`, `admins` y funciones `vigilante`, `resumen` y `viewia-leer` | Código |
| Norma Background | Supabase `txhkpyvknxegqyefjhpb`, tabla `registros` | Código; sus reglas RLS no están en el repositorio |
| Sesión de administrador | Supabase Auth guarda el token en `localStorage` (`sb-…-auth-token`). Los permisos se verifican en la base de datos (RLS + `es_admin()`) | Código |
| Alertas | Servidor: `vigilante` (CallMeBot + Gmail SMTP o FormSubmit). Navegador del administrador: CallMeBot y FormSubmit mientras la página está abierta | Código |

### Lo que guarda el navegador y a quién se conecta

En ejecución local, con los servicios simulados, no se crea ninguna cookie, ni en la primera visita ni al navegar.

**`localStorage`**
- Visitantes: `airflux_cache` y `senfepin_caidos`.
- Según la función que se use: `senfepin_intro_*`, `senfepin_no_medir`, `airflux_estaciones`, `airflux_alertcfg` y `airflux_pbi`.
- Administradores: `sb-…-auth-token`, `airflux_wa`, `airflux_resumen` y `airflux_wa_envmap`. Estas claves se borran al cerrar sesión; la prueba lo verificó.

**Servidores que contacta en la primera visita**
- Fuentes y bibliotecas: Google Fonts, jsDelivr, unpkg, cdn.plot.ly y cdnjs.
- Datos y mapa: Supabase, ThingSpeak y tiles de OpenStreetMap.

**Solo con funciones específicas** (deducido del código)
- `api.bigdatacloud.net`: recibe las coordenadas de una estación, no del visitante.
- `app.powerbi.com`: solo si se configura el informe.
- `api.callmebot.com` y `formsubmit.co`: solo desde el navegador del administrador, para enviar alertas.

## 2. Cambios hechos

| Hallazgo | Cambio | Verificación |
|---|---|---|
| No había enlaces a Privacidad ni a Uso de los datos | Pie de página en el visor y en Norma; enlace en el formulario de administrador y en el de recuperación; aviso antes de registrar destinatarios | Prueba E2E: enlaces visibles en escritorio y móvil |
| No existía política de privacidad | `privacidad.html` v1.0, en borrador mientras falten datos (13 marcas amarillas) | `node revisar-publicacion.cjs` |
| No existía página de uso de los datos | `uso-datos.html`: origen, frecuencia, gráficos, CSV, comparación con la norma, terceros | Revisión visual |
| El % del Resumen comparaba un promedio de varios días y de toda la red con la norma de 24 h | Etiqueta «referencia orientativa» junto al %, subtítulo «promedio de 7 días» y enlace a la explicación | E2E: el texto aparece en el KPI |
| Atribución de OpenStreetMap incompleta | «© colaboradores de OpenStreetMap» con enlace, como exige la licencia ODbL | E2E |
| **`resumen?forzar=1` lo podía llamar cualquiera con la clave pública** (correos masivos a los destinatarios) | Exige sesión de administrador (token de usuario + tabla `admins`). Errores genéricos, sin exponer el remitente | `tests/permisos-funciones.test.mjs` |
| **El público podía editar la tabla `estaciones`** (nombre, coordenadas, canal y *read key*) | `supabase/seguridad_estaciones.sql`: solo administradores editan. El navegador solo guarda cambios con sesión de administrador | Pendiente: ejecutar el SQL |
| `vigilante` se podía ejecutar sin límite (inflaba el histórico) | Secreto opcional `CRON_SECRET`: si existe, solo la tarea programada lo ejecuta | Prueba de permisos |
| Los registros de las funciones podían guardar URLs con teléfono y clave de CallMeBot o correos | Mensajes de error sin URL ni destinatarios | Revisión de código |
| No había recuperación de contraseña | «¿Olvidaste tu contraseña?» y `restablecer.html` con Supabase Auth: respuesta genérica, espera de 60 s, token borrado de la URL, sin analítica, revocación global de sesiones | E2E: 9 casos (ver sección 4) |
| Intentos de acceso repetidos | Espera creciente en la página después de 5 fallos, además del límite de Supabase | E2E |
| Cabeceras de seguridad básicas | HSTS, Referrer-Policy, Permissions-Policy; `no-store` y `no-referrer` en `restablecer.html` | `vercel.json` |
| Sin estadísticas de visitas | `sitio.js`: Vercel Web Analytics sin cookies, URL sin parámetros, eventos con valores acotados, sin vistas de administración ni recuperación, opción para no ser medido y respeto de Global Privacy Control | `tests/sitio-privacidad.test.cjs` + E2E |
| Publicidad | Espacio «Patrocinado» configurable, sin rastreadores. AdSense preparado y desactivado | E2E: no hay solicitudes a redes publicitarias |

## 3. Decisión sobre el banner de cookies

**No se agrega banner.** El sitio no usa cookies, y lo que guarda en `localStorage` sirve solo para que funcione. Vercel Web Analytics, según su documentación, no usa cookies ni identifica a las personas.

Igual hay transparencia y control:
- la política lo explica;
- `privacidad.html#medicion` permite desactivar la medición;
- se respeta Global Privacy Control.

**Si se activa AdSense, esto cambia.** Google exige una plataforma de consentimiento certificada para visitantes del EEE, el Reino Unido y Suiza. Habría que implementar Aceptar, Rechazar y Configurar antes de cargar el script de anuncios.

## 4. Pruebas ejecutadas

- `node --test tests/*.cjs`: 28 pruebas (Excel, PDF, ViewIA y las nuevas de analítica y privacidad), 0 fallos.
- `node --experimental-strip-types --test tests/permisos-funciones.test.mjs`: permisos de `resumen` y `vigilante`.
- E2E con Playwright, con Supabase simulado: 38 comprobaciones en escritorio y móvil.
  - Pie, KPI, ausencia de anuncios y de cookies, descargas.
  - Recuperación: solicitud válida, correo inexistente, límite de solicitudes, enlace vencido, enlace ya usado, cambio de contraseña, revocación global y acceso con la contraseña nueva.
  - Analítica activa y rechazada, mapa y gráficos con la medición rechazada.
  - Ninguna página se desborda en el móvil.

**Limitación:** no se probó contra el Supabase real (sin acceso desde el entorno de pruebas) ni con un correo real.

## 5. Lo que tienes que configurar antes de publicar

**Supabase SenFePin**
1. Ejecutar `supabase/seguridad_estaciones.sql` y `supabase/estadisticas_sitio.sql` en el SQL Editor. El segundo crea los conteos agregados que se ven en Acceso Administradores → Estadísticas.
2. Authentication → URL Configuration:
   - *Site URL*: `https://senfepin.vercel.app`
   - *Redirect URLs*: `https://senfepin.vercel.app/restablecer.html`
3. Authentication → Sign In / Providers: desactivar «Allow new users to sign up». La recuperación queda solo para cuentas existentes.
4. Authentication → Emails → SMTP Settings: configurar un SMTP propio (por ejemplo Resend), con remitente de un dominio verificado. El correo integrado de Supabase tiene un límite muy bajo y no sirve para producción.
5. Authentication → Emails → plantilla «Reset password» en español.
6. Authentication → Providers → Email: *Email OTP Expiration* = 1800 s (30 min) o menos.
7. Authentication → Rate Limits: revisar los límites de envío de correos y de inicio de sesión.
8. Contraseñas: largo mínimo de 10. Activar *Leaked password protection* si el plan lo permite.
9. Publicar las funciones:
   ```bash
   supabase functions deploy resumen --project-ref stuxspraehjbxyiujsnu
   supabase functions deploy vigilante --project-ref stuxspraehjbxyiujsnu
   ```
10. (Recomendado) Crear el secreto `CRON_SECRET` y agregar a las dos tareas de `cron.schedule` la cabecera `'x-cron-secret', '<el mismo valor>'`.

**Supabase Norma Background (`txhkpyvknxegqyefjhpb`)**
- Revisar las reglas RLS de `registros`. El código lee, escribe y borra con la clave pública; si las reglas lo permiten, cualquiera podría leer o borrar bitácoras.

**Vercel**
- Confirmar el plan del proyecto. En Hobby (uso no comercial) no se puede activar publicidad pagada; habría que pasar a Pro o migrar.
- Analytics → Enable. Pegar la ruta del script en `sitio.js` y poner `analitica.activa: true`.
- Los eventos personalizados (ver estación, descargar CSV, cambiar período) requieren plan Pro. En Hobby solo se cuentan visitas, países y páginas.
- Las cifras se consultan en Vercel → proyecto → Analytics.

**AdSense** (cuando corresponda)
1. Plan comercial y política completa.
2. Cuenta de AdSense, agregar el sitio y seguir la verificación que indique la cuenta (fragmento en `<head>` o `ads.txt` con la línea que entrega AdSense).
3. CMP certificada para EEE, Reino Unido y Suiza.
4. Recién después: `adsense.activo: true` y `cliente: "ca-pub-…"`.

**Textos**
- Completar los 13 datos de `node revisar-publicacion.cjs`: responsable, contacto, región de Supabase, operadores de CallMeBot y FormSubmit, garantías de transferencia, plazos y licencia de AirFlux.
