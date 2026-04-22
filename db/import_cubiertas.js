/**
 * Script de importación de cubiertas desde CSV exportado de Google Sheets
 *
 * Uso:
 *   node db/import_cubiertas.js ruta/al/archivo.csv
 *
 * Cómo exportar el CSV desde Google Sheets:
 *   Archivo → Descargar → Valores separados por comas (.csv)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ESTADO_MAP = { 'NUEVA': 1, 'USADA': 2, 'RECAPADA': 3 };

// ─── CSV parser ──────────────────────────────────────────────────────────────

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

function parseDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  const year = parseInt(y);
  const month = parseInt(m);
  const day = parseInt(d);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// ─── Helpers de cache ─────────────────────────────────────────────────────────

async function cargarCache(client, table, keyFn, cols) {
  const { rows } = await client.query(`SELECT ${cols.join(', ')} FROM ${table}`);
  const map = new Map();
  for (const r of rows) map.set(keyFn(r), r.id);
  return map;
}

async function getOrInsert(client, map, key, table, insertCols, insertVals) {
  if (!key) return null;
  if (map.has(key)) return map.get(key);
  const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    insertVals
  );
  const id = rows[0].id;
  map.set(key, id);
  return id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) { console.error('Uso: node db/import_cubiertas.js archivo.csv'); process.exit(1); }

  const fullPath = path.resolve(csvPath);
  if (!fs.existsSync(fullPath)) { console.error(`Archivo no encontrado: ${fullPath}`); process.exit(1); }

  const rows = parseCSV(fs.readFileSync(fullPath, 'utf8'));
  if (rows.length < 2) { console.error('CSV vacío.'); process.exit(1); }

  const headerIdx = rows.findIndex(r => r.some(c => c.toLowerCase() === 'fuego'));
  if (headerIdx === -1) { console.error('No se encontró columna "fuego".'); process.exit(1); }

  const headers = rows[headerIdx].map(h => h.toLowerCase().trim());
  const col = name => headers.indexOf(name);
  const IDX = {
    fecha:   col('fecha'),
    fuego:   col('fuego'),
    medida:  col('medida'),
    marca:   col('marca'),
    modelo:  col('modelo'),
    estado:  col('estado'),
    factura: col('factura'),
    proov:   col('proov.'),
    interno: col('interno'),
    km:      col('km realizados'),
  };

  const client = await pool.connect();

  // 1. Cargar caches en memoria (3 queries al inicio, no uno por fila)
  console.log('Cargando datos existentes...');
  const medidas  = await cargarCache(client, 'medidas',      r => r.medida?.toUpperCase(),   ['id', 'medida']);
  const marcas   = await cargarCache(client, 'marcas_ruedas',r => `${r.marca?.toUpperCase()}|${r.modelo?.toUpperCase()}`, ['id', 'marca', 'modelo']);
  const provs    = await cargarCache(client, 'proveedor',    r => r.proveedor?.toUpperCase(), ['id', 'proveedor']);

  // 2. Cargar fuegos ya existentes en un Set
  const { rows: fuegoRows } = await client.query('SELECT fuego FROM cubiertas WHERE fuego IS NOT NULL');
  const fuegoExistentes = new Set(fuegoRows.map(r => r.fuego));
  console.log(`  ${fuegoExistentes.size} cubiertas ya en la base de datos.`);

  // 3. Procesar filas CSV en memoria
  const dataRows = rows.slice(headerIdx + 1);
  const toInsert = [];

  for (const row of dataRows) {
    const fuego = row[IDX.fuego]?.trim();
    if (!fuego || !/^\d+$/.test(fuego)) continue;
    if (fuegoExistentes.has(fuego)) continue;

    const medidaRaw = row[IDX.medida]?.trim();
    const marcaRaw  = row[IDX.marca]?.trim();
    const modeloRaw = row[IDX.modelo]?.trim();
    const estadoRaw = row[IDX.estado]?.trim().toUpperCase();

    // Omitir filas con solo número de fuego y sin ningún dato útil
    if (!medidaRaw && !marcaRaw && !modeloRaw && !estadoRaw) continue;
    const provRaw   = row[IDX.proov]?.trim();

    const medida_id = medidaRaw
      ? await getOrInsert(client, medidas, medidaRaw.toUpperCase(), 'medidas', ['medida'], [medidaRaw])
      : null;

    const marcaKey = (marcaRaw && modeloRaw) ? `${marcaRaw.toUpperCase()}|${modeloRaw.toUpperCase()}` : null;
    const modelo_id = marcaKey
      ? await getOrInsert(client, marcas, marcaKey, 'marcas_ruedas', ['marca', 'modelo'], [marcaRaw, modeloRaw])
      : null;

    const proveedor_id = provRaw
      ? await getOrInsert(client, provs, provRaw.toUpperCase(), 'proveedor', ['proveedor'], [provRaw])
      : null;

    toInsert.push([
      fuego,
      modelo_id,
      medida_id,
      ESTADO_MAP[estadoRaw] ?? 2,
      proveedor_id,
      row[IDX.interno]?.trim() || null,
      row[IDX.factura]?.trim() || null,
      (() => { const k = row[IDX.km]?.trim(); return k && /^\d+$/.test(k) ? parseInt(k) : 0; })(),
      parseDate(row[IDX.fecha]?.trim()),
    ]);
  }

  console.log(`  ${toInsert.length} cubiertas nuevas para importar.`);

  if (toInsert.length === 0) {
    console.log('Nada que importar.');
    client.release();
    await pool.end();
    return;
  }

  // 4. Insertar en lotes de 200 filas
  const BATCH = 200;
  let importadas = 0;

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const lote = toInsert.slice(i, i + BATCH);
    const values = [];
    const placeholders = lote.map((row, ri) => {
      const base = ri * 9;
      values.push(...row);
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},1)`;
    }).join(',\n');

    await client.query(
      `INSERT INTO cubiertas (fuego,modelo_id,medida_id,estado,proveedor_id,id_interno,remito,km,fecha_remito,activo)
       VALUES ${placeholders}`,
      values
    );

    importadas += lote.length;
    console.log(`  ${importadas}/${toInsert.length} cubiertas insertadas...`);
  }

  client.release();
  await pool.end();

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Importación completada:`);
  console.log(`  Importadas:              ${importadas}`);
  console.log(`  Omitidas (ya existían):  ${fuegoExistentes.size}`);
  console.log(`${'─'.repeat(40)}\n`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
