const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { sql } = require('../db');
const { requireAuth, requireMaster } = require('../middleware/auth');

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
router.post('/inactive', requireAuth, async (req, res, next) => {
  try {
    const { id, active, table } = req.body;
    const allowed = ['usuarios', 'almacen', 'gomeria', 'recapadora', 'micro', 'marcas_ruedas', 'cubiertas'];
    if (!allowed.includes(table)) return res.status(400).send('tabla no permitida');
    await sql(`UPDATE ${table} SET activo = $1 WHERE id = $2`, [active, parseInt(id) || 0]);
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
router.post('/cargar_km', requireAuth, async (req, res, next) => {
  try {
    const { id, km } = req.body;
    await sql`UPDATE micro SET km_actual = ${parseInt(km) || 0} WHERE id = ${parseInt(id) || 0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/carga_masiva_km - Carga masiva de km
router.post('/carga_masiva_km', requireAuth, async (req, res, next) => {
  try {
    const updates = [];
    for (const key in req.body) {
      if (key.startsWith('km_')) {
        const id = parseInt(key.replace('km_', '')) || 0;
        const km = parseInt(req.body[key]) || 0;
        if (id && req.body[key]) updates.push(sql`UPDATE micro SET km_actual = ${km} WHERE id = ${id}`);
      }
    }
    await Promise.all(updates);
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/mover_cubierta - Mover cubierta a otro almacén
router.post('/mover_cubierta', requireAuth, async (req, res, next) => {
  try {
    const { cubierta, almacen } = req.body;
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen) || null}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ${parseInt(cubierta) || 0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/nuevo_estado - Cambiar estado de cubierta
router.post('/nuevo_estado', requireAuth, async (req, res, next) => {
  try {
    const { r_id, estado } = req.body;
    await sql`UPDATE cubiertas SET estado = ${parseInt(estado)} WHERE id = ${parseInt(r_id) || 0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

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
    const { id, usuario, password, tipo, nombre, mail, avisa, gomeria } = req.body;
    const hash = password ? await bcrypt.hash(password, 10) : null;
    if (id) {
      if (hash) {
        await sql`UPDATE usuarios SET usuario=${usuario.trim()}, password=${hash}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null} WHERE id=${parseInt(id)}`;
      } else {
        await sql`UPDATE usuarios SET usuario=${usuario.trim()}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null} WHERE id=${parseInt(id)}`;
      }
      res.send('Usuario actualizado correctamente');
    } else {
      if (!hash) return res.status(400).send('Contraseña requerida');
      await sql`INSERT INTO usuarios (usuario, password, tipo, nombre, mail, avisa, gomeria_id) VALUES (${usuario.trim()},${hash},${parseInt(tipo)},${nombre||null},${mail||null},${parseInt(avisa)||0},${parseInt(gomeria)||null})`;
      res.send('Usuario creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_micro
router.post('/save_micro', requireMaster, async (req, res, next) => {
  try {
    const { id, unidad, descripcion, tipo_unidad, km_actual } = req.body;
    const km = parseInt(km_actual) || 0;
    if (id) {
      await sql`UPDATE micro SET unidad=${unidad}, descripcion=${descripcion||null}, tipo_unidad=${parseInt(tipo_unidad)||1}, km_actual=${km} WHERE id=${parseInt(id)}`;
      res.send('Unidad actualizada correctamente');
    } else {
      await sql`INSERT INTO micro (unidad, descripcion, tipo_unidad, km_actual) VALUES (${unidad},${descripcion||null},${parseInt(tipo_unidad)||1},${km})`;
      res.send('Unidad creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_modelo
router.post('/save_modelo', requireMaster, async (req, res, next) => {
  try {
    const { id, marca, modelo } = req.body;
    if (id) {
      await sql`UPDATE marcas_ruedas SET marca=${marca}, modelo=${modelo} WHERE id=${parseInt(id)}`;
      res.send('Modelo actualizado correctamente');
    } else {
      await sql`INSERT INTO marcas_ruedas (marca, modelo) VALUES (${marca},${modelo})`;
      res.send('Modelo creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_proveedor
router.post('/save_proveedor', requireMaster, async (req, res, next) => {
  try {
    const { id, proveedor, tel, mail } = req.body;
    if (id) {
      await sql`UPDATE proveedor SET proveedor=${proveedor}, tel=${tel||'-'}, mail=${mail||'-'} WHERE id=${parseInt(id)}`;
      res.send('Proveedor actualizado correctamente');
    } else {
      await sql`INSERT INTO proveedor (proveedor, tel, mail) VALUES (${proveedor},${tel||'-'},${mail||'-'})`;
      res.send('Proveedor creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_almacen
router.post('/save_almacen', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono, cargar_id, cargar_remito } = req.body;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    const cId  = cargar_id     === '1';
    const cRem = cargar_remito === '1';
    if (id) {
      await sql`UPDATE almacen SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel}, cargar_id=${cId}, cargar_remito=${cRem} WHERE id=${parseInt(id)}`;
      res.send('Almacén actualizado correctamente');
    } else {
      await sql`INSERT INTO almacen (nombre, direccion, localidad, telefono, cargar_id, cargar_remito) VALUES (${nombre}, ${dir}, ${loc}, ${tel}, ${cId}, ${cRem})`;
      res.send('Almacén creado correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_gomeria
router.post('/save_gomeria', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono } = req.body;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    if (id) {
      await sql`UPDATE gomeria SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel} WHERE id=${parseInt(id)}`;
      res.send('Gomería actualizada correctamente');
    } else {
      await sql`INSERT INTO gomeria (nombre, direccion, localidad, telefono) VALUES (${nombre}, ${dir}, ${loc}, ${tel})`;
      res.send('Gomería creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_recapadora
router.post('/save_recapadora', requireMaster, async (req, res, next) => {
  try {
    const { id, nombre, direccion, localidad, telefono, tipo_trabajo } = req.body;
    const dir = direccion?.trim() || null;
    const loc = localidad?.trim() || null;
    const tel = telefono?.trim() || null;
    const tip = tipo_trabajo?.trim() || null;
    if (id) {
      await sql`UPDATE recapadora SET nombre=${nombre}, direccion=${dir}, localidad=${loc}, telefono=${tel}, tipo_trabajo=${tip} WHERE id=${parseInt(id)}`;
      res.send('Recapadora actualizada correctamente');
    } else {
      await sql`INSERT INTO recapadora (nombre, direccion, localidad, telefono, tipo_trabajo) VALUES (${nombre}, ${dir}, ${loc}, ${tel}, ${tip})`;
      res.send('Recapadora creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/save_medida
router.post('/save_medida', requireMaster, async (req, res, next) => {
  try {
    const { id, medida } = req.body;
    if (id) {
      await sql`UPDATE medidas SET medida=${medida} WHERE id=${parseInt(id)}`;
      res.send('Medida actualizada correctamente');
    } else {
      await sql`INSERT INTO medidas (medida) VALUES (${medida})`;
      res.send('Medida creada correctamente');
    }
  } catch (err) { next(err); }
});

// POST /ajax/listar_ruedas - Listar cubiertas para selección en micro u OT
router.post('/listar_ruedas', requireAuth, async (req, res, next) => {
  try {
    const { almacen = 0, fuego = '', modelo = 0, medida = 0, estado = 0, micro_id, pos, modo = 'micro', unidad_id, current_pos } = req.body;

    const [cubiertas, rotacion] = await Promise.all([
      // Cubiertas en almacén (disponibles)
      sql`
        SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida, c.estado, c.km
        FROM cubiertas c
        LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
        LEFT JOIN medidas med ON c.medida_id = med.id
        WHERE c.activo = 1
          AND c.micro_id IS NULL
          AND (${parseInt(almacen)} = 0 OR c.almacen_id = ${parseInt(almacen)})
          AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
          AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
          AND (${parseInt(medida)} = 0 OR c.medida_id = ${parseInt(medida)})
          AND (${parseInt(estado)} = 0 OR c.estado = ${parseInt(estado)})
        ORDER BY c.fuego
        LIMIT 50
      `,
      // Cubiertas montadas en la unidad para rotación (solo en modo OT con unidad_id)
      modo === 'ot' && parseInt(unidad_id)
        ? sql`
            SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida, c.estado, c.km, c.posicion
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

    const estadoNombre = (e) => e === 1 ? 'Nueva' : e === 2 ? 'Usada' : 'Recapada';
    const escJs = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let html = '';

    // ── Sección rotación primero (solo OT) ──────────────────────
    if (modo === 'ot' && rotacion.length > 0) {
      html += `<div style="margin-bottom:10px; border-bottom:2px solid #e0a800; padding-bottom:10px;">
        <p style="margin:0 0 6px 0; font-size:12px; font-weight:700; color:#b8860b; letter-spacing:0.06em; text-transform:uppercase;">
          ↺ Rotación — cubiertas montadas en esta unidad
        </p>
        <table>
          <thead><th>Fuego</th><th>Posición actual</th><th>Modelo</th><th>Medida</th><th>Estado</th><th></th></thead>`;
      for (const c of rotacion) {
        const fuegoEsc  = escJs(c.fuego);
        const modeloEsc = escJs(((c.marca || '') + ' ' + (c.modelo_nombre || '')).trim());
        const medidaEsc = escJs(c.medida || '-');
        html += `<tr style="background:#fffbe6;">
          <td style="font-family:'IBM Plex Mono',monospace;font-variant-numeric:slashed-zero;">${escapeHtml(c.fuego) || '-'}</td>
          <td style="color:#b8860b; font-weight:600;">${escapeHtml(posNombre(c.posicion))}</td>
          <td>${escapeHtml(c.marca)} ${escapeHtml(c.modelo_nombre)}</td>
          <td>${escapeHtml(c.medida) || '-'}</td>
          <td>${estadoNombre(c.estado)}</td>
          <td><input type="button" value="Rotar aquí" style="background:#e6a800;border:none;color:#fff;padding:4px 10px;cursor:pointer;border-radius:3px;"
               onclick="seleccionar_ot(${c.id}, '${fuegoEsc}', '${modeloEsc}', '${medidaEsc}')" /></td>
        </tr>`;
      }
      html += '</table></div>';
    }

    // ── Sección almacén ──────────────────────────────────────────
    html += '<table><thead><th>Fuego</th><th>Modelo</th><th>Medida</th><th>Estado</th><th>Km</th><th></th></thead>';
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
        <td>${estadoNombre(c.estado)}</td>
        <td>${parseInt(c.km) || 0}</td>
        <td>${btn}</td>
      </tr>`;
    }
    html += '</table>';

    res.send(html);
  } catch (err) { next(err); }
});

// GET /ajax/cubiertas_unidad - Obtener cubiertas actuales de un micro por posición
router.get('/cubiertas_unidad', requireAuth, async (req, res, next) => {
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
router.post('/colocar_rueda', requireAuth, async (req, res, next) => {
  try {
    const { id, unidad, pos } = req.body;
    const existing = await sql`SELECT id FROM cubiertas WHERE micro_id = ${parseInt(unidad) || 0} AND posicion = ${pos} AND activo = 1`;
    if (existing.length) {
      await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL WHERE id = ${existing[0].id}`;
    }
    await sql`UPDATE cubiertas SET micro_id = ${parseInt(unidad) || null}, posicion = ${pos}, almacen_id = NULL, gomeria_id = NULL WHERE id = ${parseInt(id) || 0}`;
    res.send('OK');
  } catch (err) { next(err); }
});

// POST /ajax/almacenar_rueda - Guardar cubierta en almacén desde micro
router.post('/almacenar_rueda', requireAuth, async (req, res, next) => {
  try {
    const { r_id, almacen_id } = req.body;
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen_id) || null}, micro_id = NULL, posicion = NULL, gomeria_id = NULL WHERE id = ${parseInt(r_id) || 0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/almacenar_ruedas - Guardar múltiples cubiertas en almacén
router.post('/almacenar_ruedas', requireAuth, async (req, res, next) => {
  try {
    const { almacen_id, cubiertas_ids } = req.body;
    if (!cubiertas_ids) return res.send('ok');
    const ids = Array.isArray(cubiertas_ids) ? cubiertas_ids : [cubiertas_ids];
    await sql`UPDATE cubiertas SET almacen_id = ${parseInt(almacen_id) || null}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ANY(${ids.map(Number)})`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/mb_cerrar_ot - Devuelve formulario HTML para confirmar cierre de OT
const posNombreCierre = (p) => ({
  ddi:'Del. Izq.', ddd:'Del. Der.', tie:'Tras. Izq. Ext.', tii:'Tras. Izq. Int.',
  tdi:'Tras. Der. Int.', tde:'Tras. Der. Ext.', cie:'Cen. Izq. Ext.', cii:'Cen. Izq. Int.',
  cdi:'Cen. Der. Int.', cde:'Cen. Der. Ext.', ra:'Auxilio', ra2:'Auxilio 2'
})[p] || p;

router.post('/mb_cerrar_ot', requireAuth, async (req, res, next) => {
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
          <p style="margin:0 0 5px 0;"><strong>Tareas a Realizar:</strong></p>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px; margin-bottom:12px; font-size:12px;">
            <span>Rotación: ${siNo(ot.rotacion)}</span>
            <span>Arreglo: ${siNo(ot.arreglo)}</span>
            <span>Cambio: ${siNo(ot.cambio)}</span>
            <span>Alinear: ${siNo(ot.alinear)}</span>
            <span>Balanceo: ${siNo(ot.balanceo)}</span>
            <span>Armar: ${siNo(ot.armar)}</span>
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

          <div style="margin-top:18px; display:flex; gap:10px;">
            <input type="button" value="Cerrar OT" onclick="confirmar_cerrar(${otIdInt})" style="width:120px;font-size:13px;" />
            <input type="button" value="Cancelar" onclick="close_carga();" style="width:100px;font-size:13px;" />
          </div>
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
router.post('/confirmar_cerrar_ot', requireAuth, async (req, res, next) => {
  try {
    const { ot_id, km_actual, factura, costo, rotacion, arreglo, cambio, alinear, balanceo, armar, destino_almacen_id } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!km_actual || !otIdInt) return res.status(400).send('Datos requeridos');
    const destinoEsCeamse = destino_almacen_id === 'ceamse';
    const destinoAlmacenId = (!destinoEsCeamse && parseInt(destino_almacen_id)) ? parseInt(destino_almacen_id) : 1;

    await sql`UPDATE ots SET
      estado = 1,
      factura = ${factura||null},
      costo = ${costo||null},
      rotacion = ${rotacion === '1'},
      arreglo  = ${arreglo  === '1'},
      cambio   = ${cambio   === '1'},
      alinear  = ${alinear  === '1'},
      balanceo = ${balanceo === '1'},
      armar    = ${armar    === '1'}
    WHERE id = ${otIdInt}`;

    const ot = await sql`SELECT unidad_id FROM ots WHERE id = ${otIdInt}`;
    const unidad_id = ot[0]?.unidad_id;
    if (unidad_id) {
      await sql`UPDATE micro SET km_actual = ${parseInt(km_actual)} WHERE id = ${unidad_id}`;
    }

    const cambios = await sql`
      SELECT cubierta_id, cubierta_anterior_id, posicion
      FROM ot_cubiertas
      WHERE ot_id = ${otIdInt} AND posicion IS NOT NULL AND cubierta_id IS NOT NULL
    `;

    // IDs de todas las cubiertas que ENTRAN en esta OT (para detectar rotaciones)
    const incomingIds = new Set(cambios.map(c => c.cubierta_id));

    // Paso 1: colocar todas las cubiertas entrantes en sus nuevas posiciones
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

    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/nueva_ot - Crear nueva OT con posiciones de cubiertas
router.post('/nueva_ot', requireAuth, async (req, res, next) => {
  try {
    const { fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar } = req.body;
    if (!fecha) return res.send('');

    const parseFecha = (f) => {
      const p = f.split('/');
      if (p.length !== 3) return f;
      const year = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${year}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    };
    const fechaISO = parseFecha(fecha);

    const result = await sql`
      INSERT INTO ots (fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar, solicitado_por)
      VALUES (
        ${fechaISO}, ${parseInt(gomeria_id)||null}, ${parseInt(unidad_id)||null}, ${observaciones||null},
        ${rotacion === '1'}, ${arreglo === '1'}, ${cambio === '1'},
        ${alinear === '1'}, ${balanceo === '1'}, ${armar === '1'}, ${req.user?.usuario || null}
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

    res.send(ot_id.toString());
  } catch (err) { next(err); }
});

// POST /ajax/actualizar_ot - Editar OT existente (solo si está abierta)
router.post('/actualizar_ot', requireAuth, async (req, res, next) => {
  try {
    const { ot_id, fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!otIdInt || !fecha) return res.send('');

    const parseFecha = (f) => {
      const p = f.split('/');
      if (p.length !== 3) return f;
      const year = p[2].length === 2 ? '20' + p[2] : p[2];
      return `${year}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    };
    const fechaISO = parseFecha(fecha);

    await sql`
      UPDATE ots SET
        fecha = ${fechaISO}, gomeria_id = ${parseInt(gomeria_id)||null}, unidad_id = ${parseInt(unidad_id)||null},
        observaciones = ${observaciones||null},
        rotacion = ${rotacion === '1'}, arreglo = ${arreglo === '1'}, cambio = ${cambio === '1'},
        alinear = ${alinear === '1'}, balanceo = ${balanceo === '1'}, armar = ${armar === '1'}
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

    res.send(ot_id.toString());
  } catch (err) { next(err); }
});

// POST /ajax/agregar_cubierta_ot - Agregar cubierta a OT
router.post('/agregar_cubierta_ot', requireAuth, async (req, res, next) => {
  try {
    const { ot_id, cubierta_id } = req.body;
    await sql`INSERT INTO ot_cubiertas (ot_id, cubierta_id) VALUES (${parseInt(ot_id)||0}, ${parseInt(cubierta_id)||0}) ON CONFLICT DO NOTHING`;
    await sql`UPDATE cubiertas SET gomeria_id = (SELECT gomeria_id FROM ots WHERE id = ${parseInt(ot_id)||0}), almacen_id = NULL WHERE id = ${parseInt(cubierta_id)||0}`;
    res.send('ok');
  } catch (err) { next(err); }
});

// POST /ajax/anular_ot
router.post('/anular_ot', requireMaster, async (req, res, next) => {
  try {
    const { ot_id } = req.body;
    const otIdInt = parseInt(ot_id) || 0;
    if (!otIdInt) return res.status(400).send('ID requerido');
    await sql`DELETE FROM ot_cubiertas WHERE ot_id = ${otIdInt}`;
    await sql`DELETE FROM ots WHERE id = ${otIdInt}`;
    res.send('ok');
  } catch (err) { next(err); }
});

module.exports = router;
