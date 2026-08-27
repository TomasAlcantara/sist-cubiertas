const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { sql, sanitizeFuego } = require('../db');
const { requireAuth, requireMaster, requirePerm } = require('../middleware/auth');
const { enviarAvisoPinchadura } = require('../lib/mailer');
const { registrarEvento } = require('../lib/cubiertaHistorial');
const { sanitizarPermisos, tienePermiso } = require('../lib/permisos');
const { parseFecha, hoyISO } = require('../lib/fechas');
const auditoria = require('../lib/auditoria');

const isProd = process.env.NODE_ENV === 'production';

/**
 * Escapa caracteres HTML para prevenir XSS en HTML generado server-side.
 * Necesario cuando se concatena datos de BD en strings HTML sin template engine.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// POST /ajax/inactive - Activar/desactivar registro
router.post('/inactive', requireMaster, async (req, res, next) => {
  try {
    const { id, active, table } = req.body;
    const allowed = ['usuarios', 'almacen', 'gomeria', 'recapadora', 'micro', 'marcas_ruedas', 'cubiertas'];
    if (!allowed.includes(table)) return res.status(400).send('tabla no permitida');
    await sql(`UPDATE ${table} SET activo = $1 WHERE id = $2`, [active, parseInt(id) || 0]);
    const ENTIDAD = { usuarios: 'usuario', almacen: 'almacen', gomeria: 'gomeria',
                      recapadora: 'recapadora', micro: 'micro', marcas_ruedas: 'modelo', cubiertas: 'cubierta' };
    await auditoria.registrar({
      req, accion: String(active) === '1' ? 'alta' : 'baja', entidad: ENTIDAD[table] || table,
      entidad_id: parseInt(id) || 0,
      descripcion: `${String(active) === '1' ? 'Dio de alta' : 'Dio de baja'} el registro #${parseInt(id) || 0} en ${table}`,
      cambios: [{ campo: 'activo', antes: String(active) === '1' ? 'NO' : 'SI', despues: String(active) === '1' ? 'SI' : 'NO' }],
    });
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/change_filter - Cambiar filtro solo activos (usa cookie)
router.post('/change_filter', requireAuth, (req, res) => {
  const { activo } = req.body;
  res.cookie('soloActivos', activo, { httpOnly: true, secure: isProd, sameSite: isProd ? 'Strict' : 'Lax' });
  res.send('ok');
});

// POST /ajax/cargar_km - Cargar km individual
router.post('/cargar_km', requirePerm('km_cargar'), async (req, res, next) => {
  try {
    const { id, km } = req.body;
    const microId = parseInt(id) || 0;
    const kmNuevo = parseInt(km) || 0;
    const [antes] = await sql`SELECT unidad, km_actual FROM micro WHERE id = ${microId}`;
    await sql`UPDATE micro SET km_actual = ${kmNuevo} WHERE id = ${microId}`;
    await auditoria.registrar({
      req, accion: 'editar', entidad: 'km', entidad_id: microId,
      descripcion: `Cargó km de la unidad ${antes ? antes.unidad : microId}`,
      cambios: auditoria.diff(antes, { km_actual: kmNuevo }, ['km_actual']),
    });
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/carga_masiva_km - Carga masiva de km
router.post('/carga_masiva_km', requirePerm('km_cargar'), async (req, res, next) => {
  try {
    const pedidos = [];
    for (const key in req.body) {
      if (!key.startsWith('km_')) continue;
      const id = parseInt(key.replace('km_', '')) || 0;
      const km = parseInt(req.body[key]) || 0;
      if (id && req.body[key]) pedidos.push({ id, km });
    }
    if (!pedidos.length) return res.send('ok');

    const ids = pedidos.map(p => p.id);
    const antes = await sql`SELECT id, unidad, km_actual FROM micro WHERE id = ANY(${ids})`;
    const previo = {};
    for (const m of antes) previo[m.id] = m;

    await Promise.all(pedidos.map(p => sql`UPDATE micro SET km_actual = ${p.km} WHERE id = ${p.id}`));

    // Una sola entrada para toda la tanda: 40 líneas de log por una carga masiva
    // enterrarían el resto del historial.
    const detalle = pedidos
      .filter(p => !previo[p.id] || previo[p.id].km_actual !== p.km)
      .map(p => ({
        campo: previo[p.id] ? previo[p.id].unidad : ('unidad ' + p.id),
        antes: previo[p.id] ? previo[p.id].km_actual : null,
        despues: p.km,
      }));
    if (detalle.length) {
      await auditoria.registrar({
        req, accion: 'editar', entidad: 'km',
        descripcion: `Carga masiva de km: ${detalle.length} unidad(es) modificada(s)`,
        cambios: detalle,
      });
    }
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/mover_cubierta - Mover cubierta a otro almacén
router.post('/mover_cubierta', requirePerm('cubiertas_mover'), async (req, res, next) => {
  try {
    const { cubierta, almacen } = req.body;
    const cubId = parseInt(cubierta) || 0;
    // Si estaba montada, moverla a un almacén es un retiro y hay que dejarlo en el historial
    const antes = await sql`SELECT micro_id, posicion FROM cubiertas WHERE id = ${cubId}`;
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen) || null}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ${cubId}`;
    const [destino] = await sql`SELECT nombre FROM almacen WHERE id = ${parseInt(almacen) || 0}`;
    const [cub] = await sql`SELECT fuego FROM cubiertas WHERE id = ${cubId}`;
    await auditoria.registrar({
      req, accion: 'mover', entidad: 'cubierta', entidad_id: cubId,
      descripcion: `Movió la cubierta ${cub ? cub.fuego : cubId} al almacén ${destino ? destino.nombre : almacen}`,
      cambios: [{ campo: 'ubicación', antes: antes[0] && antes[0].micro_id ? 'montada en unidad' : 'almacén/gomería',
                  despues: destino ? destino.nombre : String(almacen) }],
    });

    if (antes[0] && antes[0].micro_id) {
      const km = await sql`SELECT km_actual FROM micro WHERE id = ${antes[0].micro_id}`;
      await registrarEvento({
        cubierta_id: cubId, tipo: 'retiro', fecha: hoyISO(),
        micro_id: antes[0].micro_id, posicion: antes[0].posicion,
        km_unidad: km[0] ? km[0].km_actual : null,
        detalle: 'Movida a almacén por fuera de una OT',
      });
    }
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/marcar_recapada - Asentar un recapado en el historial de la cubierta
//
// La cubierta ya no lleva una columna de estado: el recapado es un hito de su
// vida, así que se guarda como evento y se lee desde el historial.
router.post('/marcar_recapada', requirePerm('cubiertas_editar'), async (req, res, next) => {
  try {
    const cubId = parseInt(req.body.r_id) || 0;
    const previa = await sql`SELECT fuego FROM cubiertas WHERE id = ${cubId}`;
    if (!previa.length) return res.status(404).send('Cubierta inexistente');

    await registrarEvento({
      cubierta_id: cubId, tipo: 'recapado', fecha: hoyISO(),
      detalle: 'Marcada como recapada',
    });
    await auditoria.registrar({
      req, accion: 'editar', entidad: 'cubierta', entidad_id: cubId,
      descripcion: `Asentó un recapado de la cubierta ${previa[0].fuego}`,
      cambios: [{ campo: 'historial', antes: null, despues: 'Recapado' }],
    });
    res.send('ok');
  } catch (err) { next(err); }
});

/**
 * Audita un ABM simple: relee la fila y compara contra el estado previo.
 * Los ocho ABMs de administración tienen la misma forma, así que en vez de
 * repetir el bloque en cada uno se centraliza acá.
 */
async function auditarAbm(req, { tabla, entidad, id, antes, etiqueta, campos }) {
  const idInt = parseInt(id) || null;
  const esNuevo = !idInt;
  let despues = null;
  try {
    if (idInt) {
      const filas = await sql(`SELECT * FROM ${tabla} WHERE id = $1`, [idInt]);
      despues = filas[0] || null;
    } else {
      // Sin id conocido, la recién creada es la última: alcanza para el log.
      const filas = await sql(`SELECT * FROM ${tabla} ORDER BY id DESC LIMIT 1`);
      despues = filas[0] || null;
    }
  } catch (_) { /* si no se puede releer, se loguea igual sin el diff */ }

  await auditoria.registrar({
    req,
    accion: esNuevo ? 'crear' : 'editar',
    entidad,
    entidad_id: despues ? despues.id : idInt,
    descripcion: `${esNuevo ? 'Creó' : 'Editó'} ${etiqueta}` + (despues && despues.id ? ` #${despues.id}` : ''),
    cambios: esNuevo
      ? auditoria.diff(null, auditoria.snapshot(despues, campos) || {}, campos)
      : auditoria.diff(antes, despues, campos),
  });
}

// POST /ajax/save_usuario
const saveUsuarioValidators = [
  body('usuario')
    .trim()
    .notEmpty().withMessage('El nombre de usuario es requerido')
    .isLength({ min: 3, max: 50 }).withMessage('Usuario debe tener entre 3 y 50 caracteres')
    .matches(/^[a-zA-Z0-9._@-]+$/).withMessage('Usuario contiene caracteres no válidos'),
  body('tipo')
    .isInt({ min: 0, max: 1 }).withMessage('Tipo de usuario inválido'),
  body('password')
    .optional({ checkFalsy: true })
    .isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('mail')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('El email tiene formato inválido'),
];

router.post('/save_usuario', requireMaster, saveUsuarioValidators, async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map(e => e.msg).join(' | ');
    return res.status(400).send(msg);
  }
  try {
    const { id, usuario, password, tipo, nombre, mail, avisa, gomeria, permisos } = req.body;
    const hash = password ? await bcrypt.hash(password, 10) : null;

    // Nunca guardar el CSV crudo: solo slugs que existan en el catálogo.
    const permisosCsv = sanitizarPermisos(permisos).join(',');
    if (!permisosCsv) return res.status(400).send('Seleccione al menos un permiso válido');

    // Quitarse a uno mismo el permiso de administrar deja el sistema sin acceso
    // a la administración si es el único admin. Se bloquea de entrada.
    if (id && parseInt(id) === parseInt(req.user.id) && !permisosCsv.split(',').includes('admin')) {
      return res.status(400).send('No podés quitarte a vos mismo el permiso de Administración');
    }

    const CAMPOS_USR = ['usuario', 'tipo', 'nombre', 'mail', 'avisa', 'gomeria_id', 'permisos'];
    const nuevoUsr = {
      usuario: usuario.trim(), tipo: parseInt(tipo), nombre: nombre || null, mail: mail || null,
      avisa: parseInt(avisa) || 0, gomeria_id: parseInt(gomeria) || null, permisos: permisosCsv,
    };

    if (id) {
      const [antesUsr] = await sql`SELECT * FROM usuarios WHERE id = ${parseInt(id)}`;
      if (hash) {
        await sql`UPDATE usuarios SET usuario=${usuario.trim()}, password=${hash}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null}, permisos=${permisosCsv} WHERE id=${parseInt(id)}`;
      } else {
        await sql`UPDATE usuarios SET usuario=${usuario.trim()}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null}, permisos=${permisosCsv} WHERE id=${parseInt(id)}`;
      }
      // El cambio de contraseña se deja asentado, nunca su valor.
      const cambiosUsr = auditoria.diff(antesUsr, nuevoUsr, CAMPOS_USR);
      if (hash) cambiosUsr.push({ campo: 'password', antes: '***', despues: '*** (cambiada)' });
      await auditoria.registrar({
        req, accion: 'editar', entidad: 'usuario', entidad_id: parseInt(id),
        descripcion: `Editó el usuario ${antesUsr ? antesUsr.usuario : id}`,
        cambios: cambiosUsr,
      });
      res.send('Usuario actualizado correctamente');
    } else {
      if (!hash) return res.status(400).send('Contraseña requerida');
      await sql`INSERT INTO usuarios (usuario, password, tipo, nombre, mail, avisa, gomeria_id, permisos) VALUES (${usuario.trim()},${hash},${parseInt(tipo)},${nombre||null},${mail||null},${parseInt(avisa)||0},${parseInt(gomeria)||null},${permisosCsv})`;
      const [creado] = await sql`SELECT id FROM usuarios WHERE usuario = ${usuario.trim()} ORDER BY id DESC LIMIT 1`;
      await auditoria.registrar({
        req, accion: 'crear', entidad: 'usuario', entidad_id: creado ? creado.id : null,
        descripcion: `Creó el usuario ${usuario.trim()}`,
        cambios: auditoria.diff(null, nuevoUsr, CAMPOS_USR),
      });
      res.send('Usuario creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_micro
router.post('/save_micro', requireMaster, async (req, res, next) => {
  try {
    const { id, unidad, descripcion, tipo_unidad, km_actual } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM micro WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    const km = parseInt(km_actual) || 0;
    if (id) {
      await sql`UPDATE micro SET unidad=${unidad}, descripcion=${descripcion||null}, tipo_unidad=${parseInt(tipo_unidad)||1}, km_actual=${km} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'micro', entidad:'micro', id, antes: prevAbm, etiqueta:'la unidad', campos:['unidad','descripcion','tipo_unidad','km_actual','activo'] });
      res.send('Unidad actualizada correctamente');
    } else {
      await sql`INSERT INTO micro (unidad, descripcion, tipo_unidad, km_actual) VALUES (${unidad},${descripcion||null},${parseInt(tipo_unidad)||1},${km})`;
      await auditarAbm(req, { tabla:'micro', entidad:'micro', id:null, antes:null, etiqueta:'la unidad', campos:['unidad','descripcion','tipo_unidad','km_actual'] });
      res.send('Unidad creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_modelo
router.post('/save_modelo', requireMaster, async (req, res, next) => {
  try {
    const { id, marca, modelo } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM marcas_ruedas WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    if (id) {
      await sql`UPDATE marcas_ruedas SET marca=${marca}, modelo=${modelo} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'marcas_ruedas', entidad:'modelo', id, antes: prevAbm, etiqueta:'el modelo', campos:['marca','modelo','activo'] });
      res.send('Modelo actualizado correctamente');
    } else {
      await sql`INSERT INTO marcas_ruedas (marca, modelo) VALUES (${marca},${modelo})`;
      await auditarAbm(req, { tabla:'marcas_ruedas', entidad:'modelo', id:null, antes:null, etiqueta:'el modelo', campos:['marca','modelo'] });
      res.send('Modelo creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_proveedor
router.post('/save_proveedor', requireMaster, async (req, res, next) => {
  try {
    const { id, proveedor, tel, mail } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM proveedor WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    if (id) {
      await sql`UPDATE proveedor SET proveedor=${proveedor}, tel=${tel||'-'}, mail=${mail||'-'} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'proveedor', entidad:'proveedor', id, antes: prevAbm, etiqueta:'el proveedor', campos:['proveedor','tel','mail'] });
      res.send('Proveedor actualizado correctamente');
    } else {
      await sql`INSERT INTO proveedor (proveedor, tel, mail) VALUES (${proveedor},${tel||'-'},${mail||'-'})`;
      await auditarAbm(req, { tabla:'proveedor', entidad:'proveedor', id:null, antes:null, etiqueta:'el proveedor', campos:['proveedor','tel','mail'] });
      res.send('Proveedor creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_almacen
router.post('/save_almacen', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono, cargar_id, cargar_remito } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM almacen WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    const cId  = cargar_id     === '1';
    const cRem = cargar_remito === '1';
    if (id) {
      await sql`UPDATE almacen SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel}, cargar_id=${cId}, cargar_remito=${cRem} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'almacen', entidad:'almacen', id, antes: prevAbm, etiqueta:'el almacén', campos:['nombre','direccion','localidad','telefono','activo'] });
      res.send('Almacén actualizado correctamente');
    } else {
      await sql`INSERT INTO almacen (nombre, direccion, localidad, telefono, cargar_id, cargar_remito) VALUES (${nombre}, ${dir}, ${loc}, ${tel}, ${cId}, ${cRem})`;
      await auditarAbm(req, { tabla:'almacen', entidad:'almacen', id:null, antes:null, etiqueta:'el almacén', campos:['nombre','direccion','localidad','telefono'] });
      res.send('Almacén creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_gomeria
router.post('/save_gomeria', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM gomeria WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    if (id) {
      await sql`UPDATE gomeria SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'gomeria', entidad:'gomeria', id, antes: prevAbm, etiqueta:'la gomería', campos:['nombre','direccion','localidad','telefono','activo'] });
      res.send('Gomería actualizada correctamente');
    } else {
      await sql`INSERT INTO gomeria (nombre, direccion, localidad, telefono) VALUES (${nombre}, ${dir}, ${loc}, ${tel})`;
      await auditarAbm(req, { tabla:'gomeria', entidad:'gomeria', id:null, antes:null, etiqueta:'la gomería', campos:['nombre','direccion','localidad','telefono'] });
      res.send('Gomería creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_recapadora
router.post('/save_recapadora', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono, tipo_trabajo } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM recapadora WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    const tip = tipo_trabajo?.trim() || null;
    if (id) {
      await sql`UPDATE recapadora SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel}, tipo_trabajo=${tip} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'recapadora', entidad:'recapadora', id, antes: prevAbm, etiqueta:'la recapadora', campos:['nombre','direccion','localidad','telefono','tipo_trabajo','activo'] });
      res.send('Recapadora actualizada correctamente');
    } else {
      await sql`INSERT INTO recapadora (nombre, direccion, localidad, telefono, tipo_trabajo) VALUES (${nombre}, ${dir}, ${loc}, ${tel}, ${tip})`;
      await auditarAbm(req, { tabla:'recapadora', entidad:'recapadora', id:null, antes:null, etiqueta:'la recapadora', campos:['nombre','direccion','localidad','telefono','tipo_trabajo'] });
      res.send('Recapadora creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_medida
router.post('/save_medida', requireMaster, async (req, res, next) => {
  try {
    const { id, medida } = req.body;
    // Estado previo, para que el log pueda mostrar antes -> despues
    const prevAbm = id ? (await sql(`SELECT * FROM medidas WHERE id = $1`, [parseInt(id) || 0]))[0] || null : null;
    if (id) {
      await sql`UPDATE medidas SET medida=${medida} WHERE id=${parseInt(id)}`;
      await auditarAbm(req, { tabla:'medidas', entidad:'medida', id, antes: prevAbm, etiqueta:'la medida', campos:['medida'] });
      res.send('Medida actualizada correctamente');
    } else {
      await sql`INSERT INTO medidas (medida) VALUES (${medida})`;
      await auditarAbm(req, { tabla:'medidas', entidad:'medida', id:null, antes:null, etiqueta:'la medida', campos:['medida'] });
      res.send('Medida creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/listar_ruedas - Listar cubiertas para selección en micro u OT
router.post('/listar_ruedas', requirePerm('cubiertas_ver'), async (req, res, next) => {
  try {
    const { almacen = 0, fuego = '', modelo = 0, medida = 0, micro_id, pos, modo = 'micro', unidad_id, current_pos, orden = 'asc' } = req.body;
    const orderDir = orden === 'desc' ? 'DESC' : 'ASC';

    const [cubiertas, rotacion] = await Promise.all([
      // Cubiertas en almacén (disponibles)
      orderDir === 'DESC'
        ? sql`
            SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida, c.km
            FROM cubiertas c
            LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
            LEFT JOIN medidas med ON c.medida_id = med.id
            WHERE c.activo = 1
              AND c.micro_id IS NULL
              AND (${parseInt(almacen)} = 0 OR c.almacen_id = ${parseInt(almacen)})
              AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
              AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
              AND (${parseInt(medida)} = 0 OR c.medida_id = ${parseInt(medida)})
            ORDER BY CASE WHEN c.fuego ~ '^\d+$' THEN CAST(c.fuego AS INTEGER) ELSE 0 END DESC, c.fuego DESC
            LIMIT 50
          `
        : sql`
            SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida, c.km
            FROM cubiertas c
            LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
            LEFT JOIN medidas med ON c.medida_id = med.id
            WHERE c.activo = 1
              AND c.micro_id IS NULL
              AND (${parseInt(almacen)} = 0 OR c.almacen_id = ${parseInt(almacen)})
              AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
              AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
              AND (${parseInt(medida)} = 0 OR c.medida_id = ${parseInt(medida)})
            ORDER BY CASE WHEN c.fuego ~ '^\d+$' THEN CAST(c.fuego AS INTEGER) ELSE 0 END ASC, c.fuego ASC
            LIMIT 50
          `,
      // Cubiertas montadas en la unidad para rotación (solo en modo OT con unidad_id)
      modo === 'ot' && parseInt(unidad_id)
        ? sql`
            SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida, c.km, c.posicion
            FROM cubiertas c
            LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
            LEFT JOIN medidas med ON c.medida_id = med.id
            WHERE c.activo = 1
              AND c.micro_id = ${parseInt(unidad_id)}
              AND c.posicion IS NOT NULL
              AND (${current_pos || ''} = '' OR c.posicion != ${current_pos || ''})
              AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
            ORDER BY c.posicion
          `
        : Promise.resolve([]),
    ]);

    const posNombre = (p) => ({
      ddi:'Del. Izq.', ddd:'Del. Der.',
      tie:'Tras. Izq. Ext.', tii:'Tras. Izq. Int.',
      tdi:'Tras. Der. Int.', tde:'Tras. Der. Ext.',
      cie:'Cen. Izq. Ext.', cii:'Cen. Izq. Int.',
      cdi:'Cen. Der. Int.', cde:'Cen. Der. Ext.',
      ra:'Auxilio', ra2:'Auxilio 2'
    })[p] || p;

    const escJs = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let html = '';

    // ── Sección rotación primero (solo OT) ──────────────────────
    if (modo === 'ot' && rotacion.length > 0) {
      html += `<div style="margin-bottom:10px; border-bottom:2px solid #e0a800; padding-bottom:10px;">
        <p style="margin:0 0 6px 0; font-size:12px; font-weight:700; color:#b8860b; letter-spacing:0.06em; text-transform:uppercase;">
          ↺ Rotación — cubiertas montadas en esta unidad
        </p>
        <table>
          <thead><th>Fuego</th><th>Posición actual</th><th>Modelo</th><th>Medida</th><th></th></thead>`;
      for (const c of rotacion) {
        const fuegoEsc  = escJs(c.fuego);
        const modeloEsc = escJs(((c.marca || '') + ' ' + (c.modelo_nombre || '')).trim());
        const medidaEsc = escJs(c.medida || '-');
        html += `<tr style="background:#fffbe6;">
          <td style="font-family:'IBM Plex Mono',monospace;font-variant-numeric:slashed-zero;">${escapeHtml(c.fuego) || '-'}</td>
          <td style="color:#b8860b; font-weight:600;">${escapeHtml(posNombre(c.posicion))}</td>
          <td>${escapeHtml(c.marca)} ${escapeHtml(c.modelo_nombre)}</td>
          <td>${escapeHtml(c.medida) || '-'}</td>
          <td><input type="button" value="Rotar aquí" style="background:#e6a800;border:none;color:#fff;padding:4px 10px;cursor:pointer;border-radius:3px;"
               onclick="seleccionar_ot(${c.id}, '${fuegoEsc}', '${modeloEsc}', '${medidaEsc}')" /></td>
        </tr>`;
      }
      html += '</table></div>';
    }

    // ── Sección almacén ──────────────────────────────────────────
    html += '<table><thead><th>Fuego</th><th>Modelo</th><th>Medida</th><th>Km</th><th></th></thead>';
    if (cubiertas.length === 0) {
      html += '<tr><td colspan="6" style="text-align:center; color:#888; padding:8px;">No hay cubiertas disponibles en almacén.</td></tr>';
    }
    for (const c of cubiertas) {
      const fuegoEsc  = escJs(c.fuego);
      const modeloEsc = escJs(((c.marca || '') + ' ' + (c.modelo_nombre || '')).trim());
      const medidaEsc = escJs(c.medida || '-');
      const posEsc    = escJs(pos);
      const btn = modo === 'ot'
        ? `<input type="button" value="Seleccionar" onclick="seleccionar_ot(${c.id}, '${fuegoEsc}', '${modeloEsc}', '${medidaEsc}')" />`
        : `<input type="button" value="Seleccionar" onclick="colocar(${c.id}, ${parseInt(micro_id) || 0}, '${posEsc}')" />`;
      html += `<tr>
        <td>${escapeHtml(c.fuego) || '-'}</td>
        <td>${escapeHtml(c.marca)} ${escapeHtml(c.modelo_nombre)}</td>
        <td>${escapeHtml(c.medida) || '-'}</td>
        <td>${parseInt(c.km) || 0}</td>
        <td>${btn}</td>
      </tr>`;
    }
    html += '</table>';

    res.send(html);
  } catch (err) { next(err); }
});

// GET /ajax/ultimo_fuego - Sugerir el siguiente número de fuego (basado en la última cubierta creada)
router.get('/ultimo_fuego', requirePerm('cubiertas_crear'), async (req, res, next) => {
  try {
    const [row] = await sql`
      SELECT fuego FROM cubiertas WHERE activo = 1 ORDER BY id DESC LIMIT 1
    `;
    if (!row?.fuego) return res.json({ sugerido: '1' });
    const base = sanitizeFuego(row.fuego);
    const m = base.match(/^(.*?)(\d+)$/);
    const sugerido = m ? m[1] + String(parseInt(m[2]) + 1).padStart(m[2].length, '0') : base + '1';
    res.json({ sugerido });
  } catch (err) { next(err); }
});

// GET /ajax/cubiertas_unidad - Obtener cubiertas actuales de un micro por posición
router.get('/cubiertas_unidad', requirePerm('cubiertas_ver'), async (req, res, next) => {
  try {
    const { unidad_id } = req.query;
    if (!unidad_id) return res.json({ tipo_unidad: 1, cubiertas: [] });
    const [micros, cubiertas] = await Promise.all([
      sql`SELECT tipo_unidad FROM micro WHERE id = ${parseInt(unidad_id) || 0}`,
      sql`
        SELECT c.id, c.fuego, c.posicion
        FROM cubiertas c
        WHERE c.micro_id = ${parseInt(unidad_id) || 0} AND c.activo = 1 AND c.posicion IS NOT NULL
        ORDER BY c.posicion
      `
    ]);
    res.json({
      tipo_unidad: micros[0]?.tipo_unidad || 1,
      cubiertas
    });
  } catch (err) { next(err); }
});

// POST /ajax/colocar_rueda - Colocar cubierta en posición de micro
router.post('/colocar_rueda', requirePerm('cubiertas_mover'), async (req, res, next) => {
  try {
    const { id, unidad, pos } = req.body;
    const existing = await sql`SELECT id FROM cubiertas WHERE micro_id = ${parseInt(unidad) || 0} AND posicion = ${pos} AND activo = 1`;
    if (existing.length) {
      await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL WHERE id = ${existing[0].id}`;
    }
    await sql`UPDATE cubiertas SET micro_id = ${parseInt(unidad) || null}, posicion = ${pos}, almacen_id = NULL, gomeria_id = NULL
      WHERE id = ${parseInt(id) || 0}`;

    const [cubC] = await sql`SELECT fuego FROM cubiertas WHERE id = ${parseInt(id) || 0}`;
    const [uniC] = await sql`SELECT unidad FROM micro WHERE id = ${parseInt(unidad) || 0}`;
    await auditoria.registrar({
      req, accion: 'colocar', entidad: 'cubierta', entidad_id: parseInt(id) || 0,
      descripcion: `Colocó la cubierta ${cubC ? cubC.fuego : id} en ${uniC ? uniC.unidad : unidad}, posición ${pos}`,
      cambios: [
        { campo: 'unidad', antes: null, despues: uniC ? uniC.unidad : String(unidad) },
        { campo: 'posición', antes: null, despues: String(pos) },
        ...(existing.length ? [{ campo: 'desplaza a', antes: null, despues: 'cubierta id ' + existing[0].id }] : []),
      ],
    });
    res.send('OK');
  } catch (err) { next(err); }
});

// POST /ajax/almacenar_rueda - Guardar cubierta en almacén desde micro
router.post('/almacenar_rueda', requirePerm('cubiertas_mover'), async (req, res, next) => {
  try {
    const { r_id, almacen_id } = req.body;
    const cubIdA = parseInt(r_id) || 0;
    const [antesA] = await sql`SELECT c.fuego, c.posicion, m.unidad FROM cubiertas c LEFT JOIN micro m ON c.micro_id = m.id WHERE c.id = ${cubIdA}`;
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen_id) || null}, micro_id = NULL, posicion = NULL, gomeria_id = NULL WHERE id = ${cubIdA}`;
    const [almA] = await sql`SELECT nombre FROM almacen WHERE id = ${parseInt(almacen_id) || 0}`;
    await auditoria.registrar({
      req, accion: 'almacenar', entidad: 'cubierta', entidad_id: cubIdA,
      descripcion: `Almacenó la cubierta ${antesA ? antesA.fuego : cubIdA} en ${almA ? almA.nombre : almacen_id}`,
      cambios: [{ campo: 'ubicación',
                  antes: antesA && antesA.unidad ? `${antesA.unidad} (${antesA.posicion || '-'})` : null,
                  despues: almA ? almA.nombre : String(almacen_id) }],
    });
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/almacenar_ruedas - Guardar múltiples cubiertas en almacén
router.post('/almacenar_ruedas', requirePerm('cubiertas_mover'), async (req, res, next) => {
  try {
    const { almacen_id, cubiertas_ids } = req.body;
    if (!cubiertas_ids) return res.send('ok');
    const ids = (Array.isArray(cubiertas_ids) ? cubiertas_ids : [cubiertas_ids]).map(Number).filter(Boolean);
    if (!ids.length) return res.send('ok');
    const antesM = await sql`SELECT id, fuego FROM cubiertas WHERE id = ANY(${ids})`;
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen_id) || null}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ANY(${ids})`;
    const [almM] = await sql`SELECT nombre FROM almacen WHERE id = ${parseInt(almacen_id) || 0}`;
    await auditoria.registrar({
      req, accion: 'almacenar', entidad: 'cubierta',
      descripcion: `Almacenó ${ids.length} cubierta(s) en ${almM ? almM.nombre : almacen_id}`,
      cambios: [{ campo: 'cubiertas', antes: null, despues: antesM.map(c => c.fuego || c.id).join(', ') }],
    });
    res.send('ok');
  } catch (err) { next(err); }
});

/**
 * Una OT es "solo preventivo" cuando tiene el preventivo marcado y ningun otro
 * trabajo. Solo esas puede cerrarlas un gomero, y con descripcion obligatoria;
 * las que tienen trabajo real las cierra un administrador.
 */
const TRABAJOS_REALES = ['rotacion', 'arreglo', 'cambio', 'alinear', 'balanceo', 'armar'];

function esSoloPreventivo(ot) {
  if (!ot || !ot.preventivo) return false;
  return TRABAJOS_REALES.every(t => !ot[t]);
}

/** Quien no tiene ot_cerrar solo llega hasta los preventivos. */
function puedeCerrar(user, ot) {
  if (tienePermiso(user, 'ot_cerrar')) return true;
  return tienePermiso(user, 'ot_cerrar_preventivo') && esSoloPreventivo(ot);
}

// POST /ajax/mb_cerrar_ot - Devuelve formulario HTML para confirmar cierre de OT
const posNombreCierre = (p) => ({
  ddi:'Del. Izq.', ddd:'Del. Der.', tie:'Tras. Izq. Ext.', tii:'Tras. Izq. Int.',
  tdi:'Tras. Der. Int.', tde:'Tras. Der. Ext.', cie:'Cen. Izq. Ext.', cii:'Cen. Izq. Int.',
  cdi:'Cen. Der. Int.', cde:'Cen. Der. Ext.', ra:'Auxilio', ra2:'Auxilio 2'
})[p] || p;

router.post('/mb_cerrar_ot', requirePerm('ot_cerrar', 'ot_cerrar_preventivo'), async (req, res, next) => {
  try {
    const { ot_id } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    const [rows, almacenes] = await Promise.all([
      sql`
        SELECT o.*, m.unidad, m.km_actual, m.tipo_unidad, g.nombre AS gomeria_nombre
        FROM ots o
        LEFT JOIN micro m ON o.unidad_id = m.id
        LEFT JOIN gomeria g ON o.gomeria_id = g.id
        WHERE o.id = ${otIdInt}
      `,
      sql`SELECT id, nombre FROM almacen WHERE activo = 1 ORDER BY nombre`,
    ]);
    if (!rows.length) return res.send('');
    const ot = rows[0];

    if (ot.anulada) {
      return res.send(`<div style="padding:22px; text-align:center;">
        <p style="font-size:14px; margin:0 0 16px 0;"><strong>Esta OT está anulada</strong></p>
        <input type="button" value="Cerrar" onclick="close_carga();" style="width:100px;font-size:13px;" />
      </div>`);
    }

    if (!puedeCerrar(req.user, ot)) {
      return res.send(`<div style="padding:22px; text-align:center;">
        <p style="font-size:14px; margin:0 0 6px 0;"><strong>Esta OT la cierra un administrador</strong></p>
        <p style="font-size:12.5px; color:#888; margin:0 0 16px 0;">
          Solo se pueden cerrar desde gomería las OTs que son únicamente de Preventivo.
        </p>
        <input type="button" value="Cerrar" onclick="close_carga();" style="width:100px;font-size:13px;" />
      </div>`);
    }

    // El gomero cierra un preventivo: no hay trabajos que tildar, ni factura,
    // ni cubiertas salientes que mandar a ningún lado. Solo km y descripción.
    const cierreReducido = !tienePermiso(req.user, 'ot_cerrar');

    // Cubiertas de la OT (entrantes) con sus salientes
    const [otCubiertas, unitTires] = await Promise.all([
      sql`
        SELECT oc.posicion, c_in.fuego AS fuego_in, c_out.fuego AS fuego_out
        FROM ot_cubiertas oc
        JOIN cubiertas c_in ON oc.cubierta_id = c_in.id
        LEFT JOIN cubiertas c_out ON oc.cubierta_anterior_id = c_out.id
        WHERE oc.ot_id = ${otIdInt} AND oc.posicion IS NOT NULL
        ORDER BY oc.posicion
      `,
      ot.unidad_id
        ? sql`SELECT fuego, posicion FROM cubiertas WHERE micro_id = ${ot.unidad_id} AND activo = 1 AND posicion IS NOT NULL`
        : Promise.resolve([]),
    ]);

    // Mapas: entrantes (OT), salientes (OT), actuales (unidad)
    const mapaIn  = {};  // pos → fuego nuevo (entrante)
    const mapaOut = {};  // pos → fuego saliente (si se registró anterior)
    otCubiertas.forEach(c => {
      mapaIn[c.posicion]  = c.fuego_in  || 'S/N';
      if (c.fuego_out) mapaOut[c.posicion] = c.fuego_out;
    });
    const mapaUnidad = {}; // pos → fuego actualmente montado
    unitTires.forEach(t => { mapaUnidad[t.posicion] = t.fuego || '-'; });

    const tipoUnidad = parseInt(ot.tipo_unidad) || 1;

    const LAYOUTS = {
      1: { del:['ddi','ddd'], tr1:['tie','tde'],             tr2:[],           aux:['ra'],       bodyH:140 },
      2: { del:['ddi','ddd'], tr1:['cie','cii','cdi','cde'], tr2:['tie','tde'], aux:['ra','ra2'], bodyH:80  },
      3: { del:['ddi','ddd'], tr1:['tie','tii','tdi','tde'], tr2:[],           aux:['ra','ra2'], bodyH:140 },
      4: { del:['ddi','ddd'], tr1:['tie','tii','tdi','tde'], tr2:[],           aux:['ra','ra2'], bodyH:140 },
    };
    const L = LAYOUTS[tipoUnidad] || LAYOUTS[1];

    const fMono = "font-family:'IBM Plex Mono',monospace;font-variant-numeric:slashed-zero;font-weight:600;text-align:center;word-break:break-all;line-height:1.2;padding:2px;";

    // Genera rueda con dos filas si hay cambio, o una fila si solo está montada
    const mkRuedaRO = (pos) => {
      const entrante = mapaIn[pos];
      const saliente = mapaOut[pos] || (entrante ? mapaUnidad[pos] : null);
      const actual   = mapaUnidad[pos];

      if (entrante) {
        // Posición con cambio: fila superior = saliente (rojo), fila inferior = entrante (verde)
        const rowOut = saliente
          ? `<span style="${fMono}font-size:9px;color:#e57373;border-bottom:1px solid #333;width:100%;display:flex;align-items:center;justify-content:center;flex:1;">${escapeHtml(saliente)}</span>`
          : `<span style="font-size:12px;color:#333;border-bottom:1px solid #333;width:100%;display:flex;align-items:center;justify-content:center;flex:1;">·</span>`;
        const rowIn  = `<span style="${fMono}font-size:9px;color:#66bb6a;width:100%;display:flex;align-items:center;justify-content:center;flex:1;">${escapeHtml(entrante)}</span>`;
        return `<div style="width:62px;height:90px;background:#0a1a0a;border:2px solid #2e7d32;display:inline-flex;align-items:stretch;margin:2px;flex-direction:column;overflow:hidden;">` +
               rowOut + rowIn + `</div>`;
      } else if (actual) {
        // Posición sin cambio en esta OT: mostrar cubierta actual en gris
        return `<div style="width:62px;height:90px;background:#1a1a1a;border:2px solid #555;display:inline-flex;align-items:center;justify-content:center;margin:2px;flex-direction:column;">` +
               `<span style="${fMono}font-size:9px;color:#aaa;">${escapeHtml(actual)}</span>` +
               `</div>`;
      } else {
        // Vacío
        return `<div style="width:62px;height:90px;background:#111;border:2px dashed #333;display:inline-flex;align-items:center;justify-content:center;margin:2px;">` +
               `<span style="color:#2a2a2a;font-size:18px;">·</span></div>`;
      }
    };

    const spacer  = '<div style="width:56px;"></div>';
    const body200 = '<div style="width:200px;"></div>';
    const topBot  = '<div style="background:#fff;border:2px solid #333;width:200px;height:16px;"></div>';
    const side    = `<div style="background:#fff;border-left:2px solid #333;border-right:2px solid #333;width:200px;height:${L.bodyH}px;"></div>`;
    const axle    = '<div style="background:#ddd;border-left:2px solid #333;border-right:2px solid #333;width:200px;height:24px;"></div>';
    const row     = (content) => `<div style="display:flex;align-items:center;justify-content:center;">${content}</div>`;

    const midD  = Math.ceil(L.del.length / 2);
    const midT1 = Math.ceil(L.tr1.length / 2);

    let diagrama = '';
    diagrama += row(L.del.slice(0, midD).map(mkRuedaRO).join('') + spacer + body200 + spacer + L.del.slice(midD).map(mkRuedaRO).join(''));
    diagrama += row(spacer + topBot + spacer);
    diagrama += row(spacer + side   + spacer);
    diagrama += row(spacer + topBot + spacer);
    diagrama += row(L.tr1.slice(0, midT1).map(mkRuedaRO).join('') + axle + L.tr1.slice(midT1).map(mkRuedaRO).join(''));
    if (L.tr2.length) {
      const midT2 = Math.ceil(L.tr2.length / 2);
      diagrama += row(L.tr2.slice(0, midT2).map(mkRuedaRO).join('') + axle + L.tr2.slice(midT2).map(mkRuedaRO).join(''));
    }
    diagrama += `<div style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;">` +
                `<span style="font-size:12px;font-weight:bold;color:#fff;">Auxilio</span>` +
                L.aux.map(mkRuedaRO).join('') +
                `</div>`;

    // Leyenda del diagrama
    const leyenda = `
      <div style="display:flex;gap:14px;justify-content:center;margin-top:8px;font-size:11px;flex-wrap:wrap;">
        <span style="color:#66bb6a;">▪ Entrante (nueva)</span>
        <span style="color:#e57373;">▪ Saliente</span>
        <span style="color:#aaa;">▪ Sin cambio</span>
      </div>`;

    const siNo = (v) => v
      ? '<strong style="color:#090">SI</strong>'
      : '<strong style="color:#c00">NO</strong>';
    const chk = (id, val, label) =>
      `<label style="display:block;margin:3px 0;"><input type="checkbox" id="${id}" ${val?'checked':''} /> ${label}</label>`;

    const html = `
    <div style="font-size:13px; padding:18px; position:relative;">
      <img src="/images/rojo.png" style="position:absolute;top:12px;right:12px;height:15px;cursor:pointer;border:0;" onclick="close_carga();" />
      <h3 style="text-align:center; margin:0 0 16px 0;">Cerrar OT N°&nbsp;${otIdInt} — Interno ${escapeHtml(ot.unidad||'-')}</h3>

      <div style="display:flex; gap:28px; align-items:flex-start; flex-wrap:wrap;">

        <!-- Columna izquierda: formulario -->
        <div style="flex:1; min-width:240px;">
          ${cierreReducido ? `
          <p style="margin:0 0 10px 0; padding:8px 10px; background:rgba(46,125,50,0.12); border-left:3px solid #2e7d32; font-size:12.5px;">
            Cierre de <strong>Preventivo</strong>. Detallá abajo qué se revisó y si quedó todo OK.
          </p>

          <p style="margin:0 0 3px 0;"><strong>Km Actuales:</strong></p>
          <input type="number" id="km_cierre" value="${ot.km_actual||''}" style="width:150px;" placeholder="km" />

          <p style="margin:10px 0 3px 0;"><strong>Fecha:</strong></p>
          <input type="text" id="fecha_cierre" style="width:140px;" placeholder="DD/MM/AAAA" />

          <p style="margin:10px 0 3px 0;"><strong>Descripción del preventivo:</strong> <span style="color:#c00;">*</span></p>
          <textarea id="descripcion_cierre" style="width:100%; max-width:340px; height:90px; resize:vertical;"
                    placeholder="Ej: se revisó presión en las 6 posiciones, todo OK"></textarea>

          <div style="margin-top:18px; display:flex; gap:10px;">
            <input type="button" value="Cerrar Preventivo" onclick="confirmar_cerrar(${otIdInt})" style="width:150px;font-size:13px;" />
            <input type="button" value="Cancelar" onclick="close_carga();" style="width:100px;font-size:13px;" />
          </div>
          ` : `
          <p style="margin:0 0 5px 0;"><strong>Tareas a Realizar:</strong></p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px; margin-bottom:12px; font-size:12px;">
            <span>Rotación: ${siNo(ot.rotacion)}</span>
            <span>Arreglo: ${siNo(ot.arreglo)}</span>
            <span>Cambio: ${siNo(ot.cambio)}</span>
            <span>Alinear: ${siNo(ot.alinear)}</span>
            <span>Balanceo: ${siNo(ot.balanceo)}</span>
            <span>Armar: ${siNo(ot.armar)}</span>
            <span>Preventivo: ${siNo(ot.preventivo)}</span>
            <span>Pinchadura: ${siNo(ot.pinchadura)}</span>
            <span>Rotura: ${siNo(ot.rotura)}</span>
          </div>

          <p style="margin:0 0 3px 0;"><strong>Km Actuales:</strong></p>
          <input type="number" id="km_cierre" value="${ot.km_actual||''}" style="width:150px;" placeholder="km" />

          <p style="margin:10px 0 4px 0;"><strong>Tareas Realizadas:</strong></p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 10px; font-size:12px;">
            ${chk('cb_rot_cierre', ot.rotacion, 'Rotación')}
            ${chk('cb_arr_cierre', ot.arreglo,  'Arreglo')}
            ${chk('cb_cam_cierre', ot.cambio,   'Cambio')}
            ${chk('cb_ali_cierre', ot.alinear,  'Alinear')}
            ${chk('cb_bal_cierre', ot.balanceo, 'Balanceo')}
            ${chk('cb_arm_cierre', ot.armar,    'Armar')}
            ${chk('cb_pre_cierre', ot.preventivo, 'Preventivo')}
          </div>

          <p style="margin:10px 0 3px 0;"><strong>Número de Factura:</strong></p>
          <input type="text" id="factura_cierre" style="width:200px;" placeholder="Opcional" />

          <p style="margin:8px 0 3px 0;"><strong>Fecha:</strong></p>
          <input type="text" id="fecha_cierre" style="width:140px;" placeholder="DD/MM/AAAA" />

          <p style="margin:8px 0 3px 0;"><strong>Costo $:</strong></p>
          <input type="number" id="costo_cierre" style="width:150px;" placeholder="Opcional" />

          <p style="margin:12px 0 4px 0;"><strong>Destino de cubiertas salientes:</strong></p>
          <select id="destino_almacen_id" style="width:220px;font-size:13px;">
            ${almacenes.map(a => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`).join('')}
            <option value="ceamse">CEAMSE (dar de baja)</option>
          </select>

          <p style="margin:10px 0 3px 0;"><strong>Descripción del cierre:</strong></p>
          <textarea id="descripcion_cierre" style="width:100%; max-width:340px; height:60px; resize:vertical;"
                    placeholder="Opcional">${escapeHtml(ot.descripcion_cierre || '')}</textarea>

          <div style="margin-top:18px; display:flex; gap:10px;">
            <input type="button" value="Cerrar OT" onclick="confirmar_cerrar(${otIdInt})" style="width:120px;font-size:13px;" />
            <input type="button" value="Cancelar" onclick="close_carga();" style="width:100px;font-size:13px;" />
          </div>
          `}
        </div>

        <!-- Columna derecha: diagrama visual del micro -->
        <div style="flex:0 0 auto;">
          <p style="margin:0 0 6px 0;"><strong>Esquema completo de la unidad:</strong></p>
          <div style="text-align:center; background:#1a1a1a; padding:14px; border-radius:8px;">
            ${diagrama}
            ${leyenda}
          </div>
        </div>

      </div>
    </div>`;
    res.send(html);
  } catch (err) { next(err); }
});

// POST /ajax/confirmar_cerrar_ot - Ejecuta el cierre de OT y mueve cubiertas
router.post('/confirmar_cerrar_ot', requirePerm('ot_cerrar', 'ot_cerrar_preventivo'), async (req, res, next) => {
  try {
    const { ot_id, km_actual, factura, costo, rotacion, arreglo, cambio, alinear, balanceo, armar, preventivo, destino_almacen_id, descripcion_cierre } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!km_actual || !otIdInt) return res.status(400).send('Datos requeridos');

    // La OT se relee de la base antes de nada: el formulario recortado que ve el
    // gomero es cosmetico, y confiar en lo que llega en el body dejaria que un
    // POST armado a mano cerrara cualquier OT.
    const otPrevia = await sql`SELECT * FROM ots WHERE id = ${otIdInt}`;
    if (!otPrevia.length) return res.status(404).send('OT inexistente');
    if (otPrevia[0].estado == 1) return res.status(400).send('La OT ya está cerrada');
    if (otPrevia[0].anulada) return res.status(400).send('La OT está anulada');

    const soloPreventivo = esSoloPreventivo(otPrevia[0]);
    const cierraTodo = tienePermiso(req.user, 'ot_cerrar');
    if (!cierraTodo) {
      if (!tienePermiso(req.user, 'ot_cerrar_preventivo') || !soloPreventivo) {
        return res.status(403).send('Solo un administrador puede cerrar OTs con trabajos realizados');
      }
    }

    const descripcion = String(descripcion_cierre || '').trim() || null;
    if (!cierraTodo && !descripcion) {
      return res.status(400).send('La descripción del preventivo es obligatoria');
    }

    const destinoEsCeamse = destino_almacen_id === 'ceamse';
    const destinoAlmacenId = (!destinoEsCeamse && parseInt(destino_almacen_id)) ? parseInt(destino_almacen_id) : 1;

    const kmCierre = parseInt(km_actual) || 0;

    // Sin ot_cerrar los flags de trabajo que hayan llegado en el body se
    // ignoran: la OT se cierra tal como estaba, solo con el preventivo hecho.
    const trabajos = cierraTodo
      ? {
          rotacion: rotacion === '1', arreglo: arreglo === '1', cambio: cambio === '1',
          alinear: alinear === '1', balanceo: balanceo === '1', armar: armar === '1',
          preventivo: preventivo === '1',
        }
      : {
          rotacion: false, arreglo: false, cambio: false,
          alinear: false, balanceo: false, armar: false, preventivo: true,
        };

    await sql`UPDATE ots SET
      estado = 1,
      factura = ${cierraTodo ? (factura || null) : null},
      costo = ${cierraTodo ? (costo || null) : null},
      km = ${kmCierre},
      rotacion = ${trabajos.rotacion},
      arreglo  = ${trabajos.arreglo},
      cambio   = ${trabajos.cambio},
      alinear  = ${trabajos.alinear},
      balanceo = ${trabajos.balanceo},
      armar    = ${trabajos.armar},
      preventivo = ${trabajos.preventivo},
      descripcion_cierre = ${descripcion},
      cerrado_por = ${req.user?.usuario || null},
      cerrado_en = NOW()
    WHERE id = ${otIdInt}`;

    const unidad_id = otPrevia[0].unidad_id;
    const otFecha = otPrevia[0].fecha || null;
    if (unidad_id) {
      // Solo esta unidad, y nunca hacia atrás: cerrar una OT vieja no debe pisar
      // un kilometraje más reciente cargado a mano en Carga de Km.
      await sql`UPDATE micro SET km_actual = ${kmCierre}
        WHERE id = ${unidad_id} AND ${kmCierre} > COALESCE(km_actual, 0)`;
    }

    const cambios = await sql`
      SELECT cubierta_id, cubierta_anterior_id, posicion
      FROM ot_cubiertas
      WHERE ot_id = ${otIdInt} AND posicion IS NOT NULL AND cubierta_id IS NOT NULL
    `;

    // IDs de todas las cubiertas que ENTRAN en esta OT (para detectar rotaciones)
    const incomingIds = new Set(cambios.map(c => c.cubierta_id));

    // Paso 1: colocar todas las cubiertas entrantes en sus nuevas posiciones.
    for (const c of cambios) {
      await sql`
        UPDATE cubiertas SET micro_id = ${unidad_id}, posicion = ${c.posicion}, almacen_id = NULL, gomeria_id = NULL
        WHERE id = ${c.cubierta_id}
      `;
    }

    // Paso 2: manejar las cubiertas salientes
    // Si una cubierta "sale" de una posición pero es TAMBIÉN una "entrante" en otra
    // posición (rotación), no se manda al destino — ya fue movida en el paso 1.
    for (const c of cambios) {
      if (c.cubierta_anterior_id) {
        if (!incomingIds.has(c.cubierta_anterior_id)) {
          // Sale de la unidad → enviar al destino elegido
          if (destinoEsCeamse) {
            await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = NULL, activo = 0 WHERE id = ${c.cubierta_anterior_id}`;
          } else {
            await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = ${destinoAlmacenId} WHERE id = ${c.cubierta_anterior_id}`;
          }
        }
        // Si está en incomingIds es una rotación: ya fue reubicada en el paso 1, no hacer nada.
      } else if (unidad_id) {
        // Sin anterior registrado: buscar si hay otra cubierta en esa posición (excluir rotantes)
        const incomingArr = [...incomingIds];
        if (destinoEsCeamse) {
          await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = NULL, activo = 0
            WHERE micro_id = ${unidad_id} AND posicion = ${c.posicion}
            AND id != ${c.cubierta_id} AND NOT (id = ANY(${incomingArr}))`;
        } else {
          await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = ${destinoAlmacenId}
            WHERE micro_id = ${unidad_id} AND posicion = ${c.posicion}
            AND id != ${c.cubierta_id} AND NOT (id = ANY(${incomingArr}))`;
        }
      }
    }

    // Paso 3: registrar el historial de vida de las cubiertas involucradas.
    // Primero los retiros y después las colocaciones: en una rotación la misma
    // cubierta sale de una posición y entra en otra dentro de la misma OT, y el
    // orden de los eventos es lo que define dónde se corta cada tramo de km.
    for (const c of cambios) {
      if (!c.cubierta_anterior_id) continue;
      const saleDeLaUnidad = !incomingIds.has(c.cubierta_anterior_id);
      await registrarEvento({
        cubierta_id: c.cubierta_anterior_id, tipo: 'retiro', fecha: otFecha,
        micro_id: unidad_id, posicion: c.posicion, km_unidad: kmCierre, ot_id: otIdInt,
        detalle: saleDeLaUnidad
          ? (destinoEsCeamse ? 'Sale de la unidad — baja por CEAMSE' : 'Sale de la unidad al almacén')
          : 'Cambia de posición dentro de la unidad (rotación)',
      });
      if (trabajos.arreglo) {
        await registrarEvento({
          cubierta_id: c.cubierta_anterior_id, tipo: 'reparacion', fecha: otFecha,
          micro_id: unidad_id, posicion: c.posicion, km_unidad: kmCierre, ot_id: otIdInt,
          detalle: 'Arreglo registrado en la OT N° ' + otIdInt,
        });
      }
      if (saleDeLaUnidad && destinoEsCeamse) {
        await registrarEvento({
          cubierta_id: c.cubierta_anterior_id, tipo: 'baja', fecha: otFecha,
          micro_id: unidad_id, posicion: c.posicion, km_unidad: kmCierre, ot_id: otIdInt,
          detalle: 'Baja por CEAMSE',
        });
      }
    }
    for (const c of cambios) {
      await registrarEvento({
        cubierta_id: c.cubierta_id, tipo: 'colocacion', fecha: otFecha,
        micro_id: unidad_id, posicion: c.posicion, km_unidad: kmCierre, ot_id: otIdInt,
        detalle: 'Entra por OT N° ' + otIdInt,
      });
    }

    const [uni] = unidad_id ? await sql`SELECT unidad FROM micro WHERE id = ${unidad_id}` : [null];
    await auditoria.registrar({
      req, accion: 'cerrar', entidad: 'ot', entidad_id: otIdInt,
      descripcion: `Cerró la OT N° ${otIdInt}` + (uni ? ` — Interno ${uni.unidad}` : '')
        + (cierraTodo ? '' : ' (preventivo)'),
      cambios: [
        { campo: 'estado', antes: 'Pendiente', despues: 'Cerrada' },
        ...auditoria.diff(otPrevia[0], { km: kmCierre, ...trabajos, descripcion_cierre: descripcion },
          ['km', ...TRABAJOS_REALES, 'preventivo', 'descripcion_cierre']),
        ...(cambios.length ? [{ campo: 'cubiertas', antes: null, despues: cambios.length + ' posición(es) modificada(s)' }] : []),
      ],
    });

    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/nueva_ot - Crear nueva OT con posiciones de cubiertas
router.post('/nueva_ot', requirePerm('ot_crear'), async (req, res, next) => {
  try {
    const { fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar, preventivo, pinchadura, rotura } = req.body;
    if (!fecha) return res.send('');

    const fechaISO = parseFecha(fecha);

    const result = await sql`
      INSERT INTO ots (fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar, preventivo, pinchadura, rotura, solicitado_por)
      VALUES (
        ${fechaISO}, ${parseInt(gomeria_id)||null}, ${parseInt(unidad_id)||null}, ${observaciones||null},
        ${rotacion === '1'}, ${arreglo === '1'}, ${cambio === '1'},
        ${alinear === '1'}, ${balanceo === '1'}, ${armar === '1'}, ${preventivo === '1'},
        ${pinchadura === '1'}, ${rotura === '1'}, ${req.user?.usuario || null}
      )
      RETURNING id
    `;
    const ot_id = result[0].id;

    const cambiosJson = req.body.cambios_ot_json;
    if (cambiosJson) {
      try {
        const cambios = JSON.parse(cambiosJson);
        for (const [posicion, cubierta_id] of Object.entries(cambios)) {
          if (!cubierta_id) continue;
          const anterior = await sql`
            SELECT id FROM cubiertas
            WHERE micro_id = ${parseInt(unidad_id)||null} AND posicion = ${posicion} AND activo = 1
            LIMIT 1
          `;
          const anterior_id = anterior[0]?.id || null;
          await sql`
            INSERT INTO ot_cubiertas (ot_id, cubierta_id, posicion, cubierta_anterior_id)
            VALUES (${ot_id}, ${parseInt(cubierta_id)}, ${posicion}, ${anterior_id})
            ON CONFLICT (ot_id, cubierta_id) DO UPDATE SET posicion = EXCLUDED.posicion, cubierta_anterior_id = EXCLUDED.cubierta_anterior_id
          `;
        }
      } catch(e) { /* JSON inválido, ignorar */ }
    }

    if (pinchadura === '1') {
      // En Vercel serverless hay que esperar el envío antes de responder,
      // pero un fallo del mail no debe romper la creación de la OT.
      try {
        const [unidadRow, gomeriaRow, cubs] = await Promise.all([
          sql`SELECT unidad FROM micro WHERE id = ${parseInt(unidad_id)||0}`,
          sql`SELECT nombre FROM gomeria WHERE id = ${parseInt(gomeria_id)||0}`,
          sql`
            SELECT oc.posicion, c.fuego, ca.fuego AS fuego_anterior
            FROM ot_cubiertas oc
            JOIN cubiertas c ON oc.cubierta_id = c.id
            LEFT JOIN cubiertas ca ON oc.cubierta_anterior_id = ca.id
            WHERE oc.ot_id = ${ot_id}
          `,
        ]);
        await enviarAvisoPinchadura({
          otId: ot_id,
          unidad: unidadRow[0]?.unidad,
          gomeria: gomeriaRow[0]?.nombre,
          fecha,
          trabajos: { rotacion, arreglo, cambio, alinear, balanceo, armar },
          cambios: cubs.map(c => ({ ...c, posicion: posNombreCierre(c.posicion) })),
          observaciones,
          solicitadoPor: req.user?.usuario,
        });
      } catch (e) {
        console.error(`[MAIL pinchadura] OT ${ot_id}: ${e.message}`);
      }
    }

    const [uniNueva] = parseInt(unidad_id)
      ? await sql`SELECT unidad FROM micro WHERE id = ${parseInt(unidad_id)}`
      : [null];
    const tareas = ['rotacion','arreglo','cambio','alinear','balanceo','armar','preventivo']
      .filter(t => req.body[t] === '1');
    await auditoria.registrar({
      req, accion: 'crear', entidad: 'ot', entidad_id: ot_id,
      descripcion: `Creó la OT N° ${ot_id}` + (uniNueva ? ` — Interno ${uniNueva.unidad}` : ''),
      cambios: [
        { campo: 'fecha', antes: null, despues: fechaISO },
        { campo: 'trabajos', antes: null, despues: tareas.join(', ') || '(ninguno)' },
        { campo: 'pinchadura', antes: null, despues: pinchadura === '1' ? 'SI' : 'NO' },
        { campo: 'rotura', antes: null, despues: rotura === '1' ? 'SI' : 'NO' },
        ...(observaciones ? [{ campo: 'observaciones', antes: null, despues: observaciones }] : []),
      ],
    });

    res.send(ot_id.toString());
  } catch (err) { next(err); }
});

// POST /ajax/actualizar_ot - Editar OT existente (solo si está abierta)
router.post('/actualizar_ot', requirePerm('ot_editar'), async (req, res, next) => {
  try {
    const { ot_id, fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar, preventivo, pinchadura, rotura } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!otIdInt || !fecha) return res.send('');

    const fechaISO = parseFecha(fecha);

    const antesOt = await sql`SELECT * FROM ots WHERE id = ${otIdInt}`;
    if (antesOt.length && antesOt[0].anulada) return res.status(400).send('La OT está anulada');

    await sql`
      UPDATE ots SET
        fecha = ${fechaISO}, gomeria_id = ${parseInt(gomeria_id)||null}, unidad_id = ${parseInt(unidad_id)||null},
        observaciones = ${observaciones||null},
        rotacion = ${rotacion === '1'}, arreglo = ${arreglo === '1'}, cambio = ${cambio === '1'},
        alinear = ${alinear === '1'}, balanceo = ${balanceo === '1'}, armar = ${armar === '1'},
        preventivo = CASE WHEN ${preventivo === undefined} THEN preventivo ELSE ${preventivo === '1'} END,
        pinchadura = CASE WHEN ${pinchadura === undefined} THEN pinchadura ELSE ${pinchadura === '1'} END,
        rotura = CASE WHEN ${rotura === undefined} THEN rotura ELSE ${rotura === '1'} END
      WHERE id = ${otIdInt} AND estado = 0
    `;

    const cambiosJson = req.body.cambios_ot_json;
    if (cambiosJson) {
      try {
        const cambios = JSON.parse(cambiosJson);
        for (const [posicion, cubierta_id] of Object.entries(cambios)) {
          if (!cubierta_id) continue;
          const anterior = await sql`
            SELECT id FROM cubiertas
            WHERE micro_id = ${parseInt(unidad_id)||null} AND posicion = ${posicion} AND activo = 1
            LIMIT 1
          `;
          const anterior_id = anterior[0]?.id || null;
          await sql`
            INSERT INTO ot_cubiertas (ot_id, cubierta_id, posicion, cubierta_anterior_id)
            VALUES (${otIdInt}, ${parseInt(cubierta_id)}, ${posicion}, ${anterior_id})
            ON CONFLICT (ot_id, cubierta_id) DO UPDATE SET posicion = EXCLUDED.posicion, cubierta_anterior_id = EXCLUDED.cubierta_anterior_id
          `;
        }
      } catch(e) { /* JSON inválido, ignorar */ }
    }

    const despuesOt = {
      fecha: fechaISO, gomeria_id: parseInt(gomeria_id) || null, unidad_id: parseInt(unidad_id) || null,
      observaciones: observaciones || null,
      rotacion: rotacion === '1', arreglo: arreglo === '1', cambio: cambio === '1',
      alinear: alinear === '1', balanceo: balanceo === '1', armar: armar === '1',
    };
    const cambiosOt = auditoria.diff(antesOt[0], despuesOt, Object.keys(despuesOt));
    if (cambiosOt.length) {
      await auditoria.registrar({
        req, accion: 'editar', entidad: 'ot', entidad_id: otIdInt,
        descripcion: `Editó la OT N° ${otIdInt}`,
        cambios: cambiosOt,
      });
    }

    res.send(ot_id.toString());
  } catch (err) { next(err); }
});

// POST /ajax/agregar_cubierta_ot - Agregar cubierta a OT
router.post('/agregar_cubierta_ot', requirePerm('ot_editar'), async (req, res, next) => {
  try {
    const { ot_id, cubierta_id } = req.body;
    await sql`INSERT INTO ot_cubiertas (ot_id, cubierta_id) VALUES (${parseInt(ot_id)||0}, ${parseInt(cubierta_id)||0}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE cubiertas SET gomeria_id = (SELECT gomeria_id FROM ots WHERE id = ${parseInt(ot_id)||0}), almacen_id = NULL WHERE id = ${parseInt(cubierta_id)||0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/anular_ot — baja lógica
// Antes hacía DELETE: la OT desaparecía sin dejar constancia de que existió, de
// qué tenía adentro ni de quién la borró. Ahora se marca y se puede restaurar.
router.post('/anular_ot', requirePerm('ot_anular'), async (req, res, next) => {
  try {
    const { ot_id, motivo } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!otIdInt) return res.status(400).send('ID requerido');

    const motivoTxt = String(motivo || '').trim();
    if (!motivoTxt) return res.status(400).send('Indicá el motivo de la anulación');

    const previa = await sql`SELECT * FROM ots WHERE id = ${otIdInt}`;
    if (!previa.length) return res.status(404).send('OT inexistente');
    if (previa[0].anulada) return res.status(400).send('La OT ya está anulada');

    const cubs = await sql`
      SELECT oc.posicion, c.fuego
      FROM ot_cubiertas oc LEFT JOIN cubiertas c ON oc.cubierta_id = c.id
      WHERE oc.ot_id = ${otIdInt}`;

    await sql`
      UPDATE ots SET
        anulada = TRUE,
        anulada_por = ${req.user?.usuario || null},
        anulada_en = NOW(),
        motivo_anulacion = ${motivoTxt}
      WHERE id = ${otIdInt}`;

    const [unidad] = previa[0].unidad_id
      ? await sql`SELECT unidad FROM micro WHERE id = ${previa[0].unidad_id}`
      : [null];

    await auditoria.registrar({
      req, accion: 'anular', entidad: 'ot', entidad_id: otIdInt,
      descripcion: `Anuló la OT N° ${otIdInt}` + (unidad ? ` — Interno ${unidad.unidad}` : '') + ` — Motivo: ${motivoTxt}`,
      cambios: {
        motivo: motivoTxt,
        // Copia de lo que tenía, para poder reconstruirla aunque después se purgue
        copia: auditoria.snapshot(previa[0], [
          'numero', 'fecha', 'estado', 'unidad_id', 'gomeria_id', 'km', 'factura', 'costo',
          'rotacion', 'arreglo', 'cambio', 'alinear', 'balanceo', 'armar', 'preventivo',
          'pinchadura', 'rotura', 'observaciones', 'solicitado_por',
        ]),
        cubiertas: cubs.map(c => `${c.posicion || '-'}: ${c.fuego || 'S/N'}`),
      },
    });

    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/restaurar_ot — deshace una anulación
router.post('/restaurar_ot', requirePerm('ot_anular'), async (req, res, next) => {
  try {
    const otIdInt = parseInt(req.body.ot_id) || 0;
    if (!otIdInt) return res.status(400).send('ID requerido');

    const previa = await sql`SELECT id, anulada, motivo_anulacion FROM ots WHERE id = ${otIdInt}`;
    if (!previa.length) return res.status(404).send('OT inexistente');
    if (!previa[0].anulada) return res.status(400).send('La OT no está anulada');

    await sql`
      UPDATE ots SET anulada = FALSE, anulada_por = NULL, anulada_en = NULL, motivo_anulacion = NULL
      WHERE id = ${otIdInt}`;

    await auditoria.registrar({
      req, accion: 'restaurar', entidad: 'ot', entidad_id: otIdInt,
      descripcion: `Restauró la OT N° ${otIdInt}, que estaba anulada`,
      cambios: [{ campo: 'anulada', antes: 'SI', despues: 'NO' }],
    });

    res.send('ok');
  } catch (err) { next(err); }
});

module.exports = router;
