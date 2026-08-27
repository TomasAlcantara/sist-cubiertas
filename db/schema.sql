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
  permisos TEXT,                  -- CSV de slugs (ver lib/permisos.js). NULL = se deduce de `tipo`
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
  -- La cubierta no lleva estado: su vida (colocaciones, retiros, reparaciones,
  -- recapados) se lee de cubierta_eventos. Ver lib/cubiertaHistorial.js.
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
  km INTEGER,                      -- km de la unidad al momento del cierre
  solicitado_por VARCHAR(100),
  rotacion BOOLEAN DEFAULT FALSE,
  arreglo BOOLEAN DEFAULT FALSE,
  cambio BOOLEAN DEFAULT FALSE,
  alinear BOOLEAN DEFAULT FALSE,
  balanceo BOOLEAN DEFAULT FALSE,
  armar BOOLEAN DEFAULT FALSE,
  preventivo BOOLEAN DEFAULT FALSE,
  pinchadura BOOLEAN DEFAULT FALSE,
  rotura BOOLEAN DEFAULT FALSE,
  creado_en TIMESTAMPTZ DEFAULT NOW(),  -- fecha/hora real de alta (fecha = fecha de solicitud)
  descripcion_cierre TEXT,              -- lo que escribe el gomero al cerrar un preventivo
  cerrado_por VARCHAR(100),
  cerrado_en TIMESTAMPTZ,               -- hora de salida: creado_en..cerrado_en es lo que tardo el trabajo
  -- Anular es baja lógica: la OT se marca, no se borra, para que quede
  -- constancia de que existió y de quién la dio de baja.
  anulada BOOLEAN NOT NULL DEFAULT FALSE,
  anulada_por VARCHAR(50),
  anulada_en TIMESTAMPTZ,
  motivo_anulacion TEXT,
  observaciones TEXT
);
CREATE INDEX IF NOT EXISTS idx_ots_anulada ON ots (anulada) WHERE anulada = FALSE;

CREATE TABLE IF NOT EXISTS ot_cubiertas (
  ot_id INTEGER REFERENCES ots(id) ON DELETE CASCADE,
  cubierta_id INTEGER REFERENCES cubiertas(id),
  posicion VARCHAR(10),            -- ddi, ddd, tie, tii, tdi, tde, cie, cii, cdi, cde, ra
  cubierta_anterior_id INTEGER REFERENCES cubiertas(id),
  PRIMARY KEY (ot_id, cubierta_id)
);

-- Historial de vida de cada cubierta. Se llena solo al cerrar OTs.
-- Para datos ya existentes: node db/backfill_cubierta_eventos.js
CREATE TABLE IF NOT EXISTS cubierta_eventos (
  id SERIAL PRIMARY KEY,
  cubierta_id INTEGER NOT NULL REFERENCES cubiertas(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL,   -- alta | colocacion | retiro | reparacion | recapado | baja
  fecha DATE,                  -- NULL = sin dato (movimientos previos al historial)
  micro_id INTEGER REFERENCES micro(id),
  posicion VARCHAR(10),
  km_unidad INTEGER,           -- km de la unidad al momento del evento
  ot_id INTEGER REFERENCES ots(id) ON DELETE SET NULL,
  detalle TEXT,
  origen VARCHAR(10) DEFAULT 'sistema',  -- sistema | backfill
  creado_en TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cub_ev_cubierta ON cubierta_eventos (cubierta_id, fecha, id);
CREATE INDEX IF NOT EXISTS idx_cub_ev_ot ON cubierta_eventos (ot_id);
-- Evita duplicar eventos si se reprocesa el cierre de una misma OT
CREATE UNIQUE INDEX IF NOT EXISTS idx_cub_ev_unico
  ON cubierta_eventos (cubierta_id, tipo, ot_id) WHERE ot_id IS NOT NULL;

-- Config clave/valor: credenciales de mail para el aviso de pinchadura.
-- Cargarlas con: node db/set_mail_config.js
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- Log de auditoría: quién hizo qué, cuándo y qué cambió.
-- `usuario` guarda una copia del nombre además del id: si el usuario se da de
-- baja o se renombra, el log tiene que seguir siendo legible.
-- `cambios` es un array JSON de {campo, antes, despues}. Los campos sensibles
-- (password, tokens, credenciales de mail) se guardan enmascarados.
CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  usuario_id  INTEGER,
  usuario     VARCHAR(50),
  accion      VARCHAR(40) NOT NULL,   -- crear | editar | cerrar | anular | mover | login | ...
  entidad     VARCHAR(30) NOT NULL,   -- ot | cubierta | usuario | config | ...
  entidad_id  INTEGER,
  descripcion TEXT,
  cambios     JSONB,
  ip          VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_aud_fecha   ON auditoria (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_aud_entidad ON auditoria (entidad, entidad_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_aud_usuario ON auditoria (usuario, fecha DESC);

-- Usuario admin por defecto (password: admin)
-- El hash se genera al ejecutar db/seed.js
INSERT INTO usuarios (usuario, password, tipo, nombre, activo)
VALUES ('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, 'Administrador', 1)
ON CONFLICT (usuario) DO NOTHING;
