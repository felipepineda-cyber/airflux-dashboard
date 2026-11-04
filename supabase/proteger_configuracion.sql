-- ============================================================
-- SenFePin · Protección de la configuración (solo administradores)
-- Ejecutar UNA vez en Supabase → SQL Editor, DESPUÉS de crear tu usuario
-- en Authentication → Users. Es idempotente: se puede correr de nuevo.
--
-- Qué hace:
--   · Crea la lista de administradores (tabla "admins", por correo).
--   · config_alertas: cualquiera puede LEER (umbral y plantilla, no es secreto),
--     pero solo un administrador puede CAMBIARLA.
--   · config_destinos y config_resumen (correos, remitente, números y claves):
--     ni leer ni escribir para el público; solo administradores.
--   · El vigilante y el resumen usan la service key, que se salta estas reglas,
--     así que siguen funcionando igual.
-- ============================================================

-- 1) Lista de administradores
create table if not exists public.admins (
  email text primary key,
  creado_en timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon;
grant select on public.admins to authenticated;
drop policy if exists "admins_ver_propio" on public.admins;
create policy "admins_ver_propio" on public.admins for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 2) ¿La persona con sesión iniciada es administradora?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to anon, authenticated;

-- 3) Quitar TODAS las políticas anteriores de las tres tablas de configuración
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('config_alertas', 'config_destinos', 'config_resumen')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

alter table public.config_alertas enable row level security;
alter table public.config_destinos enable row level security;
alter table public.config_resumen enable row level security;

-- 4) Permisos de tabla: el público ya no escribe ni lee lo privado
revoke all on public.config_destinos from anon;
revoke all on public.config_resumen from anon;
revoke insert, update, delete on public.config_alertas from anon;
grant select on public.config_alertas to anon;
grant select, insert, update on public.config_alertas to authenticated;
grant select, insert, update on public.config_destinos to authenticated;
grant select, insert, update on public.config_resumen to authenticated;

-- 5) Políticas nuevas
-- config_alertas: lectura pública, escritura solo admin
create policy "config_alertas_leer" on public.config_alertas
  for select to anon, authenticated using (true);
create policy "config_alertas_crear" on public.config_alertas
  for insert to authenticated with check (public.es_admin() and id = 1);
create policy "config_alertas_editar" on public.config_alertas
  for update to authenticated using (public.es_admin()) with check (public.es_admin() and id = 1);

-- config_destinos: todo solo admin
create policy "config_destinos_leer" on public.config_destinos
  for select to authenticated using (public.es_admin());
create policy "config_destinos_crear" on public.config_destinos
  for insert to authenticated with check (public.es_admin() and id = 1);
create policy "config_destinos_editar" on public.config_destinos
  for update to authenticated using (public.es_admin()) with check (public.es_admin() and id = 1);

-- config_resumen: todo solo admin
create policy "config_resumen_leer" on public.config_resumen
  for select to authenticated using (public.es_admin());
create policy "config_resumen_crear" on public.config_resumen
  for insert to authenticated with check (public.es_admin() and id = 1);
create policy "config_resumen_editar" on public.config_resumen
  for update to authenticated using (public.es_admin()) with check (public.es_admin() and id = 1);

notify pgrst, 'reload schema';

-- 6) Resultado. Si dice 0 administradores, agrega tu correo con la línea de abajo
--    (cámbiala por el correo con el que creaste tu usuario) y corre solo esa línea:
--    insert into public.admins (email) values ('tu-correo@ejemplo.com') on conflict do nothing;
select 'OK: configuración protegida. Administradores registrados: '
       || (select count(*) from public.admins) as resultado;
