-- ============================================================
-- SenFePin · Formulario de contacto (canal de consultas y derechos)
-- Ejecutar UNA vez en Supabase (proyecto SenFePin) → SQL Editor → Run.
-- Requiere proteger_configuracion.sql (es_admin) y estadisticas_sitio.sql.
--
-- · El público solo puede ENVIAR mensajes, a través de la función
--   enviar_mensaje_contacto (valida y limita los envíos).
-- · Solo administradores pueden leer, marcar como respondido o borrar.
-- · Los mensajes cerrados se borran solos a los 12 meses.
-- ============================================================

create table if not exists public.mensajes_contacto (
  id            bigint generated always as identity primary key,
  creado_en     timestamptz not null default now(),
  tipo          text not null,
  nombre        text not null default '',
  correo        text not null,
  mensaje       text not null,
  estado        text not null default 'nuevo',     -- nuevo | respondido
  respondido_en timestamptz,
  origen        text not null default ''          -- huella anónima para limitar envíos (no es la IP)
);

alter table public.mensajes_contacto enable row level security;
revoke all on public.mensajes_contacto from anon, authenticated;
grant select, update, delete on public.mensajes_contacto to authenticated;

drop policy if exists "contacto_leer_admin" on public.mensajes_contacto;
drop policy if exists "contacto_editar_admin" on public.mensajes_contacto;
drop policy if exists "contacto_borrar_admin" on public.mensajes_contacto;
create policy "contacto_leer_admin"   on public.mensajes_contacto for select to authenticated using (public.es_admin());
create policy "contacto_editar_admin" on public.mensajes_contacto for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy "contacto_borrar_admin" on public.mensajes_contacto for delete to authenticated using (public.es_admin());

-- Envío público: valida, limita y guarda. Devuelve 'ok', 'limite' o 'invalido'.
create or replace function public.enviar_mensaje_contacto(p_tipo text, p_nombre text, p_correo text, p_mensaje text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip     text := split_part(coalesce((current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''), ',', 1);
  v_origen text := md5('senfepin-contacto:' || v_ip || ':' || to_char(now() at time zone 'America/Santiago', 'YYYY-MM-DD'));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_msg    text := trim(coalesce(p_mensaje, ''));
begin
  if p_tipo not in ('consulta', 'derechos', 'baja_alertas', 'error_datos')
     or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_correo) > 160
     or length(v_msg) < 10 or length(v_msg) > 2000
     or length(coalesce(p_nombre, '')) > 120 then
    return 'invalido';
  end if;

  -- Límites: 3 por persona al día, 3 por correo al día y 60 en total al día
  if (select count(*) from mensajes_contacto where origen = v_origen) >= 3
     or (select count(*) from mensajes_contacto where correo = v_correo and creado_en > now() - interval '1 day') >= 3
     or (select count(*) from mensajes_contacto where creado_en > now() - interval '1 day') >= 60 then
    return 'limite';
  end if;

  insert into mensajes_contacto (tipo, nombre, correo, mensaje, origen)
  values (p_tipo, trim(coalesce(p_nombre, '')), v_correo, v_msg, v_origen);

  -- Conservación: los respondidos se borran a los 12 meses
  delete from mensajes_contacto where estado = 'respondido' and respondido_en < now() - interval '12 months';
  return 'ok';
end;
$$;

revoke all on function public.enviar_mensaje_contacto(text, text, text, text) from public;
grant execute on function public.enviar_mensaje_contacto(text, text, text, text) to anon, authenticated;

-- Estadísticas: cuenta también las visitas a la página de contacto
create or replace function public.registrar_evento_sitio(p_evento text, p_valor text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy   date := (now() at time zone 'America/Santiago')::date;
  v_valor text := coalesce(p_valor, '');
begin
  if not (
       (p_evento = 'visita'          and v_valor ~ '^(index|privacidad|uso-datos|norma|contacto)$')
    or (p_evento = 'ver_estacion'    and v_valor ~ '^[0-9]{1,3}$')
    or (p_evento = 'descargar_csv'   and v_valor ~ '^(punto|todos|comparacion|disponibilidad|centro_datos|centro_estadisticas)$')
    or (p_evento = 'cambiar_periodo' and v_valor ~ '^(24|48|168|720|2160|hist)$')
    or (p_evento = 'abrir_vista'     and v_valor ~ '^(resumen|estadisticas|variacion|descargas|powerbi)$')
    or (p_evento = 'clic_patrocinio' and v_valor = '')
  ) then
    return;
  end if;
  insert into estadisticas_sitio (dia, evento, valor, conteo) values (v_hoy, p_evento, v_valor, 1)
  on conflict (dia, evento, valor) do update set conteo = estadisticas_sitio.conteo + 1;
  if extract(minute from now()) = 0 then
    delete from estadisticas_sitio where dia < v_hoy - 400;
  end if;
end;
$$;
revoke all on function public.registrar_evento_sitio(text, text) from public;
grant execute on function public.registrar_evento_sitio(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
select 'OK: formulario de contacto listo' as resultado;
