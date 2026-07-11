// ============================================================
// SenFePin · Resumen semanal en PDF (Supabase Edge Function)
// ------------------------------------------------------------
// - Cron cada hora: cuando coincide el día/hora configurados en
//   config_resumen, genera un PDF con reporte de funcionamiento,
//   estadística descriptiva, resumen diario y gráficos de
//   variación temporal, y lo envía ADJUNTO por correo (SMTP
//   Gmail: remitente de config_destinos + secreto GMAIL_APP_PASSWORD).
// - Sin SMTP configurado: envía la versión texto vía FormSubmit.
// - Parámetros manuales (para los botones de la página):
//     ?forzar=1            → envía ahora, ignorando día/hora
//     ?semanas=2           → adjunta 2 PDFs (semana pasada y antepasada)
// - Gráficos: QuickChart.io (render de Chart.js como PNG, gratuito).
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SITIOS = [
  { n: 1, nombre: "Calama",    canal: 3295963, key: "FFUP0A4K22HLJOHT" },
  { n: 2, nombre: "La Ligua",  canal: 3295964, key: "URO7G2P6TJH3CDNF" },
  { n: 3, nombre: "Yungay",    canal: 3295965, key: "PYE5M1O5RXTLSILG" },
  { n: 4, nombre: "Copiapó",   canal: 3295966, key: "W6RRU2RSFLMNV0CU" },
  { n: 5, nombre: "Pto Montt", canal: 3295967, key: "93GQ5HLEXVUSWQ88" },
  { n: 6, nombre: "Curacaví",  canal: 3295968, key: "NPEK6DL0ME57ZLWB" },
];
const HISTORICO_INICIO = new Date("2026-03-19T00:00:00Z");
const AZUL = rgb(0, 101 / 255, 163 / 255);
const GRIS = rgb(.35, .42, .5);
const ROJO = rgb(.86, .15, .15);

/* ---------- utilidades de datos ---------- */
type Fila = { t: Date; temp: number; pres: number; hum: number; mp10: number; mp25: number };
const f1 = (x: number) => Number.isFinite(x) ? x.toFixed(1) : "-";
function stats(v: number[]) {
  if (!v.length) return { prom: NaN, min: NaN, max: NaN, sd: NaN };
  const prom = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - prom) ** 2, 0) / (v.length - 1)) : NaN;
  return { prom, min: Math.min(...v), max: Math.max(...v), sd };
}
const fmtCL = (d: Date) =>
  d.toLocaleString("es-CL", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const fmtDia = (d: Date) =>
  d.toLocaleDateString("es-CL", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });

// Hora / día de semana / mes / fecha en zona horaria de Chile
const fmtParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Santiago", hour12: false,
  hour: "numeric", weekday: "short", month: "numeric", day: "numeric", year: "numeric",
});
const DIA_IDX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
type Partes = { hora: number; diaSem: number; mes: number; fecha: string };
function partesChileRaw(t: Date): Partes {
  const o: Record<string, string> = {};
  for (const p of fmtParts.formatToParts(t)) o[p.type] = p.value;
  return {
    hora: Number(o.hour) % 24,
    diaSem: DIA_IDX[o.weekday] ?? 0,
    mes: Number(o.month) - 1,
    fecha: `${o.year}-${String(o.month).padStart(2, "0")}-${String(o.day).padStart(2, "0")}`,
  };
}
// Memoización por hora: Intl.formatToParts es MUY costoso en CPU y los datos
// son horarios, así que basta calcular una vez por cada hora distinta.
const cachePartes = new Map<number, Partes>();
function partesChile(t: Date): Partes {
  const k = Math.floor(t.getTime() / 3600000);
  let v = cachePartes.get(k);
  if (!v) { v = partesChileRaw(t); cachePartes.set(k, v); }
  return v;
}
const DIAS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

async function cargarHorario(s: { canal: number; key: string }, ini: Date, fin: Date): Promise<Fila[]> {
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  try {
    const r = await fetch(
      `https://api.thingspeak.com/channels/${s.canal}/feeds.json?api_key=${s.key}` +
      `&start=${encodeURIComponent(fmt(ini))}&end=${encodeURIComponent(fmt(fin))}&average=60&round=1`,
    );
    if (!r.ok) return [];
    const j = await r.json().catch(() => null);
    return (j?.feeds ?? []).map((f: Record<string, string>) => ({
      t: new Date(f.created_at),
      temp: parseFloat(f.field1), pres: parseFloat(f.field2), hum: parseFloat(f.field3),
      mp10: parseFloat(f.field4), mp25: parseFloat(f.field5),
    })).filter((f: Fila) => !isNaN(f.t.getTime()));
  } catch { return []; }
}

/* Media e IC95 por grupo (0..n-1) */
function agrupar(datos: Fila[], campo: "mp25" | "mp10", claveFn: (p: ReturnType<typeof partesChile>) => number, n: number) {
  const grupos: number[][] = Array.from({ length: n }, () => []);
  for (const f of datos) {
    const v = f[campo];
    if (!Number.isFinite(v)) continue;
    grupos[claveFn(partesChile(f.t))].push(v);
  }
  return grupos.map(g => {
    if (g.length < 2) return { prom: g[0] ?? null, lo: null, hi: null };
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    const e = 1.96 * Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / (g.length - 1)) / Math.sqrt(g.length);
    return { prom: +m.toFixed(2), lo: +(m - e).toFixed(2), hi: +(m + e).toFixed(2) };
  });
}

/* ---------- gráficos vía QuickChart ---------- */
async function quickFetch(cfg: unknown, w = 860, h = 340): Promise<Uint8Array | null> {
  try {
    const r = await fetch("https://quickchart.io/chart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chart: cfg, width: w, height: h, format: "jpg", backgroundColor: "white", version: "4" }),
    });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch { return null; }
}

/* Serie temporal semanal de una estación (MP2,5 + MP10) */
async function serieSemanaPNG(d: Fila[], titulo: string): Promise<Uint8Array | null> {
  const labels = d.map(f => { const p = partesChile(f.t); return `${DIAS_ES[p.diaSem]} ${String(p.hora).padStart(2, "0")}h`; });
  return await quickFetch({
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "MP2,5", data: d.map(f => Number.isFinite(f.mp25) ? f.mp25 : null), borderColor: "#0065A3", pointRadius: 0, borderWidth: 1.8, fill: false, tension: .3 },
        { label: "MP10", data: d.map(f => Number.isFinite(f.mp10) ? f.mp10 : null), borderColor: "#FF5733", pointRadius: 0, borderWidth: 1.8, fill: false, tension: .3 },
      ],
    },
    options: {
      plugins: { legend: { position: "top" }, title: { display: true, text: titulo, color: "#334155", font: { size: 13 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "µg/m³" } },
        x: { ticks: { autoSkip: true, maxTicksLimit: 14 }, grid: { display: false } },
      },
    },
  }, 860, 300);
}

/* Días (promedio diario) sobre la norma 24h */
function diasSobreNorma(d: Fila[], campo: "mp25" | "mp10", norma: number): number {
  const m = new Map<string, number[]>();
  for (const f of d) {
    const v = f[campo];
    if (!Number.isFinite(v)) continue;
    const k = partesChile(f.t).fecha;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  }
  let c = 0;
  for (const vs of m.values()) {
    if (vs.reduce((a, b) => a + b, 0) / vs.length > norma) c++;
  }
  return c;
}

async function graficoPNG(labels: (string | number)[], res: { prom: number | null; lo: number | null; hi: number | null }[],
  color: string, titulo: string, unidad: string): Promise<Uint8Array | null> {
  const cfg = {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "lo", data: res.map(r => r.lo), borderWidth: 0, pointRadius: 0, fill: false },
        { label: "IC95", data: res.map(r => r.hi), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: color + "2E" },
        { label: "Promedio", data: res.map(r => r.prom), borderColor: color, backgroundColor: color, pointRadius: 2, borderWidth: 2, fill: false, tension: .35 },
      ],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: titulo, color: "#334155", font: { size: 14 } } },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: unidad } },
        x: { grid: { display: false } },
      },
    },
  };
  return await quickFetch(cfg, 860, 340);
}

/* ---------- construcción del PDF ---------- */
async function construirPDF(ini: Date, fin: Date, d7: Fila[][], hist: Fila[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H;

  const texto = (s: string, x: number, yy: number, size = 10, f = font, color = rgb(.12, .16, .22)) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  const tabla = (head: string[], rows: string[][], colW: number[], resaltarRojo = -1) => {
    const alto = 16, x0 = M;
    let x = x0;
    page.drawRectangle({ x: x0, y: y - alto + 3, width: colW.reduce((a, b) => a + b, 0), height: alto, color: AZUL });
    head.forEach((h, i) => { texto(h, x + 4, y - 9, 8.5, bold, rgb(1, 1, 1)); x += colW[i]; });
    y -= alto;
    for (const fila of rows) {
      x = x0;
      fila.forEach((c, i) => {
        const rojo = i === resaltarRojo && c === "SIN DATOS";
        texto(c, x + 4, y - 9, 8.5, rojo ? bold : font, rojo ? ROJO : rgb(.12, .16, .22));
        x += colW[i];
      });
      page.drawLine({ start: { x: x0, y: y - alto + 3 }, end: { x: x0 + colW.reduce((a, b) => a + b, 0), y: y - alto + 3 }, thickness: .5, color: rgb(.89, .91, .94) });
      y -= alto;
    }
    y -= 8;
  };

  const tituloSeccion = (s: string) => { y -= 10; texto(s, M, y, 13, bold, AZUL); y -= 16; };

  // Encabezado
  page.drawRectangle({ x: 0, y: H - 74, width: W, height: 74, color: AZUL });
  texto("SenFePin - Informe semanal de calidad del aire", M, H - 36, 17, bold, rgb(1, 1, 1));
  texto(`Red AirFlux (6 estaciones) · Período: ${fmtCL(ini)} a ${fmtCL(fin)} · Generado: ${fmtCL(new Date())}`, M, H - 56, 9.5, font, rgb(1, 1, 1));
  y = H - 96;

  // 1. Funcionamiento
  tituloSeccion("1. Reporte de funcionamiento");
  let caidos = 0;
  const filasFun = SITIOS.map((s, i) => {
    const d = d7[i];
    const ult = d.length ? d[d.length - 1].t : null;
    const horas = ult ? (fin.getTime() - ult.getTime()) / 3600000 : Infinity;
    const estado = horas > 2 ? "SIN DATOS" : "En línea";
    if (estado === "SIN DATOS") caidos++;
    const disp = Math.min(100, 100 * d.length / (7 * 24));
    return [s.nombre, estado, ult ? fmtCL(ult) : "-", `${disp.toFixed(0)}%`];
  });
  tabla(["Estación", "Estado al cierre", "Último dato", "Disponibilidad 7d"], filasFun, [130, 110, 150, 110], 1);
  texto(caidos ? `ATENCIÓN: ${caidos} estación(es) sin registrar datos al cierre del período.` : "Todas las estaciones registran datos con normalidad.",
    M, y, 10, bold, caidos ? ROJO : GRIS);
  y -= 14;

  // 2. Estadística descriptiva
  tituloSeccion("2. Estadística descriptiva (promedios horarios, µg/m³)");
  const filasEst = SITIOS.map((s, i) => {
    const v25 = d7[i].map(x => x.mp25).filter(Number.isFinite);
    const v10 = d7[i].map(x => x.mp10).filter(Number.isFinite);
    const s25 = stats(v25), s10 = stats(v10);
    return [s.nombre, f1(s25.prom), f1(s25.min), f1(s25.max), f1(s25.sd), f1(s10.prom), f1(s10.min), f1(s10.max), f1(s10.sd)];
  });
  tabla(["Estación", "MP2,5 prom", "mín", "máx", "DE", "MP10 prom", "mín", "máx", "DE"], filasEst, [100, 60, 45, 45, 45, 60, 45, 45, 45]);
  texto("DE = desviación estándar. Norma 24h de referencia: MP2,5 = 50 µg/m³ · MP10 = 130 µg/m³.", M, y, 8.5, font, GRIS);
  y -= 14;

  // 3. Resumen diario
  tituloSeccion("3. Resumen diario de la red");
  const porDia = new Map<string, { v25: number[]; v10: number[] }>();
  for (const f of d7.flat()) {
    const k = partesChile(f.t).fecha;
    if (!porDia.has(k)) porDia.set(k, { v25: [], v10: [] });
    const g = porDia.get(k)!;
    if (Number.isFinite(f.mp25)) g.v25.push(f.mp25);
    if (Number.isFinite(f.mp10)) g.v10.push(f.mp10);
  }
  const filasDia = [...porDia.keys()].sort().map(k => {
    const g = porDia.get(k)!, s25 = stats(g.v25), s10 = stats(g.v10);
    return [k, f1(s25.prom), f1(s25.max), f1(s10.prom), f1(s10.max)];
  });
  tabla(["Día", "MP2,5 prom", "MP2,5 máx", "MP10 prom", "MP10 máx"], filasDia, [120, 95, 95, 95, 95]);

  // 4. Gráficos (semana para horario/día; histórico para mensual)
  const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const todos7 = d7.flat();
  const vars: ["mp25" | "mp10", string, string][] = [["mp25", "MP2,5", "#0065A3"], ["mp10", "MP10", "#FF5733"]];
  for (const [campo, nombre, color] of vars) {
    page = pdf.addPage([W, H]); y = H - 42;
    texto(`4. Variación temporal - ${nombre}`, M, y, 13, bold, AZUL); y -= 12;
    const graficos: [string, Uint8Array | null][] = [
      [`Perfil horario de la semana (${nombre})`,
        await graficoPNG([...Array(24).keys()], agrupar(todos7, campo, p => p.hora, 24), color, `Perfil horario - ${nombre}`, "µg/m³")],
      [`Por día de la semana (${nombre})`,
        await graficoPNG(DIAS, agrupar(todos7, campo, p => p.diaSem, 7), color, `Por día de la semana - ${nombre}`, "µg/m³")],
      [`Perfil mensual histórico (${nombre})`,
        await graficoPNG(MES, agrupar(hist, campo, p => p.mes, 12), color, `Perfil mensual (histórico) - ${nombre}`, "µg/m³")],
    ];
    for (const [, png] of graficos) {
      if (!png) { texto("(gráfico no disponible)", M, y - 12, 9, font, GRIS); y -= 24; continue; }
      const img = await pdf.embedJpg(png);
      const w = W - 2 * M, h = w * 340 / 860;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      y -= h + 14;
    }
    texto("Banda sombreada: intervalo de confianza del 95% de la media.", M, y, 8, font, GRIS);
  }

  // 5. Análisis por estación (serie semanal + diagnóstico automático)
  const promRed25 = stats(todos7.map(x => x.mp25).filter(Number.isFinite)).prom;
  const promRed10 = stats(todos7.map(x => x.mp10).filter(Number.isFinite)).prom;
  for (let i = 0; i < SITIOS.length; i++) {
    if (i % 3 === 0) {
      page = pdf.addPage([W, H]); y = H - 42;
      texto(`5. Análisis por estación (últimos 7 días)${i ? " - continuación" : ""}`, M, y, 13, bold, AZUL);
      y -= 8;
    }
    const s = SITIOS[i], d = d7[i];
    const v25 = d.map(x => x.mp25).filter(Number.isFinite);
    const v10 = d.map(x => x.mp10).filter(Number.isFinite);
    const s25 = stats(v25), s10 = stats(v10);
    const disp = Math.min(100, 100 * d.length / (7 * 24));
    const rel25 = Number.isFinite(s25.prom) && Number.isFinite(promRed25)
      ? ` (${s25.prom >= promRed25 ? "+" : ""}${((s25.prom / promRed25 - 1) * 100).toFixed(0)}% vs red)` : "";
    const rel10 = Number.isFinite(s10.prom) && Number.isFinite(promRed10)
      ? ` (${s10.prom >= promRed10 ? "+" : ""}${((s10.prom / promRed10 - 1) * 100).toFixed(0)}% vs red)` : "";
    const exc25 = diasSobreNorma(d, "mp25", 50), exc10 = diasSobreNorma(d, "mp10", 130);

    y -= 14;
    texto(`${s.nombre} (ID ${s.n})`, M, y, 11.5, bold, AZUL);
    y -= 13;
    texto(`Disponibilidad ${disp.toFixed(0)}% (${d.length}/168 h) · MP2,5 prom ${f1(s25.prom)} µg/m³${rel25} · MP10 prom ${f1(s10.prom)} µg/m³${rel10}`, M, y, 8.8, font, GRIS);
    y -= 11;
    const excTxt = (exc25 || exc10)
      ? `Días con promedio diario sobre norma: MP2,5 ${exc25} día(s), MP10 ${exc10} día(s).`
      : "Sin días sobre la norma 24h en el período.";
    texto(`Máximos horarios: MP2,5 ${f1(s25.max)} · MP10 ${f1(s10.max)} µg/m³. ${excTxt}`, M, y, 8.8, font, (exc25 || exc10) ? ROJO : GRIS);
    y -= 6;
    const png = d.length ? await serieSemanaPNG(d, `Serie semanal - ${s.nombre}`) : null;
    if (png) {
      const img = await pdf.embedJpg(png);
      const w = W - 2 * M, h = w * 300 / 860;
      page.drawImage(img, { x: M, y: y - h, width: w, height: h });
      y -= h + 6;
    } else {
      texto("(sin datos suficientes para graficar)", M, y - 10, 9, font, GRIS);
      y -= 22;
    }
  }

  // Pie de página
  const paginas = pdf.getPages();
  paginas.forEach((p, i) =>
    p.drawText(`SenFePin · Informe semanal automático · página ${i + 1} de ${paginas.length}`,
      { x: M, y: 20, size: 8, font, color: rgb(.6, .65, .7) }));

  return await pdf.save();
}

/* ---------- envío ---------- */
/* Opción A (recomendada en serverless): Resend — API HTTPS con adjuntos.
   Secretos: RESEND_API_KEY (obligatorio) y opcional RESEND_FROM
   (si verificaste un dominio propio en Resend; si no, se usa onboarding@resend.dev,
   que solo puede enviar al correo dueño de la cuenta Resend). */
function b64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function enviarResend(apiKey: string, dest: string[], asunto: string, cuerpo: string,
  adjuntos: { nombre: string; datos: Uint8Array }[]) {
  const from = Deno.env.get("RESEND_FROM") || "SenFePin <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: dest, subject: asunto, text: cuerpo,
      attachments: adjuntos.map(a => ({ filename: a.nombre, content: b64(a.datos) })),
    }),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${await r.text()}`);
}

/* Opción B: SMTP Gmail directo (puede estar bloqueado en algunos entornos) */
async function enviarConAdjuntos(remitente: string, pass: string, dest: string[], asunto: string, cuerpo: string,
  adjuntos: { nombre: string; datos: Uint8Array }[]) {
  const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: remitente, password: pass } },
  });
  await client.send({
    from: remitente, to: dest, subject: asunto, content: cuerpo,
    attachments: adjuntos.map(a => ({
      filename: a.nombre, content: a.datos, encoding: "binary", contentType: "application/pdf",
    })),
  });
  await client.close();
}

/* ---------- handler principal ---------- */
// CORS: necesario para que la página (otro dominio) pueda invocar esta función
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown) => Response.json(o, { headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    return await manejar(req);
  } catch (e) {
    console.error("Error no controlado:", e);
    return json({ ok: false, error: String(e) });
  }
});

async function manejar(req: Request): Promise<Response> {
  // Clave de servidor: en proyectos con el sistema de claves nuevo puede no
  // existir SUPABASE_SERVICE_ROLE_KEY; en ese caso usar el secreto SERVICE_KEY
  // (crear en Edge Functions → Secrets con la "secret key" sb_secret_...).
  const claveServidor = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_KEY") || "";
  if (!claveServidor) return json({ ok: false, error: "Falta SERVICE_KEY en los secretos (usa la sb_secret_ de API Keys)" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, claveServidor);
  const url = new URL(req.url);
  const forzar = url.searchParams.get("forzar") === "1";
  const semanas = Math.min(2, Math.max(1, Number(url.searchParams.get("semanas") || "1")));

  const { data: cfg } = await supabase.from("config_resumen").select("*").eq("id", 1).maybeSingle();
  if (!cfg || !cfg.activo) return json({ ok: true, enviado: false, motivo: "resumen desactivado" });
  const correos = (cfg.correos || "").split(",").map((x: string) => x.trim()).filter(Boolean);
  if (!correos.length) return json({ ok: true, enviado: false, motivo: "sin correos" });

  // Programación: coincide día/hora de Chile (salvo ?forzar=1)
  const chile = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const coincide = chile.getDay() === Number(cfg.dia) && chile.getHours() === Number(cfg.hora);
  const yaEnviado = cfg.last_sent && (Date.now() - new Date(cfg.last_sent).getTime()) < 20 * 3600000;
  if (!forzar && (!coincide || yaEnviado)) {
    return json({ ok: true, enviado: false, motivo: "fuera de horario o ya enviado" });
  }

  // Remitente (config_destinos) + contraseña de aplicación (secreto)
  let remitente = "";
  try {
    const { data: dst } = await supabase.from("config_destinos").select("remitente").eq("id", 1).maybeSingle();
    remitente = String(dst?.remitente ?? "");
  } catch { /* opcional */ }
  const pass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";

  // Histórico (una vez) + PDFs por semana
  const ahora = new Date();
  const hist = (await Promise.all(SITIOS.map(s => cargarHorario(s, HISTORICO_INICIO, ahora)))).flat();
  const adjuntos: { nombre: string; datos: Uint8Array }[] = [];
  const nombres: string[] = [];
  for (let i = 0; i < semanas; i++) {
    const finSem = new Date(ahora.getTime() - i * 7 * 24 * 3600000);
    const iniSem = new Date(finSem.getTime() - 7 * 24 * 3600000);
    const d7 = await Promise.all(SITIOS.map(s => cargarHorario(s, iniSem, finSem)));
    const pdfBytes = await construirPDF(iniSem, finSem, d7, hist);
    const nombre = `informe_SenFePin_${fmtDia(iniSem).replaceAll("-", "")}_${fmtDia(finSem).replaceAll("-", "")}.pdf`;
    adjuntos.push({ nombre, datos: pdfBytes });
    nombres.push(`${fmtDia(iniSem)} a ${fmtDia(finSem)}`);
  }

  const asunto = semanas === 1 ? "📊 Resumen semanal SenFePin (PDF adjunto)" : "📊 Resúmenes SenFePin - últimas 2 semanas (PDF adjuntos)";
  const cuerpo = `Se adjunta el informe de calidad del aire de la red AirFlux.\n\nPeríodos: ${nombres.join(" · ")}\n\nContenido: reporte de funcionamiento, estadística descriptiva, resumen diario y gráficos de variación temporal (MP2,5 y MP10).\n\n— Enviado automáticamente por SenFePin.`;

  // Prioridad 1: Resend (API HTTPS, la más confiable en serverless)
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (resendKey) {
    try {
      await enviarResend(resendKey, correos, asunto, cuerpo, adjuntos);
      if (!forzar) await supabase.from("config_resumen").update({ last_sent: new Date().toISOString() }).eq("id", 1);
      return json({ ok: true, enviado: true, via: "resend-pdf", correos: correos.length, adjuntos: adjuntos.length });
    } catch (e) {
      console.error("Resend falló:", e);
    }
  }
  // Prioridad 2: SMTP Gmail
  if (remitente && pass) {
    try {
      await enviarConAdjuntos(remitente, pass, correos, asunto, cuerpo, adjuntos);
      if (!forzar) await supabase.from("config_resumen").update({ last_sent: new Date().toISOString() }).eq("id", 1);
      return json({ ok: true, enviado: true, via: "smtp-pdf", correos: correos.length, adjuntos: adjuntos.length });
    } catch (e) {
      console.error("SMTP con adjuntos falló:", e);
    }
  }
  // Respaldo sin SMTP: texto simple vía FormSubmit (sin adjuntos)
  await Promise.allSettled(correos.map((m: string) =>
    fetch(`https://formsubmit.co/ajax/${encodeURIComponent(m)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        _subject: asunto,
        mensaje: cuerpo + "\n\nNOTA: para recibir el PDF adjunto, configura el correo remitente en la página y el secreto GMAIL_APP_PASSWORD en Supabase.",
      }),
    }).catch(console.error)));
  if (!forzar) await supabase.from("config_resumen").update({ last_sent: new Date().toISOString() }).eq("id", 1);
  return json({ ok: true, enviado: true, via: "formsubmit-texto", correos: correos.length });
}
