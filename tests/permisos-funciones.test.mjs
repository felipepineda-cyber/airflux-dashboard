// Permisos de las funciones de Supabase (resumen y vigilante) sin servicios reales.
// Ejecutar con:  node --experimental-strip-types --test tests/permisos-funciones.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = {};
let manejador;
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { manejador = h; } };
globalThis.rgb = (...a) => a; globalThis.StandardFonts = {}; globalThis.PDFDocument = {};

// Cliente de Supabase simulado: tokens "a.b.admin" (administrador) y "a.b.otro" (usuario sin rol)
const ADMINS = ['admin@usach.cl'];
globalThis.__crearCliente = () => ({
  auth: { getUser: async t => t === 'a.b.admin' ? { data: { user: { email: 'Admin@usach.cl' } } }
    : t === 'a.b.otro' ? { data: { user: { email: 'otro@x.cl' } } } : { data: { user: null }, error: { message: 'invalid' } } },
  from: tabla => {
    const q = { f: '', select: () => q, eq: () => q, order: () => q, update: () => q, delete: () => q, upsert: async () => ({}),
      ilike: (_c, v) => { q.f = v.toLowerCase(); return q; },
      maybeSingle: async () => tabla === 'admins' ? { data: ADMINS.includes(q.f) ? { email: q.f } : null }
        : tabla === 'config_resumen' ? { data: { activo: false } } : { data: null },
      then: r => Promise.resolve({ data: [], error: null }).then(r) };
    return q;
  },
});

// Copia la función sin sus imports remotos y la carga
async function cargar(nombre) {
  const fuente = fs.readFileSync(path.join(raiz, 'supabase/functions', nombre, 'index.ts'), 'utf8')
    .replace(/^import \{ createClient \}.*$/m, 'const createClient = globalThis.__crearCliente;')
    .replace(/^import .*$/gm, '');
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fn-')), nombre + '.ts');
  fs.writeFileSync(archivo, fuente);
  await import(archivo);
  return manejador;
}
const pedir = async (h, url, cab = {}) => { const r = await h(new Request(url, { headers: cab })); return r.status; };

test('resumen: ?forzar=1 exige sesión de administrador', async () => {
  env.SUPABASE_URL = 'https://x.supabase.co'; env.SUPABASE_SERVICE_ROLE_KEY = 'srv'; delete env.CRON_SECRET;
  const h = await cargar('resumen');
  assert.equal(await pedir(h, 'https://f/resumen?forzar=1', { Authorization: 'Bearer sb_publishable_x' }), 401);
  assert.equal(await pedir(h, 'https://f/resumen?forzar=1', { Authorization: 'Bearer a.b.otro' }), 401);
  assert.equal(await pedir(h, 'https://f/resumen?forzar=1', { Authorization: 'Bearer a.b.falso' }), 401);
  assert.equal(await pedir(h, 'https://f/resumen?forzar=1', { Authorization: 'Bearer a.b.admin' }), 200);
  // envío programado: abierto mientras no exista CRON_SECRET; con el secreto, solo la tarea programada
  assert.equal(await pedir(h, 'https://f/resumen'), 200);
  env.CRON_SECRET = 's3cr3t';
  assert.equal(await pedir(h, 'https://f/resumen'), 401);
  assert.equal(await pedir(h, 'https://f/resumen', { 'x-cron-secret': 's3cr3t' }), 200);
  delete env.CRON_SECRET;
});

test('vigilante: con CRON_SECRET solo responde a la tarea programada', async () => {
  const h = await cargar('vigilante');
  env.CRON_SECRET = 's3cr3t';
  assert.equal(await pedir(h, 'https://f/vigilante'), 401);
  assert.equal(await pedir(h, 'https://f/vigilante', { 'x-cron-secret': 'otro' }), 401);
  delete env.CRON_SECRET;
});
