-- ============================================================
-- AirFlux · Setup de Supabase (ejecutar en SQL Editor)
-- Paso A: tabla de control de avisos
-- Paso B: extensiones y tarea programada (cron cada 30 min)
-- ============================================================

-- A) Tabla donde el vigilante registra los avisos enviados
create table if not exists public.alertas_enviadas (
  sitio_n int primary key,
  sitio text,
  enviado_en timestamptz not null
);
alter table public.alertas_enviadas enable row level security;
-- (la función usa la service key, no necesita políticas públicas)

-- B) Extensiones para programar la revisión automática
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tarea: llamar al vigilante cada 30 minutos.
-- ⚠️ REEMPLAZA:
--   TU-PROYECTO  -> la referencia de tu proyecto (Settings → General → Reference ID)
--   TU_ANON_KEY  -> tu anon key (Settings → API Keys)
select cron.schedule(
  'vigilante-airflux',
  '*/30 * * * *',
  $$
  select net.http_post(
    url     := 'https://TU-PROYECTO.supabase.co/functions/v1/vigilante',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer TU_ANON_KEY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Ver tareas programadas:
--   select * from cron.job;
-- Eliminar la tarea si necesitas recrearla:
--   select cron.unschedule('vigilante-airflux');
