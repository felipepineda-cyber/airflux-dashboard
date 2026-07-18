// ============================================================
// AirFlux · Vigilante 24/7 de sensores (Supabase Edge Function)
// Revisa el último dato de cada estación en ThingSpeak.
// Si una estación lleva más de UMBRAL_H horas sin datos, envía el
// aviso por WhatsApp (CallMeBot) y por correo a TODOS los destinos
// configurados. Máximo 1 aviso por estación cada REENVIO_H horas
// (se reinicia cuando el sensor vuelve).
//
// NOVEDADES (gestión de sensores sin tocar código):
//  · La red se lee de la tabla `estaciones` (setup.sql, sección A6);
//    la lista embebida SITIOS_FALLBACK queda solo como respaldo.
//  · En cada corrida escribe en `estaciones`: estado
//    ('ok'|'retraso'|'caido'), ultima_medicion y sensor_detectado
//    (si el equipo publica su propio ID en algún field).
//  · Cada medición archivada en `mediciones` guarda el sensor_id
//    registrado: el histórico no se corta al reemplazar un equipo.
//
// Secretos (Edge Functions → Secrets):
//   CALLMEBOT_DESTINOS = "+56911111111:apikey1,+56922222222:apikey2"
//   EMAIL_DESTINOS     = "correo1@dominio.cl,correo2@dominio.cl"
//   (compatibilidad: CALLMEBOT_PHONE + CALLMEBOT_APIKEY para 1 número)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

type Sitio = {
  n: number; nombre: string; canal: number; key: string;
  sensor_id?: string | null;
};

// Respaldo si la tabla `estaciones` no existe o no responde.
const SITIOS_FALLBACK: Sitio[] = [
  { n: 1, nombre: "Calama",    canal: 3295963, key: "FFUP0A4K22HLJOHT" },
  { n: 2, nombre: "La Ligua",  canal: 3295964, key: "URO7G2P6TJH3CDNF" },
  { n: 3, nombre: "Yungay",    canal: 3295965, key: "PYE5M1O5RXTLSILG" },
  { n: 4, nombre: "Copiapó",   canal: 3295966, key: "W6RRU2RSFLMNV0CU" },
  { n: 5, nombre: "Pto Montt", canal: 3295967, key: "93GQ5HLEXVUSWQ88" },
  { n: 6, nombre: "Curacaví",  canal: 3295968, key: "NPEK6DL0ME57ZLWB" },
];

// Valores por defecto — se sobreescriben con la tabla config_alertas,
// editable desde la página SenFePin → "Configuración de alerta".
const DEFAULTS = {
  umbral: 2,    // horas sin datos => sensor caído
  reenvio: 24,  // no repetir aviso del mismo sensor antes de esto
  plantilla: "🚨 SenFePin: {sitio} (ID {id}) no registra datos desde {fecha} ({tiempo}).",
};

function haceCuanto(d: Date | null): string {
  if (!d) return "sin datos";
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h ${min % 60} min`;
  return `hace ${Math.floor(h / 24)} días`;
}

type Destinos = { activo: boolean; whatsapps: { tel: string; key: string }[]; correos: string[]; mailActivo: boolean; remitente: string };

/* Destinos: primero la tabla config_destinos (configurada desde la página);
   los secretos CALLMEBOT_* / EMAIL_DESTINOS quedan como respaldo. */
function parsearDestinos(row: Record<string, unknown> | null): Destinos {
  const wa: { tel: string; key: string }[] = [];
  const fuenteWA = String(row?.whatsapps ?? Deno.env.get("CALLMEBOT_DESTINOS") ?? "");
  for (const par of fuenteWA.split(",")) {
    const idx = par.lastIndexOf(":");
    if (idx > 0) {
      const tel = par.slice(0, idx).trim(), key = par.slice(idx + 1).trim();
      if (tel && key) wa.push({ tel, key });
    }
  }
  const tel = Deno.env.get("CALLMEBOT_PHONE"), key = Deno.env.get("CALLMEBOT_APIKEY");
  if (!wa.length && tel && key) wa.push({ tel, key });
  const correos = String(row?.correos ?? Deno.env.get("EMAIL_DESTINOS") ?? "")
    .split(",").map(x => x.trim()).filter(Boolean);
  return {
    activo: row ? !!row.activo : true,
    whatsapps: wa,
    correos,
    mailActivo: row ? !!row.mail_activo : correos.length > 0,
    remitente: String(row?.remitente ?? ""),
  };
}

/* Correo: si hay remitente + GMAIL_APP_PASSWORD envía desde tu Gmail (SMTP);
   si no, usa FormSubmit (remitente genérico). */
async function enviarCorreos(dest: string[], asunto: string, texto: string, remitente: string) {
  const pass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
  if (remitente && pass) {
    try {
      const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
      const client = new SMTPClient({
        connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
          auth: { username: remitente, password: pass } },
      });
      await client.send({ from: remitente, to: dest, subject: asunto, content: texto });
      await client.close();
      return;
    } catch (e) { console.error("SMTP falló, usando FormSubmit:", e); }
  }
  await Promise.allSettled(dest.map(m =>
    fetch(`https://formsubmit.co/ajax/${encodeURIComponent(m)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: asunto, mensaje: texto }),
    }).catch(console.error)));
}

async function enviarAvisos(msg: string, dst: Destinos) {
  const tareas: Promise<unknown>[] = [];
  for (const d of dst.whatsapps) {
    tareas.push(fetch(
      `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(d.tel)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(d.key)}`,
    ).catch(console.error));
  }
  let n = tareas.length;
  if (dst.mailActivo && dst.correos.length) {
    tareas.push(enviarCorreos(dst.correos, "🚨 Alerta SenFePin — sensor sin datos", msg, dst.remitente));
    n += dst.correos.length;
  }
  await Promise.allSettled(tareas);
  return n;
}

/* ---------- Detección del ID que publica el propio equipo ----------
   1) Busca un field rotulado id/sensor/serie en los metadatos del canal.
   2) Si no hay rótulo, busca un field con valor entero CONSTANTE en los
      feeds (una concentración varía; un ID no). Excluye los fields de
      medición conocidos (1-5: temp/pres/hum/MP10/MP2,5).                */
function detectarIdSensor(channel: Record<string, unknown>, feeds: Record<string, string>[]): string | null {
  let fieldId: string | null = null;
  for (let n = 6; n <= 8; n++) {          // primero los fields libres
    const rotulo = String(channel?.[`field${n}`] ?? "");
    if (/id|sensor|serie/i.test(rotulo)) { fieldId = `field${n}`; break; }
  }
  if (!fieldId) {
    for (let n = 6; n <= 8; n++) {
      const vals = feeds.map(f => f[`field${n}`]).filter(v => v != null && v !== "");
      if (vals.length >= 3 && vals.every(v => v === vals[0]) &&
          Number.isInteger(Number(vals[0]))) { fieldId = `field${n}`; break; }
    }
  }
  if (!fieldId || !feeds.length) return null;
  const v = feeds[feeds.length - 1][fieldId];
  return (v != null && v !== "") ? String(Number(v)) : null;
}

Deno.serve(async () => {
  // Clave de servidor: fallback al secreto SERVICE_KEY (sb_secret_...) en
  // proyectos con el sistema de claves nuevo de Supabase.
  const claveServidor = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_KEY") || "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, claveServidor);
  const resultados: unknown[] = [];

  // Red de estaciones: fuente única de verdad = tabla `estaciones`.
  let sitios: Sitio[] = SITIOS_FALLBACK;
  let fuenteRed = "fallback embebido";
  try {
    const { data, error } = await supabase
      .from("estaciones")
      .select("sitio_n, nombre, canal_thingspeak, read_api_key, sensor_id")
      .eq("activo", true)
      .order("sitio_n");
    if (!error && data?.length) {
      sitios = data.map(e => ({
        n: e.sitio_n, nombre: e.nombre,
        canal: Number(e.canal_thingspeak), key: e.read_api_key ?? "",
        sensor_id: e.sensor_id,
      }));
      fuenteRed = "tabla estaciones";
    }
  } catch (e) { console.warn("Tabla estaciones no disponible, usando fallback:", e); }

  // Configuración compartida (misma que edita la página en "Configuración de alerta")
  let cfg = { ...DEFAULTS };
  try {
    const { data } = await supabase.from("config_alertas").select("*").eq("id", 1).maybeSingle();
    if (data) {
      cfg = {
        umbral: Number(data.umbral) || DEFAULTS.umbral,
        reenvio: Number(data.reenvio) || DEFAULTS.reenvio,
        plantilla: data.plantilla || DEFAULTS.plantilla,
      };
    }
  } catch (e) { console.warn("config_alertas no disponible, usando defaults:", e); }

  // Destinos configurados desde la página (tabla config_destinos)
  let dst = parsearDestinos(null);
  try {
    const { data } = await supabase.from("config_destinos").select("*").eq("id", 1).maybeSingle();
    if (data) dst = parsearDestinos(data);
  } catch (e) { console.warn("config_destinos no disponible, usando secretos:", e); }

  for (const s of sitios) {
    // Último dato VÁLIDO del canal: solo cuentan entradas con mediciones
    // reales de MP10/MP2,5 — entradas vacías no mantienen el sensor "en línea".
    // Además, las entradas válidas se ARCHIVAN en la tabla 'mediciones' como
    // respaldo histórico propio (independiente de ThingSpeak).
    let ultimo: Date | null = null;
    let idReportado: string | null = null;
    const filasArchivo: Record<string, unknown>[] = [];
    try {
      const r = await fetch(
        `https://api.thingspeak.com/channels/${s.canal}/feeds.json?api_key=${s.key}&results=24&timezone=America%2FSantiago`,
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
        idReportado = detectarIdSensor(j?.channel ?? {}, j?.feeds ?? []);
        for (const f of (j?.feeds ?? [])) {
          const mp10 = parseFloat(f.field4), mp25 = parseFloat(f.field5);
          if (!f.created_at || (!Number.isFinite(mp10) && !Number.isFinite(mp25))) continue;
          const t = new Date(f.created_at);
          if (isNaN(t.getTime())) continue;
          if (!ultimo || t > ultimo) ultimo = t;
          filasArchivo.push({
            sitio_n: s.n,
            ts: t.toISOString(),
            temp: parseFloat(f.field1) || null,
            pres: parseFloat(f.field2) || null,
            hum: parseFloat(f.field3) || null,
            mp10: Number.isFinite(mp10) ? mp10 : null,
            mp25: Number.isFinite(mp25) ? mp25 : null,
            sensor_id: s.sensor_id ?? null,   // continuidad: cada dato queda ligado al equipo
          });
        }
      }
    } catch (_) { /* se trata como sin datos */ }

    // Archivar (upsert idempotente: no duplica si ya existe la marca de tiempo)
    if (filasArchivo.length) {
      const { error: errArch } = await supabase.from("mediciones")
        .upsert(filasArchivo, { onConflict: "sitio_n,ts" });
      if (errArch) console.warn("No se pudo archivar mediciones:", errArch.message);
    }

    const horas = ultimo ? (Date.now() - ultimo.getTime()) / 3600000 : Infinity;
    // Estado con tres niveles, mismo criterio visual que la página:
    // ok (dato reciente) · retraso (>1.5 h, aún bajo el umbral) · caido (> umbral)
    const estado = horas > cfg.umbral ? "caido" : horas > 1.5 ? "retraso" : "ok";
    const reemplazoDetectado = !!(idReportado && s.sensor_id && idReportado !== String(s.sensor_id));

    // Publicar diagnóstico en la tabla (la página y la CLI lo leen de aquí)
    if (fuenteRed === "tabla estaciones") {
      const { error: errEst } = await supabase.from("estaciones").update({
        estado,
        ultima_medicion: ultimo ? ultimo.toISOString() : null,
        sensor_detectado: idReportado,
      }).eq("sitio_n", s.n);
      if (errEst) console.warn("No se pudo actualizar estado de estación:", errEst.message);
    }

    if (estado === "caido") {
      // ¿Ya avisamos hace poco?
      const { data } = await supabase
        .from("alertas_enviadas")
        .select("enviado_en")
        .eq("sitio_n", s.n)
        .maybeSingle();
      const yaAvisado = !!data &&
        (Date.now() - new Date(data.enviado_en).getTime()) / 3600000 < cfg.reenvio;

      let enviados = 0;
      if (!yaAvisado && dst.activo) {
        const desde = ultimo
          ? ultimo.toLocaleString("es-CL", { timeZone: "America/Santiago" })
          : "—";
        const msg = cfg.plantilla
          .replaceAll("{sitio}", s.nombre)
          .replaceAll("{id}", String(s.n))
          .replaceAll("{fecha}", desde)
          .replaceAll("{tiempo}", haceCuanto(ultimo));
        enviados = await enviarAvisos(msg, dst);
        if (enviados > 0) {
          await supabase.from("alertas_enviadas").upsert({
            sitio_n: s.n,
            sitio: s.nombre,
            enviado_en: new Date().toISOString(),
          });
        }
      }
      resultados.push({
        sitio: s.nombre,
        estado: "CAIDO",
        horas_sin_datos: horas === Infinity ? null : +horas.toFixed(1),
        avisos_enviados_ahora: enviados,
      });
    } else {
      // Sensor OK: limpiar registro para que una futura caída vuelva a avisar
      await supabase.from("alertas_enviadas").delete().eq("sitio_n", s.n);
      resultados.push({
        sitio: s.nombre,
        estado: estado.toUpperCase(),
        horas_desde_ultimo_dato: +horas.toFixed(1),
        ...(reemplazoDetectado
          ? { aviso: `equipo nuevo detectado (registrado ${s.sensor_id} → reporta ${idReportado}); confirmar en la página o CLI` }
          : {}),
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, revisado: new Date().toISOString(), fuente_red: fuenteRed, resultados }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
