// Lista lo que falta confirmar antes de publicar la política y activar analítica o publicidad.
// Uso: node revisar-publicacion.cjs
const fs = require('fs');
let pendientes = 0;
for (const f of ['privacidad.html', 'uso-datos.html']) {
  const marcas = [...fs.readFileSync(__dirname + '/' + f, 'utf8').matchAll(/<mark class="por-confirmar">([^<]*)<\/mark>/g)].map(m => m[1]);
  pendientes += marcas.length;
  console.log(`\n${f}: ${marcas.length} dato(s) por confirmar`);
  marcas.forEach(m => console.log('  • ' + m));
}
const sitio = fs.readFileSync(__dirname + '/sitio.js', 'utf8');
console.log('\nsitio.js:');
console.log('  • Analítica: ' + (/analitica: \{ activa: true/.test(sitio) ? 'ACTIVA' : 'desactivada'));
console.log('  • Patrocinio: ' + (/patrocinio: \{ activo: true/.test(sitio) ? 'ACTIVO' : 'desactivado'));
console.log('  • AdSense: ' + (/adsense: \{ activo: true/.test(sitio) ? 'ACTIVO' : 'desactivado'));
console.log(pendientes ? `\n⚠ Quedan ${pendientes} datos por confirmar: la política se muestra como borrador.` : '\n✔ Sin datos por confirmar.');
