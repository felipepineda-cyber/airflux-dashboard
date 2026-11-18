-- ============================================================
-- SenFePin · Cierra la edición pública de la tabla `estaciones`
-- Ejecutar UNA vez en Supabase (proyecto SenFePin) → SQL Editor → Run.
-- Requiere haber ejecutado antes proteger_configuracion.sql (función es_admin).
--
-- Antes: cualquier visitante con la clave pública podía cambiar nombre,
-- coordenadas, canal de ThingSpeak o read_api_key de una estación.
-- Ahora: el público solo LEE; solo un administrador con sesión (o el
-- vigilante, que usa la clave de servidor) puede modificar.
-- ============================================================

alter table public.estaciones enable row level security;

-- Quita las políticas de escritura anteriores (la de lectura pública se mantiene)
drop policy if exists "estaciones_update" on public.estaciones;
drop policy if exists "estaciones_editar_admin" on public.estaciones;

-- Permisos de tabla: el público ya no escribe
revoke insert, update, delete on public.estaciones from anon;
grant select on public.estaciones to anon, authenticated;
grant update on public.estaciones to authenticated;

-- Solo administradores pueden editar
create policy "estaciones_editar_admin" on public.estaciones
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

notify pgrst, 'reload schema';

-- Comprobación: debe mostrar solo "estaciones_select" y "estaciones_editar_admin"
select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'estaciones';
