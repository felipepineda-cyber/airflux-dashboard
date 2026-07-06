// ============================================================
// AirFlux · Vigilante 24/7 de sensores (Supabase Edge Function)
// Revisa el último dato de cada sensor en ThingSpeak.
// Si un sensor lleva más de UMBRAL_H horas sin datos, envía un
// aviso por WhatsApp (CallMeBot). Máximo 1 aviso por sensor
// cada REENVIO_H horas (se reinicia cuando el sensor vuelve).
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

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const phone = Deno.env.get("CALLMEBOT_PHONE") ?? "";
  const apikey = Deno.env.get("CALLMEBOT_APIKEY") ?? "";
  const resultados: unknown[] = [];

  for (const s of SITIOS) {
    // Último dato del canal
    let ultimo: Date | null = null;
    try {
      const r = await fetch(
        `https://api.thingspeak.com/channels/${s.canal}/feeds/last.json?api_key=${s.key}&timezone=America%2FSantiago`,
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j?.created_at) ultimo = new Date(j.created_at);
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

      let avisado = false;
      if (!yaAvisado && phone && apikey) {
        const desde = ultimo
          ? ultimo.toLocaleString("es-CL", { timeZone: "America/Santiago" })
          : "hace más de lo consultable";
        const msg = `🚨 AirFlux: ${s.nombre} (ID ${s.n}) no registra datos desde ${desde}.`;
        await fetch(
          `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(apikey)}`,
        ).catch(console.error);
        await supabase.from("alertas_enviadas").upsert({
          sitio_n: s.n,
          sitio: s.nombre,
          enviado_en: new Date().toISOString(),
        });
        avisado = true;
      }
      resultados.push({
        sitio: s.nombre,
        estado: "CAIDO",
        horas_sin_datos: horas === Infinity ? null : +horas.toFixed(1),
        aviso_enviado_ahora: avisado,
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
