// Migración: agregar columna km a ots (km de la unidad al momento del cierre)
// Ejecutar: node db/migrate_km_ot.js
require('dotenv').config();
const { sql } = require('./index');

(async () => {
  try {
    await sql`ALTER TABLE ots ADD COLUMN IF NOT EXISTS km INTEGER`;
    console.log('OK: columna km agregada a ots');
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
