-- ============================================================
-- MASTER BUS - Schema PostgreSQL (Neon)
-- ============================================================

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  usuario VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  tipo SMALLINT DEFAULT 1,        -- 0=Gomeria, 1=MasterBus
  nombre VARCHAR(100),
  mail VARCHAR(100),
  avisa SMALLINT DEFAULT 0,       -- 0=NO, 1=SI (aviso por mail al cerrar OT)
  gomeria_id INTEGER,
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS almacen (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gomeria (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recapadora (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS micro (
  id SERIAL PRIMARY KEY,
  unidad VARCHAR(50) NOT NULL,
  descripcion VARCHAR(200),
  km_actual INTEGER DEFAULT 0,
  tipo_unidad SMALLINT DEFAULT 1,  -- 1, 2, 3 o 4 (tipo de vehículo)
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS marcas_ruedas (
  id SERIAL PRIMARY KEY,
  marca VARCHAR(50) NOT NULL,
  modelo VARCHAR(50) NOT NULL,
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS medidas (
  id SERIAL PRIMARY KEY,
  medida VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS proveedor (
  id SERIAL PRIMARY KEY,
  proveedor VARCHAR(100) NOT NULL,
  tel VARCHAR(50) DEFAULT '-',
  mail VARCHAR(100) DEFAULT '-'
);

CREATE TABLE IF NOT EXISTS cubiertas (
  id SERIAL PRIMARY KEY,
  fuego VARCHAR(20),
  modelo_id INTEGER REFERENCES marcas_ruedas(id),
  medida_id INTEGER REFERENCES medidas(id),
  estado SMALLINT DEFAULT 1,       -- 1=Nueva, 2=Usada, 3=Recapada
  almacen_id INTEGER REFERENCES almacen(id),
  gomeria_id INTEGER REFERENCES gomeria(id),
  micro_id INTEGER REFERENCES micro(id),
  posicion VARCHAR(10),            -- ddi, ddd, tie, tii, tdi, tde, cie, cii, cdi, cde, ra
  km INTEGER DEFAULT 0,
  proveedor_id INTEGER REFERENCES proveedor(id),
  id_interno VARCHAR(50),
  remito VARCHAR(50),
  fecha_remito DATE,
  precio DECIMAL(10,2),
  activo SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ots (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20),
  recapadora_id INTEGER REFERENCES recapadora(id),
  fecha DATE DEFAULT CURRENT_DATE,
  estado SMALLINT DEFAULT 0,       -- 0=Abierta, 1=Cerrada
  gomeria_id INTEGER REFERENCES gomeria(id),
  unidad_id INTEGER REFERENCES micro(id),
  factura VARCHAR(50),
  costo DECIMAL(10,2),
  solicitado_por VARCHAR(100),
  rotacion BOOLEAN DEFAULT FALSE,
  arreglo BOOLEAN DEFAULT FALSE,
  cambio BOOLEAN DEFAULT FALSE,
  alinear BOOLEAN DEFAULT FALSE,
  balanceo BOOLEAN DEFAULT FALSE,
  armar BOOLEAN DEFAULT FALSE,
  observaciones TEXT
);

CREATE TABLE IF NOT EXISTS ot_cubiertas (
  ot_id INTEGER REFERENCES ots(id) ON DELETE CASCADE,
  cubierta_id INTEGER REFERENCES cubiertas(id),
  posicion VARCHAR(10),            -- ddi, ddd, tie, tii, tdi, tde, cie, cii, cdi, cde, ra
  cubierta_anterior_id INTEGER REFERENCES cubiertas(id),
  PRIMARY KEY (ot_id, cubierta_id)
);

-- Usuario admin por defecto (password: admin)
-- El hash se genera al ejecutar db/seed.js
INSERT INTO usuarios (usuario, password, tipo, nombre, activo)
VALUES ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, 'Administrador', 1)
ON CONFLICT (usuario) DO NOTHING;
