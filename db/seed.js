require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Conectado a Neon PostgreSQL');

  const tables = [
    `CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      usuario VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      tipo SMALLINT DEFAULT 1,
      nombre VARCHAR(100),
      mail VARCHAR(100),
      avisa SMALLINT DEFAULT 0,
      gomeria_id INTEGER,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS almacen (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS gomeria (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS recapadora (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS micro (
      id SERIAL PRIMARY KEY,
      unidad VARCHAR(50) NOT NULL,
      descripcion VARCHAR(200),
      km_actual INTEGER DEFAULT 0,
      tipo_unidad SMALLINT DEFAULT 1,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS marcas_ruedas (
      id SERIAL PRIMARY KEY,
      marca VARCHAR(50) NOT NULL,
      modelo VARCHAR(50) NOT NULL,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS medidas (
      id SERIAL PRIMARY KEY,
      medida VARCHAR(50) NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS proveedor (
      id SERIAL PRIMARY KEY,
      proveedor VARCHAR(100) NOT NULL,
      tel VARCHAR(50) DEFAULT '-',
      mail VARCHAR(100) DEFAULT '-'
    )`,
    `CREATE TABLE IF NOT EXISTS cubiertas (
      id SERIAL PRIMARY KEY,
      fuego VARCHAR(20),
      modelo_id INTEGER REFERENCES marcas_ruedas(id),
      medida_id INTEGER REFERENCES medidas(id),
      estado SMALLINT DEFAULT 1,
      almacen_id INTEGER REFERENCES almacen(id),
      gomeria_id INTEGER REFERENCES gomeria(id),
      micro_id INTEGER REFERENCES micro(id),
      posicion VARCHAR(10),
      km INTEGER DEFAULT 0,
      proveedor_id INTEGER REFERENCES proveedor(id),
      id_interno VARCHAR(50),
      remito VARCHAR(50),
      fecha_remito DATE,
      activo SMALLINT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS ots (
      id SERIAL PRIMARY KEY,
      numero VARCHAR(20),
      recapadora_id INTEGER REFERENCES recapadora(id),
      fecha DATE DEFAULT CURRENT_DATE,
      estado SMALLINT DEFAULT 0,
      gomeria_id INTEGER REFERENCES gomeria(id),
      unidad_id INTEGER REFERENCES micro(id),
      factura VARCHAR(50),
      costo DECIMAL(10,2)
    )`,
    `CREATE TABLE IF NOT EXISTS ot_cubiertas (
      ot_id INTEGER REFERENCES ots(id) ON DELETE CASCADE,
      cubierta_id INTEGER REFERENCES cubiertas(id),
      PRIMARY KEY (ot_id, cubierta_id)
    )`
  ];

  for (const stmt of tables) {
    try {
      await client.query(stmt);
    } catch (e) {
      console.error('Error creando tabla:', e.message);
    }
  }
  console.log('✓ Tablas creadas');

  const hash = await bcrypt.hash('admin', 10);
  await client.query(`
    INSERT INTO usuarios (usuario, password, tipo, nombre, activo)
    VALUES ($1, $2, 1, 'Administrador', 1)
    ON CONFLICT (usuario) DO UPDATE SET password = $2
  `, ['admin', hash]);
  console.log('✓ Usuario admin listo (contraseña: admin)');

  await client.end();
  console.log('✓ Seed completado');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
