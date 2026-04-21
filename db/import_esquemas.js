/**
 * Script de importación de esquemas de cubiertas por unidad (carga masiva de posiciones)
 *
 * Uso:
 *   node db/import_esquemas.js ruta/al/archivo.csv
 *
 * Formato del CSV — una fila por unidad, columnas de posición opcionales:
 *   unidad,ddi,ddd,tie,tii,tdi,tde,cie,cii,cdi,cde,ra,ra2
 *
 * Ejemplo:
 *   unidad,ddi,ddd,tie,tii,tdi,tde,ra,ra2
 *   46,11201,11044,12047,,12048,12535,12036,
 *   175,12716,12717,,,11151,11152,11137,11138
 *
 * Notas:
 *   - "unidad" debe coincidir exactamente con el campo micro.unidad en la base de datos
 *   - Los fuegos deben existir ya en la tabla cubiertas
 *   - Las posiciones vacías se omiten (no se modifica esa posición)
 *   - Si una posición ya tiene cubierta asignada, se reemplaza (la anterior queda sin posición)
 *   - Posiciones válidas: ddi, ddd, tie, tii, tdi, tde, cie, cii, cdi, cde, ra, ra2
 */

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const POSICIONES_VALIDAS = new Set(['ddi','ddd','tie','tii','tdi','tde','cie','cii','cdi','cde','ra','ra2']);

function parseCSV(content) {
  const rows = [];
  for (const line of content.split('\n')) {
    const l = line.replace(/\r$/, '');
    if (!l.trim()) continue;
    const fields = [];
    let cur = '', inQ = false;
    for (const ch of l) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Uso: node db/import_esquemas.js archivo.csv');
    console.error('');
    console.error('Formato del CSV:');
    console.error('  unidad,ddi,ddd,tie,tii,tdi,tde,ra,ra2');
    console.error('  46,11201,11044,12047,,12048,12535,12036,');
    process.exit(1);
  }

  const fullPath = path.resolve(csvPath);
  if (!fs.existsSync(fullPath)) { console.error(`Archivo no encontrado: ${fullPath}`); process.exit(1); }

  const rows = parseCSV(fs.readFileSync(fullPath, 'utf8'));
  if (rows.length < 2) { console.error('CSV vacío o sin datos.'); process.exit(1); }

  const headers = rows[0].map(h => h.toLowerCase().trim());
  const unidadCol = headers.indexOf('unidad');
  if (unidadCol === -1) { console.error('No se encontró columna "unidad".'); process.exit(1); }

  // Detectar columnas de posiciones presentes en el CSV
  const posicionCols = [];
  for (let i = 0; i < headers.length; i++) {
    if (i !== unidadCol && POSICIONES_VALIDAS.has(headers[i])) {
      posicionCols.push({ col: i, pos: headers[i] });
    }
  }

  if (posicionCols.length === 0) {
    console.error('No se encontraron columnas de posición válidas (ddi, ddd, tie, tii, tdi, tde, cie, cii, cdi, cde, ra, ra2).');
    process.exit(1);
  }

  console.log(`Posiciones detectadas: ${posicionCols.map(p => p.pos).join(', ')}`);

  const client = await pool.connect();

  // Cargar unidades en caché
  const { rows: microRows } = await client.query('SELECT id, unidad FROM micro WHERE activo = 1');
  const microMap = new Map(microRows.map(m => [m.unidad.trim(), m.id]));

  let asignadas = 0, omitidas = 0, errores = 0;
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const unidadVal = row[unidadCol]?.trim();
    if (!unidadVal) { omitidas++; continue; }

    const microId = microMap.get(unidadVal);
    if (!microId) {
      console.warn(`  OMITIDA: unidad "${unidadVal}" no encontrada en la base de datos`);
      omitidas++;
      continue;
    }

    for (const { col, pos } of posicionCols) {
      const fuego = row[col]?.trim();
      if (!fuego) continue; // posición vacía, se omite

      // Buscar la cubierta por fuego
      const { rows: cRows } = await client.query(
        'SELECT id FROM cubiertas WHERE fuego = $1 AND activo = 1 LIMIT 1',
        [fuego]
      );
      if (!cRows.length) {
        console.warn(`  OMITIDA: cubierta fuego "${fuego}" (unidad ${unidadVal}, pos ${pos}) no encontrada`);
        omitidas++;
        continue;
      }
      const cubId = cRows[0].id;

      // Desasignar cualquier cubierta que ya ocupe esa posición en esa unidad
      await client.query(
        'UPDATE cubiertas SET micro_id = NULL, posicion = NULL WHERE micro_id = $1 AND posicion = $2 AND id != $3',
        [microId, pos, cubId]
      );

      // Asignar la nueva cubierta a la posición
      await client.query(
        'UPDATE cubiertas SET micro_id = $1, posicion = $2, almacen_id = NULL, gomeria_id = NULL WHERE id = $3',
        [microId, pos, cubId]
      );

      asignadas++;
    }
  }

  client.release();
  await pool.end();

  console.log(`\n${'─'.repeat(40)}`);
  console.log('Importación completada:');
  console.log(`  Posiciones asignadas: ${asignadas}`);
  console.log(`  Omitidas:             ${omitidas}`);
  console.log(`  Errores:              ${errores}`);
  console.log(`${'─'.repeat(40)}\n`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
