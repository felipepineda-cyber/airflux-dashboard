-- ============================================================
-- SenFePin · ViewIA: límite diario de lecturas con IA
-- Ejecutar UNA vez en Supabase → SQL Editor → New query → Run.
-- Guarda solo una huella anónima por persona (no la IP) y cuántas
-- lecturas hizo cada día (hora de Chile).
-- ============================================================

create table if not exists public.viewia_uso (
  dia     date    not null,
  cliente text    not null,
  usos    integer not null default 0,
  primary key (dia, cliente)
);

-- RLS activo y sin políticas: nadie puede leer ni escribir desde el navegador
alter table public.viewia_uso enable row level security;

-- Suma un uso si no se superaron los límites; devuelve true si se permite la lectura
create or replace function public.viewia_registrar_uso(p_cliente text, p_max_cliente int, p_max_total int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy   date := (now() at time zone 'America/Santiago')::date;
  v_total int;
  v_usos  int;
begin
  -- evita que dos lecturas simultáneas se salten el límite total
  perform pg_advisory_xact_lock(hashtext('viewia_uso'));

  select coalesce(sum(usos), 0) into v_total from viewia_uso where dia = v_hoy;
  if v_total >= p_max_total then
    return false;
  end if;

  select usos into v_usos from viewia_uso where dia = v_hoy and cliente = p_cliente;
  if coalesce(v_usos, 0) >= p_max_cliente then
    return false;
  end if;

  insert into viewia_uso (dia, cliente, usos) values (v_hoy, p_cliente, 1)
  on conflict (dia, cliente) do update set usos = viewia_uso.usos + 1;

  -- limpieza: borra días con más de 60 días de antigüedad
  delete from viewia_uso where dia < v_hoy - 60;
  return true;
end;
$$;

-- Solo la función del servidor (service_role) puede usarla
revoke all on function public.viewia_registrar_uso(text, int, int) from public, anon, authenticated;
grant execute on function public.viewia_registrar_uso(text, int, int) to service_role;

-- Para revisar el uso de hoy:
-- select sum(usos) as lecturas_hoy from viewia_uso where dia = (now() at time zone 'America/Santiago')::date;
