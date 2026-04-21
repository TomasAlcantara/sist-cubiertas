/**
 * Importa unidades + esquemas de cubiertas desde los archivos scrapeados.
 *
 * Pasos:
 *  1. Lee esquemas_scraped.csv para conocer todas las unidades y sus posiciones
 *  2. Inserta las unidades que no existen en el nuevo sistema
 *  3. Asigna micro_id + posicion en cubiertas
 *
 * Uso:
 *   node db/import_micros_y_esquemas.js [--dry-run]
 */
const fs   = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql  = neon(process.env.DATABASE_URL);
const DRY  = process.argv.includes('--dry-run');
const CSV  = path.join(__dirname, 'esquemas_scraped.csv');

// Determina tipo_unidad por las posiciones que usa la unidad
function inferirTipo(posiciones) {
  const p = new Set(posiciones);
  if (p.has('cie') || p.has('cii') || p.has('cdi') || p.has('cde')) return 2; // piso doble / centros
  if (p.has('tii') || p.has('tdi')) return 3;  // 4 traseras
  return 1; // 2 traseras
}

async function main() {
  if (DRY) console.log('=== DRY RUN ===\n');

  // Leer CSV
  const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n').slice(1);
  const rows  = lines.map(l => {
    const [unidad_numero, posicion, fuego] = l.split(',');
    return { unidad_numero: unidad_numero?.trim(), posicion: posicion?.trim(), fuego: fuego?.trim() };
  }).filter(r => r.unidad_numero && r.fuego &&
                 !r.fuego.toUpperCase().includes('VACIO') && r.fuego !== '-' && r.fuego !== 'S/N');

  // Agrupar por unidad
  const porUnidad = {};
  for (const r of rows) {
    if (!porUnidad[r.unidad_numero]) porUnidad[r.unidad_numero] = { posiciones: [], filas: [] };
    porUnidad[r.unidad_numero].posiciones.push(r.posicion);
    porUnidad[r.unidad_numero].filas.push(r);
  }
  const totalUnidades = Object.keys(porUnidad).length;
  console.log(`CSV: ${rows.length} asignaciones en ${totalUnidades} unidades\n`);

  // Cargar micros existentes
  const micros = await sql`SELECT id, unidad FROM micro`;
  const microMap = {};
  for (const m of micros) microMap[String(m.unidad).trim()] = m.id;

  // ── PASO 1: Insertar unidades faltantes ──────────────────────────────────
  let nuevasUnidades = 0;
  const numerosNuevos = Object.keys(porUnidad).filter(n => !microMap[n]);
  console.log(`Unidades a insertar: ${numerosNuevos.length}`);

  for (const numero of numerosNuevos) {
    const tipo = inferirTipo(porUnidad[numero].posiciones);
    if (!DRY) {
      const inserted = await sql`
        INSERT INTO micro (unidad, descripcion, km_actual, tipo_unidad, activo)
        VALUES (${numero}, ${numero}, 0, ${tipo}, 1)
        RETURNING id
      `;
      microMap[numero] = inserted[0].id;
    } else {
      microMap[numero] = -1; // placeholder para dry run
    }
    nuevasUnidades++;
  }
  console.log(`✓ Unidades insertadas: ${nuevasUnidades}\n`);

  // Cargar cubiertas
  const cubiertas = await sql`SELECT id, fuego FROM cubiertas WHERE activo = 1`;
  const cubMap = {};
  for (const c of cubiertas) cubMap[String(c.fuego).trim()] = c.id;

  // ── PASO 2: Asignar cubiertas a posiciones ───────────────────────────────
  let ok = 0, sinCubierta = 0;
  const sinCubiertaFuegos = [];

  for (const row of rows) {
    const micro_id    = microMap[row.unidad_numero];
    const cubierta_id = cubMap[row.fuego];

    if (!cubierta_id) {
      sinCubierta++;
      if (sinCubiertaFuegos.length < 10) sinCubiertaFuegos.push(`fuego "${row.fuego}" (unidad ${row.unidad_numero})`);
      continue;
    }

    if (!DRY && micro_id !== -1) {
      await sql`
        UPDATE cubiertas
        SET micro_id = ${micro_id}, posicion = ${row.posicion}, almacen_id = NULL
        WHERE id = ${cubierta_id}
      `;
    }

    ok++;
    if (ok <= 5 || ok % 200 === 0)
      console.log(`  ✓ Unidad ${row.unidad_numero} | ${row.posicion} ← fuego ${row.fuego}`);
  }

  console.log(`
Resultado final:
  ✓ Unidades insertadas: ${nuevasUnidades}
  ✓ Posiciones asignadas: ${ok}
  ✗ Sin cubierta (fuego no encontrado): ${sinCubierta}
`);

  if (sinCubiertaFuegos.length) {
    console.log('Cubiertas no encontradas (muestra):');
    sinCubiertaFuegos.forEach(e => console.log(' ', e));
  }

  if (DRY) console.log('\n→ Corré sin --dry-run para aplicar los cambios.');
}

main().catch(err => { console.error(err); process.exit(1); });
