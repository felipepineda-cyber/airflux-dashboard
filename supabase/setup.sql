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

-- ============================================================
-- A6) TABLA estaciones — fuente única de verdad de la red
-- ------------------------------------------------------------
-- La leen: index.html (al cargar), el vigilante y el resumen.
-- Cambiar un sensor o un canal = actualizar UNA fila aquí;
-- nunca más se editan IDs en el código.
--
-- NOTA: si ejecutaste una versión anterior de esta tabla (con
-- columna `id serial`), descomenta la línea siguiente; es seguro
-- porque el insert de abajo la repuebla completa.
-- drop table if exists public.estaciones cascade;
-- ============================================================
create table if not exists public.estaciones (
  sitio_n           int primary key,          -- mismo número que usa 'mediciones' (continuidad histórica)
  nombre            text not null,
  lat               numeric,
  lng               numeric,
  canal_thingspeak  bigint not null,
  read_api_key      text,
  sensor_id         text,                     -- ID del equipo instalado (ej. '358'); null = sin registrar
  sensor_anterior   text,                     -- trazabilidad del último reemplazo
  sensor_detectado  text,                     -- lo escribe el vigilante si el equipo publica su propio ID
  fecha_instalacion date,
  estado            text default 'desconocido', -- 'ok' | 'retraso' | 'caido' (lo escribe el vigilante)
  ultima_medicion   timestamptz,                -- último dato válido visto (lo escribe el vigilante)
  activo            boolean not null default true
);

-- Red actual (canales y keys reales; sensor_id se llena al registrar cada equipo,
-- por ejemplo con: update estaciones set sensor_id='358' where sitio_n=4;)
insert into public.estaciones (sitio_n, nombre, lat, lng, canal_thingspeak, read_api_key) values
  (1, 'Calama',    -22.4544, -68.9294, 3295963, 'FFUP0A4K22HLJOHT'),
  (2, 'La Ligua',  -32.4524, -71.2311, 3295964, 'URO7G2P6TJH3CDNF'),
  (3, 'Yungay',    -37.1212, -72.0170, 3295965, 'PYE5M1O5RXTLSILG'),
  (4, 'Copiapó',   -27.3665, -70.3323, 3295966, 'W6RRU2RSFLMNV0CU'),
  (5, 'Pto Montt', -41.4693, -72.9424, 3295967, '93GQ5HLEXVUSWQ88'),
  (6, 'Curacaví',  -33.4011, -71.1443, 3295968, 'NPEK6DL0ME57ZLWB')
on conflict (sitio_n) do nothing;

alter table public.estaciones enable row level security;
-- Mismo criterio que las tablas config_*: la página usa la anon key.
-- (Riesgo documentado en README; se cierra con Supabase Auth en fase 2.)
drop policy if exists "estaciones_select" on public.estaciones;
create policy "estaciones_select" on public.estaciones for select using (true);
drop policy if exists "estaciones_update" on public.estaciones;
create policy "estaciones_update" on public.estaciones for update using (true) with check (true);

-- Continuidad histórica: cada medición archivada guarda con qué sensor se
-- tomó. El histórico queda amarrado a la ESTACIÓN (sitio_n) y no se corta
-- al cambiar el equipo; se puede filtrar por sensor para comparar viejo/nuevo.
alter table public.mediciones add column if not exists sensor_id text;
