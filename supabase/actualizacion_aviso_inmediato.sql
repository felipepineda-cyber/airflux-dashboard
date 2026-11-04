-- ============================================================
-- SenFePin · Actualización: aviso inmediato + reparación de config
-- Ejecutar UNA vez en Supabase → SQL Editor. Es idempotente: se puede
-- correr de nuevo sin romper nada. Termina con el OK explícito.
-- ============================================================

-- 1) Reparar "No se pudo guardar en la nube (¿falta la tabla config_resumen?)"
--    La tabla existe pero está vacía o sin permisos de escritura para la página.
create table if not exists public.config_resumen (
  id int primary key default 1,
  activo boolean not null default false,
  dia int not null default 1,
  hora int not null default 8,
  correos text not null default '',
  last_sent timestamptz,
  updated_at timestamptz default now()
);
insert into public.config_resumen (id) values (1) on conflict (id) do nothing;
alter table public.config_resumen enable row level security;
grant select, insert, update on public.config_resumen to anon, authenticated;
drop policy if exists "config_resumen_select" on public.config_resumen;
create policy "config_resumen_select" on public.config_resumen for select using (true);
drop policy if exists "config_resumen_update" on public.config_resumen;
create policy "config_resumen_update" on public.config_resumen for update using (true) with check (id = 1);
drop policy if exists "config_resumen_insert" on public.config_resumen;
create policy "config_resumen_insert" on public.config_resumen for insert with check (id = 1);

-- Mismo arreglo para los destinos (config_destinos), por si estaba igual.
create table if not exists public.config_destinos (
  id int primary key default 1,
  activo boolean not null default false,
  whatsapps text not null default '',
  correos text not null default '',
  mail_activo boolean not null default false,
  remitente text not null default '',
  updated_at timestamptz default now()
);
insert into public.config_destinos (id) values (1) on conflict (id) do nothing;
alter table public.config_destinos enable row level security;
grant select, insert, update on public.config_destinos to anon, authenticated;
drop policy if exists "config_destinos_select" on public.config_destinos;
create policy "config_destinos_select" on public.config_destinos for select using (true);
drop policy if exists "config_destinos_update" on public.config_destinos;
create policy "config_destinos_update" on public.config_destinos for update using (true) with check (id = 1);
drop policy if exists "config_destinos_insert" on public.config_destinos;
create policy "config_destinos_insert" on public.config_destinos for insert with check (id = 1);

-- 2) Aviso inmediato: columnas nuevas en config_alertas
alter table public.config_alertas add column if not exists inmediato_activo boolean not null default true;
alter table public.config_alertas add column if not exists inmediato_min int not null default 90;
alter table public.config_alertas add column if not exists plantilla_inmediata text;
grant select, insert, update on public.config_alertas to anon, authenticated;

-- 3) Registro del aviso inmediato por estación (evita repetirlo en cada revisión).
--    Solo lo escribe el vigilante con la service key: sin políticas para el público.
create table if not exists public.alertas_inmediatas (
  sitio_n int primary key,
  sitio text,
  enviado_en timestamptz not null default now()
);
alter table public.alertas_inmediatas enable row level security;

notify pgrst, 'reload schema';
select 'OK: config_resumen, config_destinos y aviso inmediato listos' as resultado;
