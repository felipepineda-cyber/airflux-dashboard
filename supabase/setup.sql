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

-- A2) Configuración de alertas compartida: la edita la página SenFePin
--     ("Configuración de alerta") y la lee el vigilante 24/7.
create table if not exists public.config_alertas (
  id int primary key default 1,
  umbral numeric not null default 2,
  reenvio numeric not null default 24,
  plantilla text not null default '🚨 SenFePin: {sitio} (ID {id}) no registra datos desde {fecha} ({tiempo}).',
  updated_at timestamptz default now()
);
insert into public.config_alertas (id) values (1) on conflict (id) do nothing;
alter table public.config_alertas enable row level security;
-- La página usa la anon key: se permite leer y editar solo la fila 1.
drop policy if exists "config_alertas_select" on public.config_alertas;
create policy "config_alertas_select" on public.config_alertas for select using (true);
drop policy if exists "config_alertas_update" on public.config_alertas;
create policy "config_alertas_update" on public.config_alertas for update using (true) with check (id = 1);
drop policy if exists "config_alertas_insert" on public.config_alertas;
create policy "config_alertas_insert" on public.config_alertas for insert with check (id = 1);

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
