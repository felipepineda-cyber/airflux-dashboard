#!/usr/bin/env node
/* ============================================================
   deteccion_sensores.mjs — Diagnóstico de la red desde la TERMINAL
   Misma lógica que el bloque de index.html, sin abrir el navegador.

   Requisitos: Node 18 o superior (trae fetch incluido; verificar
   con `node -v`). No necesita instalar nada con npm.

   Uso:
     node deteccion_sensores.mjs                      → informe (no toca nada)
     node deteccion_sensores.mjs --aplicar            → aplica escenario A (actualiza Supabase)
     node deteccion_sensores.mjs --estacion "Copiapó" → diagnostica solo esa estación
     node deteccion_sensores.mjs --reemplazo 4 358    → fuerza el reemplazo: la estación N°4 (Copiapó) pasa a sensor 358

   Credenciales: por variable de entorno o editando las constantes.
     export SUPABASE_URL="https://xxxx.supabase.co"
     export SUPABASE_ANON_KEY="eyJ..."
   ============================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://stuxspraehjbxyiujsnu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_Eemqq4D54Y_Bg3XAm25psg_DBJ2QG0I';

const HDRS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json'
};

/* ---------- Red con timeout 15 s y 2 intentos ---------- */
async function fetchConReintento(url, opciones = {}, intentos = 2) {
  for (let i = 0; i < intentos; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(url, { ...opciones, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return r;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === intentos - 1) throw e;
      await new Promise(res => setTimeout(res, 2000 * (i + 1)));
    }
  }
}

/* ---------- Cargar la red desde Supabase ---------- */
async function cargarEstaciones() {
  const r = await fetchConReintento(
    `${SUPABASE_URL}/rest/v1/estaciones?activo=eq.true&order=sitio_n`,
    { headers: HDRS }
  );
  return await r.json();
}

/* ---------- Diagnóstico de un canal de ThingSpeak ---------- */
async function diagnosticarCanal(canalId, readKey) {
  const url = `https://api.thingspeak.com/channels/${canalId}/feeds.json?results=10` +
              (readKey ? `&api_key=${readKey}` : '');
  const r = await fetchConReintento(url);
  const { channel, feeds } = await r.json();

  const ultimo = feeds.length ? new Date(feeds[feeds.length - 1].created_at) : null;
  const minutosSinDatos = ultimo ? Math.round((Date.now() - ultimo) / 60000) : Infinity;

  // ¿Algún field rotulado como ID?
  let fieldId = null;
  for (let n = 6; n <= 8; n++) {
    const rotulo = channel[`field${n}`];
    if (rotulo && /id|sensor|serie/i.test(rotulo)) { fieldId = `field${n}`; break; }
  }
  // Si no, buscar un field con valor entero constante (un ID no varía)
  if (!fieldId && feeds.length >= 3) {
    for (let n = 6; n <= 8; n++) {
      const vals = feeds.map(f => f[`field${n}`]).filter(v => v != null);
      if (vals.length >= 3 && vals.every(v => v === vals[0]) &&
          Number.isInteger(Number(vals[0]))) { fieldId = `field${n}`; break; }
    }
  }
  const idReportado = fieldId && feeds.length
    ? String(Number(feeds[feeds.length - 1][fieldId]))
    : null;

  return {
    canalId,
    coordsCanal: (channel.latitude && channel.longitude)
      ? { lat: Number(channel.latitude), lng: Number(channel.longitude) } : null,
    canalVivo: minutosSinDatos <= 120,
    minutosSinDatos,
    idReportado
  };
}

/* ---------- Actualizar el registro en Supabase ---------- */
async function patchEstacion(id, cuerpo) {
  await fetchConReintento(`${SUPABASE_URL}/rest/v1/estaciones?sitio_n=eq.${id}`, {
    method: 'PATCH',
    headers: { ...HDRS, Prefer: 'return=minimal' },
    body: JSON.stringify(cuerpo)
  });
}

async function aplicarReemplazo(est, nuevoId) {
  await patchEstacion(est.sitio_n, {
    sensor_anterior: est.sensor_id,
    sensor_id: String(nuevoId),
    fecha_instalacion: new Date().toISOString().slice(0, 10)
  });
  console.log(`  ✔ ${est.nombre}: sensor ${est.sensor_id ?? '—'} → ${nuevoId}`);
}

/* ---------- Interpretar diagnóstico ---------- */
async function resolverEstacion(est, diag, autoAplicar) {
  if (diag.canalVivo && (!diag.idReportado || diag.idReportado === String(est.sensor_id))) {
    return { estacion: est.nombre, escenario: 'OK', accion: 'nada que hacer' };
  }
  if (diag.canalVivo && diag.idReportado && diag.idReportado !== String(est.sensor_id)) {
    const esc = `REEMPLAZO: ${est.sensor_id ?? '—'} → ${diag.idReportado} (mismo canal)`;
    if (autoAplicar) {
      await aplicarReemplazo(est, diag.idReportado);
      return { estacion: est.nombre, escenario: esc, accion: 'registro actualizado' };
    }
    return {
      estacion: est.nombre, escenario: esc,
      accion: `confirmar con: node deteccion_sensores.mjs --reemplazo ${est.sitio_n} ${diag.idReportado}`
    };
  }
  return {
    estacion: est.nombre,
    escenario: `CANAL INACTIVO (${diag.minutosSinDatos === Infinity ? 'sin feeds' : diag.minutosSinDatos + ' min sin datos'})`,
    accion: 'sensor nuevo con canal propio: actualizar canal_thingspeak y read_api_key en la fila de Supabase'
  };
}

/* ---------- Programa principal ---------- */
async function main() {
  const args = process.argv.slice(2);
  const autoAplicar = args.includes('--aplicar');

  // Modo reemplazo forzado: --reemplazo <sitio_n> <nuevoSensorId>
  const iR = args.indexOf('--reemplazo');
  if (iR !== -1) {
    const idEstacion = Number(args[iR + 1]);
    const nuevoId = args[iR + 2];
    if (!idEstacion || !nuevoId) {
      console.error('Uso: node deteccion_sensores.mjs --reemplazo <sitio_n> <nuevoSensorId>');
      process.exit(1);
    }
    const est = (await cargarEstaciones()).find(e => e.sitio_n === idEstacion);
    if (!est) { console.error(`No existe estación con sitio_n=${idEstacion}`); process.exit(1); }
    await aplicarReemplazo(est, nuevoId);
    return;
  }

  // Filtro opcional: --estacion "Nombre"
  const iE = args.indexOf('--estacion');
  const filtro = iE !== -1 ? args[iE + 1]?.toLowerCase() : null;

  let estaciones = await cargarEstaciones();
  if (filtro) estaciones = estaciones.filter(e => e.nombre.toLowerCase().includes(filtro));
  if (!estaciones.length) { console.error('No hay estaciones que coincidan.'); process.exit(1); }

  console.log(`\nDiagnóstico de la red AirFlux — ${new Date().toLocaleString('es-CL')}`);
  console.log(autoAplicar ? '(modo --aplicar: los reemplazos del escenario A se guardan solos)\n'
                          : '(modo informe: no se modifica nada)\n');

  const informe = [];
  for (const est of estaciones) {
    process.stdout.write(`Consultando ${est.nombre} (canal ${est.canal_thingspeak})... `);
    try {
      const diag = await diagnosticarCanal(est.canal_thingspeak, est.read_api_key);
      const res = await resolverEstacion(est, diag, autoAplicar);
      if (diag.coordsCanal && est.lat && est.lng) {
        const d = Math.hypot(diag.coordsCanal.lat - est.lat, diag.coordsCanal.lng - est.lng);
        if (d > 0.05) res.escenario += ' · ⚠ coords canal ≠ registradas';
      }
      console.log('listo');
      informe.push(res);
    } catch (e) {
      console.log('falló');
      informe.push({ estacion: est.nombre, escenario: 'ERROR DE CONSULTA', accion: String(e.message || e) });
    }
    await new Promise(r => setTimeout(r, 1200)); // ~1 req/s (ThingSpeak free)
  }

  console.log('');
  console.table(informe);

  const pendientes = informe.filter(x => x.escenario.startsWith('REEMPLAZO') && !autoAplicar);
  if (pendientes.length) {
    console.log('\nPara aplicar todos los reemplazos detectados de una vez:');
    console.log('  node deteccion_sensores.mjs --aplicar');
  }
}

main().catch(e => { console.error('Error fatal:', e.message || e); process.exit(1); });
