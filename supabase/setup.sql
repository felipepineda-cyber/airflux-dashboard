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

-- A3) Configuración del resumen semanal automático (día/hora/correos,
--     editable desde la página en "Configuración de alerta")
create table if not exists public.config_resumen (
  id int primary key default 1,
  activo boolean not null default false,
  dia int not null default 1,       -- 0=domingo … 6=sábado (hora de Chile)
  hora int not null default 8,      -- 0-23 (hora de Chile)
  correos text not null default '',
  last_sent timestamptz,
  updated_at timestamptz default now()
);
insert into public.config_resumen (id) values (1) on conflict (id) do nothing;
alter table public.config_resumen enable row level security;
drop policy if exists "config_resumen_select" on public.config_resumen;
create policy "config_resumen_select" on public.config_resumen for select using (true);
drop policy if exists "config_resumen_update" on public.config_resumen;
create policy "config_resumen_update" on public.config_resumen for update using (true) with check (id = 1);
drop policy if exists "config_resumen_insert" on public.config_resumen;
create policy "config_resumen_insert" on public.config_resumen for insert with check (id = 1);

-- A4) Destinos de avisos (números CallMeBot, correos y remitente) —
--     se configuran 100% desde la página, sin tocar secretos.
create table if not exists public.config_destinos (
  id int primary key default 1,
  activo boolean not null default false,
  whatsapps text not null default '',      -- "+569xxxx:apikey,+569yyyy:apikey"
  correos text not null default '',        -- "a@x.cl,b@y.cl"
  mail_activo boolean not null default false,
  remitente text not null default '',      -- correo desde el que se envía (Gmail)
  updated_at timestamptz default now()
);
insert into public.config_destinos (id) values (1) on conflict (id) do nothing;
alter table public.config_destinos enable row level security;
drop policy if exists "config_destinos_select" on public.config_destinos;
create policy "config_destinos_select" on public.config_destinos for select using (true);
drop policy if exists "config_destinos_update" on public.config_destinos;
create policy "config_destinos_update" on public.config_destinos for update using (true) with check (id = 1);
drop policy if exists "config_destinos_insert" on public.config_destinos;
create policy "config_destinos_insert" on public.config_destinos for insert with check (id = 1);

-- A5) Respaldo histórico de mediciones: lo escribe el vigilante cada 30 min.
--     Si ThingSpeak falla o cierra, la página lee de aquí automáticamente.
create table if not exists public.mediciones (
  sitio_n int not null,
  ts timestamptz not null,
  temp numeric, pres numeric, hum numeric, mp10 numeric, mp25 numeric,
  primary key (sitio_n, ts)
);
create index if not exists mediciones_sitio_ts on public.mediciones (sitio_n, ts desc);
alter table public.mediciones enable row level security;
drop policy if exists "mediciones_select" on public.mediciones;
create policy "mediciones_select" on public.mediciones for select using (true);
-- (solo el vigilante escribe, con la service key — no se necesitan más políticas)

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

-- Tarea: el resumen semanal se revisa cada hora (envía solo en el
-- día/hora configurados desde la página). MISMOS REEMPLAZOS que arriba.
select cron.schedule(
  'resumen-airflux',
  '5 * * * *',
  $$
  select net.http_post(
    url     := 'https://TU-PROYECTO.supabase.co/functions/v1/resumen',
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
-- Eliminar una tarea si necesitas recrearla:
--   select cron.unschedule('vigilante-airflux');
--   select cron.unschedule('resumen-airflux');
