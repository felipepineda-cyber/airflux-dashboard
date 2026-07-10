// ============================================================
// AirFlux · Vigilante 24/7 de sensores (Supabase Edge Function)
// Revisa el último dato de cada sensor en ThingSpeak.
// Si un sensor lleva más de UMBRAL_H horas sin datos, envía el
// aviso por WhatsApp (CallMeBot) y por correo (FormSubmit) a
// TODOS los destinos configurados. Máximo 1 aviso por sensor
// cada REENVIO_H horas (se reinicia cuando el sensor vuelve).
//
// Secretos (Edge Functions → Secrets):
//   CALLMEBOT_DESTINOS = "+56911111111:apikey1,+56922222222:apikey2"
//   EMAIL_DESTINOS     = "correo1@dominio.cl,correo2@dominio.cl"
//   (compatibilidad: CALLMEBOT_PHONE + CALLMEBOT_APIKEY para 1 número)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SITIOS = [
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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resultados: unknown[] = [];

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

  for (const s of SITIOS) {
    // Último dato VÁLIDO del canal: solo cuentan entradas con mediciones
    // reales de MP10/MP2,5 — entradas vacías no mantienen el sensor "en línea".
    // Además, las entradas válidas se ARCHIVAN en la tabla 'mediciones' como
    // respaldo histórico propio (independiente de ThingSpeak).
    let ultimo: Date | null = null;
    const filasArchivo: Record<string, unknown>[] = [];
    try {
      const r = await fetch(
        `https://api.thingspeak.com/channels/${s.canal}/feeds.json?api_key=${s.key}&results=24&timezone=America%2FSantiago`,
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
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

    if (horas > cfg.umbral) {
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
      resultados.push({ sitio: s.nombre, estado: "OK", horas_desde_ultimo_dato: +horas.toFixed(1) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, revisado: new Date().toISOString(), resultados }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
});
