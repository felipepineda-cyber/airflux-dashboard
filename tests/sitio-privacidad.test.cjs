// Pruebas de sitio.js: la analítica respeta la preferencia del visitante y nunca envía datos personales
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const codigo = fs.readFileSync(__dirname + '/../sitio.js', 'utf8');

// Carga sitio.js en un navegador simulado; `ajustes` modifica la configuración antes de ejecutar
function cargar({ ruta = '/index.html', guardado = {}, gpc = false, analiticaActiva = false } = {}) {
  const almacen = { ...guardado }, scripts = [];
  const ventana = {};
  const entorno = {
    window: ventana, location: { pathname: ruta },
    navigator: { globalPrivacyControl: gpc },
    localStorage: { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } },
    document: { createElement: () => ({}), head: { appendChild: s => scripts.push(s) } },
    URL, Object, String, RegExp,
  };
  ventana.window = ventana;
  // activa la analítica en la configuración antes de que el IIFE la lea
  const fuente = analiticaActiva ? codigo.replace('analitica: { activa: false', 'analitica: { activa: true') : codigo;
  vm.createContext(entorno);
  vm.runInContext(fuente, entorno);
  return { v: ventana, almacen, scripts, cola: () => ventana.vaq || [] };
}
const filtro = s => s.cola().find(a => a[0] === 'beforeSend')[1];
const eventos = s => s.cola().filter(a => a[0] === 'event').map(a => a[1]);

test('Con la analítica desactivada no se carga ningún script ni se envían eventos', () => {
  const s = cargar();
  assert.equal(s.scripts.length, 0);
  s.v.senfepinMedir('ver_estacion', { estacion: '3' });
  assert.equal(eventos(s).length, 0);
});

test('Activa: carga el script y beforeSend quita parámetros y fragmentos (pueden traer tokens)', () => {
  const s = cargar({ analiticaActiva: true });
  assert.equal(s.scripts.length, 1);
  const ev = filtro(s)({ type: 'pageview', url: 'https://senfepin.vercel.app/index.html?correo=a@b.cl#access_token=xyz' });
  assert.equal(ev.url, 'https://senfepin.vercel.app/index.html');
});

test('La página de recuperación de contraseña nunca se mide', () => {
  const s = cargar({ analiticaActiva: true, ruta: '/restablecer.html' });
  assert.equal(s.scripts.length, 0);
  assert.equal(filtro(s)({ url: 'https://senfepin.vercel.app/restablecer.html#type=recovery' }), null);
});

test('Si el visitante rechaza la medición o usa Global Privacy Control, no se carga nada', () => {
  const rechazo = cargar({ analiticaActiva: true, guardado: { senfepin_no_medir: '1' } });
  assert.equal(rechazo.scripts.length, 0);
  assert.equal(filtro(rechazo)({ url: 'https://senfepin.vercel.app/' }), null);
  const gpc = cargar({ analiticaActiva: true, gpc: true });
  assert.equal(gpc.scripts.length, 0);
});

test('Solo se envían eventos conocidos con valores acotados', () => {
  const s = cargar({ analiticaActiva: true });
  s.v.senfepinMedir('ver_estacion', { estacion: 3 });
  s.v.senfepinMedir('cambiar_periodo', { periodo: '168' });
  s.v.senfepinMedir('descargar_csv', { tipo: 'todos' });
  s.v.senfepinMedir('ver_estacion', { estacion: 'juan@correo.cl' });        // valor libre: se descarta
  s.v.senfepinMedir('cambiar_periodo', { periodo: '999' });                  // fuera de la lista
  s.v.senfepinMedir('abrir_vista', { vista: 'whatsapp' });                   // vista de administración
  s.v.senfepinMedir('evento_inventado', { x: '1' });
  const e = eventos(s);
  // JSON: los objetos vienen de otro contexto de vm
  assert.equal(JSON.stringify(e.map(x => x.name)), JSON.stringify(['ver_estacion', 'cambiar_periodo', 'descargar_csv']));
  assert.equal(JSON.stringify(e[0].data), JSON.stringify({ estacion: '3' }));
});

test('La preferencia se puede cambiar y retirar', () => {
  const s = cargar({ analiticaActiva: true });
  s.v.senfepinMedicion.fijar(false);
  assert.equal(s.almacen.senfepin_no_medir, '1');
  assert.equal(s.v.senfepinMedicion.permitida(), false);
  s.v.senfepinMedicion.fijar(true);
  assert.equal(s.v.senfepinMedicion.permitida(), true);
});

test('AdSense y patrocinio quedan desactivados por defecto', () => {
  assert.match(codigo, /adsense: \{ activo: false/);
  assert.match(codigo, /patrocinio: \{ activo: false/);
  const s = cargar({ analiticaActiva: true });
  assert.ok(!s.scripts.some(x => /googlesyndication/.test(x.src || '')));
});
