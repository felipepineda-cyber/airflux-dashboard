// ============================================================
// AirFlux/SenFePin · Resumen semanal automático (Edge Function)
// Se ejecuta cada hora vía cron. Lee config_resumen (día/hora de
// envío y correos, configurados desde la página) y, cuando toca,
// envía por correo un análisis descriptivo de los últimos 7 días.
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

const f1 = (x: number) => Number.isFinite(x) ? x.toFixed(1) : "—";
function stats(v: number[]) {
  if (!v.length) return { prom: NaN, min: NaN, max: NaN, sd: NaN };
  const prom = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - prom) ** 2, 0) / (v.length - 1)) : NaN;
  return { prom, min: Math.min(...v), max: Math.max(...v), sd };
}

async function cargar7d(s: { canal: number; key: string }) {
  const fin = new Date(), ini = new Date(fin.getTime() - 7 * 24 * 3600000);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  try {
    const r = await fetch(
      `https://api.thingspeak.com/channels/${s.canal}/feeds.json?api_key=${s.key}` +
      `&start=${encodeURIComponent(fmt(ini))}&end=${encodeURIComponent(fmt(fin))}&average=60&round=1`,
    );
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return (j?.feeds ?? []).map((f: Record<string, string>) => ({
      mp10: parseFloat(f.field4), mp25: parseFloat(f.field5),
    }));
  } catch { return []; }
}

function construirResumen(datos: { mp10: number; mp25: number }[][]): string {
  const hoy = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
  const lineas = [`📊 RESUMEN SEMANAL SenFePin — ${hoy} (últimos 7 días)`, ""];
  const g25: number[] = [], g10: number[] = [];
  SITIOS.forEach((s, i) => {
    const v25 = datos[i].map(x => x.mp25).filter(Number.isFinite);
    const v10 = datos[i].map(x => x.mp10).filter(Number.isFinite);
    g25.push(...v25); g10.push(...v10);
    const s25 = stats(v25), s10 = stats(v10);
    const disp = Math.min(100, 100 * datos[i].length / (7 * 24));
    lineas.push(
      `• ${s.nombre} (ID ${s.n}): MP2,5 prom ${f1(s25.prom)} (mín ${f1(s25.min)}, máx ${f1(s25.max)}, σ ${f1(s25.sd)}) µg/m³ · ` +
      `MP10 prom ${f1(s10.prom)} (máx ${f1(s10.max)}) µg/m³ · disponibilidad ${disp.toFixed(0)}%`,
    );
  });
  const t25 = stats(g25), t10 = stats(g10);
  lineas.push("", `🌐 RED COMPLETA: MP2,5 prom ${f1(t25.prom)} µg/m³ · MP10 prom ${f1(t10.prom)} µg/m³ · máximos ${f1(t25.max)} / ${f1(t10.max)} µg/m³`);
  lineas.push("Norma 24h de referencia: MP2,5 = 50 µg/m³ · MP10 = 130 µg/m³.");
  return lineas.join("\n");
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const url = new URL(req.url);
  const forzar = url.searchParams.get("forzar") === "1";   // ?forzar=1 para probar

  const { data: cfg } = await supabase.from("config_resumen").select("*").eq("id", 1).maybeSingle();
  if (!cfg || !cfg.activo) {
    return Response.json({ ok: true, enviado: false, motivo: "resumen desactivado o sin configurar" });
  }
  const correos = (cfg.correos || "").split(",").map((x: string) => x.trim()).filter(Boolean);
  if (!correos.length) return Response.json({ ok: true, enviado: false, motivo: "sin correos" });

  // Día/hora actuales en Chile
  const ahora = new Date();
  const chile = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const coincide = chile.getDay() === Number(cfg.dia) && chile.getHours() === Number(cfg.hora);
  const yaEnviado = cfg.last_sent && (Date.now() - new Date(cfg.last_sent).getTime()) < 20 * 3600000;
  if (!forzar && (!coincide || yaEnviado)) {
    return Response.json({ ok: true, enviado: false, motivo: "fuera de horario o ya enviado", dia_chile: chile.getDay(), hora_chile: chile.getHours() });
  }

  const datos = await Promise.all(SITIOS.map(cargar7d));
  const texto = construirResumen(datos);

  const envios = correos.map((m: string) =>
    fetch(`https://formsubmit.co/ajax/${encodeURIComponent(m)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: "📊 Resumen semanal SenFePin", resumen: texto }),
    }).catch(console.error));
  await Promise.allSettled(envios);

  await supabase.from("config_resumen").update({ last_sent: new Date().toISOString() }).eq("id", 1);
  return Response.json({ ok: true, enviado: true, correos: correos.length });
});
