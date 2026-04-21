/**
 * Importa esquemas scrapeados al nuevo sistema.
 * Lee db/esquemas_scraped.csv y asigna micro_id + posicion a cada cubierta.
 *
 * Uso: node db/import_esquemas_scraped.js [--dry-run]
 */
const fs   = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql    = neon(process.env.DATABASE_URL);
const DRY    = process.argv.includes('--dry-run');
const CSV    = path.join(__dirname, 'esquemas_scraped.csv');

async function main() {
  if (DRY) console.log('=== DRY RUN — sin cambios en la BD ===\n');

  // Leer CSV
  const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n').slice(1); // saltar header
  const rows  = lines.map(l => { const [unidad_numero, posicion, fuego] = l.split(','); return { unidad_numero, posicion, fuego: fuego?.trim() }; });
  console.log(`CSV: ${rows.length} filas\n`);

  // Cargar todos los micros del nuevo sistema
  const micros = await sql`SELECT id, unidad FROM micro WHERE activo = 1`;
  const microMap = {}; // unidad_numero → micro_id
  for (const m of micros) microMap[String(m.unidad).trim()] = m.id;

  // Cargar todas las cubiertas del nuevo sistema
  const cubiertas = await sql`SELECT id, fuego FROM cubiertas WHERE activo = 1`;
  const cubMap = {}; // fuego → cubierta_id
  for (const c of cubiertas) cubMap[String(c.fuego).trim()] = c.id;

  let ok = 0, sinUnidad = 0, sinCubierta = 0, vacio = 0, yaAsignada = 0;
  const errores = [];

  for (const row of rows) {
    const { unidad_numero, posicion, fuego } = row;

    // Ignorar fuegos vacíos o placeholders
    if (!fuego || fuego === '' || fuego.toUpperCase().includes('VACIO') || fuego === '-') {
      vacio++;
      continue;
    }

    const micro_id    = microMap[unidad_numero];
    const cubierta_id = cubMap[fuego];

    if (!micro_id) {
      sinUnidad++;
      if (errores.filter(e => e.startsWith('Sin unidad')).length < 5)
        errores.push(`Sin unidad: "${unidad_numero}" (fuego ${fuego})`);
      continue;
    }

    if (!cubierta_id) {
      sinCubierta++;
      if (errores.filter(e => e.startsWith('Sin cubierta')).length < 5)
        errores.push(`Sin cubierta: fuego "${fuego}" (unidad ${unidad_numero})`);
      continue;
    }

    if (!DRY) {
      // Verificar si ya está asignada a otra posición/unidad
      const existing = await sql`SELECT micro_id, posicion FROM cubiertas WHERE id = ${cubierta_id}`;
      if (existing[0]?.micro_id && existing[0].micro_id !== micro_id) {
        yaAsignada++;
        errores.push(`Cubierta ${fuego} ya asignada a unidad ${existing[0].micro_id} pos ${existing[0].posicion} — se reasigna a unidad ${unidad_numero}`);
      }

      await sql`
        UPDATE cubiertas
        SET micro_id = ${micro_id}, posicion = ${posicion}, almacen_id = NULL
        WHERE id = ${cubierta_id}
      `;
    }

    ok++;
    if (ok <= 5 || ok % 100 === 0) console.log(`  ✓ Unidad ${unidad_numero} | ${posicion} ← fuego ${fuego}`);
  }

  console.log(`
Resultado:
  ✓ Asignadas:        ${ok}
  ✗ Sin unidad:       ${sinUnidad}
  ✗ Sin cubierta:     ${sinCubierta}
  ○ Vacías/skip:      ${vacio}
  ⚠ Ya asignadas:     ${yaAsignada}
`);

  if (errores.length) {
    console.log('Primeros errores:');
    errores.slice(0, 15).forEach(e => console.log(' ', e));
  }

  if (DRY) console.log('\n→ Corré sin --dry-run para aplicar los cambios.');
}

main().catch(err => { console.error(err); process.exit(1); });
