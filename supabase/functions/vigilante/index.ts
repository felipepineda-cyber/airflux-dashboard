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
const UMBRAL_H = 2;    // horas sin datos => sensor caído
const REENVIO_H = 24;  // no repetir aviso del mismo sensor antes de esto

function destinosWhatsApp(): { tel: string; key: string }[] {
  const out: { tel: string; key: string }[] = [];
  for (const par of (Deno.env.get("CALLMEBOT_DESTINOS") ?? "").split(",")) {
    const idx = par.lastIndexOf(":");
    if (idx > 0) {
      const tel = par.slice(0, idx).trim(), key = par.slice(idx + 1).trim();
      if (tel && key) out.push({ tel, key });
    }
  }
  const tel = Deno.env.get("CALLMEBOT_PHONE"), key = Deno.env.get("CALLMEBOT_APIKEY");
  if (tel && key && !out.some(d => d.tel === tel)) out.push({ tel, key });
  return out;
}
function destinosCorreo(): string[] {
  return (Deno.env.get("EMAIL_DESTINOS") ?? "").split(",").map(x => x.trim()).filter(Boolean);
}

async function enviarAvisos(msg: string) {
  const tareas: Promise<unknown>[] = [];
  for (const d of destinosWhatsApp()) {
    tareas.push(fetch(
      `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(d.tel)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(d.key)}`,
    ).catch(console.error));
  }
  for (const m of destinosCorreo()) {
    tareas.push(fetch(`https://formsubmit.co/ajax/${encodeURIComponent(m)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: "🚨 Alerta AirFlux — sensor sin datos", mensaje: msg }),
    }).catch(console.error));
  }
  await Promise.allSettled(tareas);
  return tareas.length;
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resultados: unknown[] = [];

  for (const s of SITIOS) {
    // Último dato VÁLIDO del canal: solo cuentan entradas con mediciones
    // reales de MP10/MP2,5 — entradas vacías no mantienen el sensor "en línea".
    let ultimo: Date | null = null;
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
          if (!isNaN(t.getTime()) && (!ultimo || t > ultimo)) ultimo = t;
        }
      }
    } catch (_) { /* se trata como sin datos */ }

    const horas = ultimo ? (Date.now() - ultimo.getTime()) / 3600000 : Infinity;

    if (horas > UMBRAL_H) {
      // ¿Ya avisamos hace poco?
      const { data } = await supabase
        .from("alertas_enviadas")
        .select("enviado_en")
        .eq("sitio_n", s.n)
        .maybeSingle();
      const yaAvisado = !!data &&
        (Date.now() - new Date(data.enviado_en).getTime()) / 3600000 < REENVIO_H;

      let enviados = 0;
      if (!yaAvisado) {
        const desde = ultimo
          ? ultimo.toLocaleString("es-CL", { timeZone: "America/Santiago" })
          : "hace más de lo consultable";
        enviados = await enviarAvisos(
          `🚨 AirFlux: ${s.nombre} (ID ${s.n}) no registra datos desde ${desde}.`,
        );
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
