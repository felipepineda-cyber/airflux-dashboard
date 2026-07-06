# 🌫️ AirFlux Dashboard

Monitoreo en tiempo real de la red de sensores de calidad del aire AirFlux
(Calama, La Ligua, Yungay, Copiapó, Pto Montt, Curacaví).

- **Página web** (`index.html`): mapa, alertas, estadísticas, centro de descargas y configuración de avisos WhatsApp. Se publica en Vercel.
- **Vigilante 24/7** (`supabase/functions/vigilante`): Edge Function de Supabase que revisa ThingSpeak cada 30 min y envía WhatsApp (CallMeBot) si un sensor lleva más de 2 h sin registrar datos.
- **`supabase/setup.sql`**: tabla de control + tarea cron.

📖 Instrucciones completas en [GUIA_DESPLIEGUE.md](GUIA_DESPLIEGUE.md).

Datos: ThingSpeak · Frecuencia esperada: promedios de 1 h por sensor.
