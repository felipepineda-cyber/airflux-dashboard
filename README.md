# 🌫️ SenFePin — Dashboard de monitoreo de calidad del aire (red AirFlux)

Monitoreo en tiempo real de 6 estaciones de material particulado en Chile:
Calama, La Ligua, Yungay, Copiapó, Pto Montt y Curacaví.

**Página publicada en Vercel** · **Datos de ThingSpeak** · **Automatización en Supabase**

---

## Arquitectura

```
 Sensores ──> ThingSpeak (canales 3295963-68)
                  │ (fuente primaria, promedios horarios)
                  ▼
 ┌─ index.html (SPA, Vercel) ─────────────────────────────┐
 │  Resumen · Puntos · Estadísticas · Variación temporal   │
 │  Centro de descargas · Power BI · Alertas · Config      │
 │  Respaldo de datos: Supabase 'mediciones' → caché local │
 └───────────────────────┬─────────────────────────────────┘
                          │ config compartida (anon key)
                          ▼
 Supabase ── tablas: config_alertas · config_destinos · config_resumen
          ── tabla:  mediciones  (archivo histórico propio, respaldo)
          ── tabla:  alertas_enviadas (control anti-spam)
          ── Edge Functions (cron):
             · vigilante (cada 30 min): detecta sensores caídos, archiva
               mediciones y envía WhatsApp (CallMeBot) + correo
             · resumen (cada hora): envía el resumen semanal el día/hora
               configurados
```

| Archivo | Rol |
|---|---|
| `index.html` | Toda la aplicación web (HTML+CSS+JS comentado por secciones) |
| `norma.html` | App "Norma Background" (bitácoras USACH · In-Data) |
| `supabase/setup.sql` | Tablas, políticas y tareas cron (ejecutar en SQL Editor) |
| `supabase/functions/vigilante/index.ts` | Vigilante 24/7 + archivador de mediciones |
| `supabase/functions/resumen/index.ts` | Resumen semanal por correo |
| `vercel.json` | Configuración de despliegue |
| `GUIA_DESPLIEGUE.md` | Guía paso a paso de instalación |

## Resiliencia (por qué "no se cae")

1. **Red**: toda consulta tiene timeout de 15 s y 2 intentos con espera creciente.
2. **Respaldo en cascada** si ThingSpeak no responde:
   ThingSpeak → tabla `mediciones` de Supabase (archivada por el vigilante
   cada 30 min) → datos ya cargados en memoria → caché `localStorage` de la
   última carga exitosa. La página siempre muestra la mejor copia disponible
   y avisa con un banner amarillo cuando está en modo respaldo.
3. **Alertas**: el vigilante corre en Supabase aunque nadie abra la página;
   anti-spam configurable (1 aviso por sensor cada N horas, se rearma al volver).
4. **Config en la nube**: umbrales, mensajes, destinos y horarios viven en
   Supabase; el navegador solo mantiene una copia local de respaldo.

## Limitaciones conocidas (servicios gratuitos)

| Servicio | Límite | Impacto real |
|---|---|---|
| ThingSpeak (free) | 8.000 registros/consulta; ~1 req/s | Períodos >45 días se muestran como promedios diarios |
| Supabase (free) | El proyecto se **pausa tras ~7 días sin actividad** | El cron cada 30 min lo mantiene activo; si se pausa, reactivar en el dashboard |
| Vercel (hobby) | 100 GB de tráfico/mes | Sobra para este uso |
| CallMeBot | Servicio de terceros sin garantía; API key por número | Si cae, migrar a WhatsApp Cloud API (Meta) |
| FormSubmit | Confirmación inicial por correo; límites blandos | Configurar remitente Gmail (SMTP) lo evita |
| Gmail SMTP | ~500 correos/día | Sobra para alertas y resúmenes |
| Seguridad | Las claves públicas (anon key, keys de lectura ThingSpeak, API keys de CallMeBot) son visibles para quien inspeccione la página | Riesgo bajo (solo lectura / mensajes al propio número); para cerrarlo: Supabase Auth (fase 2) |

## Checklist para operar 1 año sin problemas

- [ ] Ejecutar `supabase/setup.sql` completo (tablas A1–A5 + crons B).
- [ ] Desplegar las 2 Edge Functions y verificar que respondan (botón Test).
- [ ] Configurar remitente Gmail + secreto `GMAIL_APP_PASSWORD` (correo propio).
- [ ] **Mensual**: abrir la página y revisar el banner de estado; en Supabase →
      Database ver que `mediciones` siga creciendo; en Logs de las funciones
      revisar errores.
- [ ] **Supabase free se pausa si no hay actividad**: el cron lo evita, pero si
      llega correo de "project paused", reactivarlo (1 clic). Alternativa
      definitiva: plan Pro (~US$25/mes) o un ping externo (UptimeRobot, gratis).
- [ ] Renovar nada: ni GitHub, ni Vercel, ni ThingSpeak requieren renovación.
- [ ] Respaldo del código: está en GitHub; respaldo de datos: tabla `mediciones`
      (exportable a CSV desde el SQL Editor cuando se quiera).

## Desarrollo

Editar `index.html` (el JS está comentado por secciones numeradas),
commit y push: Vercel republica solo.

```bash
git add . && git commit -m "descripción del cambio" && git push
```
