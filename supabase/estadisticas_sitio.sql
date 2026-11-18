-- ============================================================
-- SenFePin · Estadísticas del sitio (conteos agregados y anónimos)
-- Ejecutar UNA vez en Supabase (proyecto SenFePin) → SQL Editor → Run.
-- Requiere proteger_configuracion.sql (función es_admin).
--
-- Guarda SOLO conteos por día, evento y valor acotado
-- (ej.: 2026-11-18 · descargar_csv · todos · 12).
-- No guarda IP, navegador, cookies ni ningún identificador de personas.
-- ============================================================

create table if not exists public.estadisticas_sitio (
  dia     date    not null,
  evento  text    not null,
  valor   text    not null default '',
  conteo  integer not null default 0,
  primary key (dia, evento, valor)
);

alter table public.estadisticas_sitio enable row level security;

-- Solo administradores pueden LEER las estadísticas; nadie escribe directo en la tabla
revoke all on public.estadisticas_sitio from anon, authenticated;
grant select on public.estadisticas_sitio to authenticated;
drop policy if exists "estadisticas_leer_admin" on public.estadisticas_sitio;
create policy "estadisticas_leer_admin" on public.estadisticas_sitio
  for select to authenticated using (public.es_admin());

-- Suma 1 a un evento permitido con un valor permitido (cualquier otro se ignora)
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
       (p_evento = 'visita'          and v_valor ~ '^(index|privacidad|uso-datos|norma)$')
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

  -- limpieza: conserva 13 meses
  if extract(minute from now()) = 0 then
    delete from estadisticas_sitio where dia < v_hoy - 400;
  end if;
end;
$$;

revoke all on function public.registrar_evento_sitio(text, text) from public;
grant execute on function public.registrar_evento_sitio(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

-- Comprobación: debe responder "OK"
select 'OK: estadísticas listas' as resultado;
