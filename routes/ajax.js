const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { sql } = require('../db');
const { requireAuth, requireMaster } = require('../middleware/auth');

// POST /ajax/inactive - Activar/desactivar registro
router.post('/inactive', requireAuth, async (req, res) => {
  const { id, active, table } = req.body;
  const allowed = ['usuarios', 'almacen', 'gomeria', 'recapadora', 'micro', 'marcas_ruedas', 'cubiertas'];
  if (!allowed.includes(table)) return res.status(400).send('tabla no permitida');
  await sql`UPDATE ${sql(table)} SET activo = ${active} WHERE id = ${id}`;
  res.send('ok');
});

// POST /ajax/change_filter - Cambiar filtro solo activos (usa cookie)
router.post('/change_filter', requireAuth, (req, res) => {
  const { activo } = req.body;
  res.cookie('soloActivos', activo, { httpOnly: true });
  res.send('ok');
});

// POST /ajax/cargar_km - Cargar km individual
router.post('/cargar_km', requireAuth, async (req, res) => {
  const { id, km } = req.body;
  await sql`UPDATE micro SET km_actual = ${parseInt(km)} WHERE id = ${id}`;
  res.send('ok');
});

// POST /ajax/carga_masiva_km - Carga masiva de km
router.post('/carga_masiva_km', requireAuth, async (req, res) => {
  const updates = [];
  for (const key in req.body) {
    if (key.startsWith('km_')) {
      const id = key.replace('km_', '');
      const km = req.body[key];
      if (km) updates.push(sql`UPDATE micro SET km_actual = ${parseInt(km)} WHERE id = ${id}`);
    }
  }
  await Promise.all(updates);
  res.send('ok');
});

// POST /ajax/mover_cubierta - Mover cubierta a otro almacén
router.post('/mover_cubierta', requireAuth, async (req, res) => {
  const { cubierta, almacen } = req.body;
  await sql`UPDATE cubiertas SET almacen_id = ${almacen}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ${cubierta}`;
  res.send('ok');
});

// POST /ajax/nuevo_estado - Cambiar estado de cubierta
router.post('/nuevo_estado', requireAuth, async (req, res) => {
  const { r_id, estado, remito, fecha_remito, ot_factura, ot_fecha, ot_costo } = req.body;
  await sql`UPDATE cubiertas SET estado = ${parseInt(estado)} WHERE id = ${r_id}`;
  res.send('ok');
});

// POST /ajax/save_usuario
router.post('/save_usuario', requireMaster, async (req, res) => {
  const { id, usuario, password, tipo, nombre, mail, avisa, gomeria } = req.body;
  const hash = password ? await bcrypt.hash(password, 10) : null;
  if (id) {
    if (hash) {
      await sql`UPDATE usuarios SET usuario=${usuario}, password=${hash}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null} WHERE id=${id}`;
    } else {
      await sql`UPDATE usuarios SET usuario=${usuario}, tipo=${parseInt(tipo)}, nombre=${nombre||null}, mail=${mail||null}, avisa=${parseInt(avisa)||0}, gomeria_id=${parseInt(gomeria)||null} WHERE id=${id}`;
    }
    res.send('Usuario actualizado correctamente');
  } else {
    if (!hash) return res.send('');
    await sql`INSERT INTO usuarios (usuario, password, tipo, nombre, mail, avisa, gomeria_id) VALUES (${usuario},${hash},${parseInt(tipo)},${nombre||null},${mail||null},${parseInt(avisa)||0},${parseInt(gomeria)||null})`;
    res.send('Usuario creado correctamente');
  }
});

// POST /ajax/save_micro
router.post('/save_micro', requireMaster, async (req, res) => {
  const { id, unidad, descripcion, tipo_unidad } = req.body;
  if (id) {
    await sql`UPDATE micro SET unidad=${unidad}, descripcion=${descripcion||null}, tipo_unidad=${parseInt(tipo_unidad)||1} WHERE id=${id}`;
    res.send('Unidad actualizada correctamente');
  } else {
    await sql`INSERT INTO micro (unidad, descripcion, tipo_unidad) VALUES (${unidad},${descripcion||null},${parseInt(tipo_unidad)||1})`;
    res.send('Unidad creada correctamente');
  }
});

// POST /ajax/save_modelo
router.post('/save_modelo', requireMaster, async (req, res) => {
  const { id, marca, modelo } = req.body;
  if (id) {
    await sql`UPDATE marcas_ruedas SET marca=${marca}, modelo=${modelo} WHERE id=${id}`;
    res.send('Modelo actualizado correctamente');
  } else {
    await sql`INSERT INTO marcas_ruedas (marca, modelo) VALUES (${marca},${modelo})`;
    res.send('Modelo creado correctamente');
  }
});

// POST /ajax/save_proveedor
router.post('/save_proveedor', requireMaster, async (req, res) => {
  const { id, proveedor, tel, mail } = req.body;
  if (id) {
    await sql`UPDATE proveedor SET proveedor=${proveedor}, tel=${tel||'-'}, mail=${mail||'-'} WHERE id=${id}`;
    res.send('Proveedor actualizado correctamente');
  } else {
    await sql`INSERT INTO proveedor (proveedor, tel, mail) VALUES (${proveedor},${tel||'-'},${mail||'-'})`;
    res.send('Proveedor creado correctamente');
  }
});

// POST /ajax/save_almacen
router.post('/save_almacen', requireMaster, async (req, res) => {
  const { id, nombre } = req.body;
  if (id) {
    await sql`UPDATE almacen SET nombre=${nombre} WHERE id=${id}`;
    res.send('Almacén actualizado correctamente');
  } else {
    await sql`INSERT INTO almacen (nombre) VALUES (${nombre})`;
    res.send('Almacén creado correctamente');
  }
});

// POST /ajax/save_gomeria
router.post('/save_gomeria', requireMaster, async (req, res) => {
  const { id, nombre } = req.body;
  if (id) {
    await sql`UPDATE gomeria SET nombre=${nombre} WHERE id=${id}`;
    res.send('Gomería actualizada correctamente');
  } else {
    await sql`INSERT INTO gomeria (nombre) VALUES (${nombre})`;
    res.send('Gomería creada correctamente');
  }
});

// POST /ajax/save_recapadora
router.post('/save_recapadora', requireMaster, async (req, res) => {
  const { id, nombre } = req.body;
  if (id) {
    await sql`UPDATE recapadora SET nombre=${nombre} WHERE id=${id}`;
    res.send('Recapadora actualizada correctamente');
  } else {
    await sql`INSERT INTO recapadora (nombre) VALUES (${nombre})`;
    res.send('Recapadora creada correctamente');
  }
});

// POST /ajax/save_medida
router.post('/save_medida', requireMaster, async (req, res) => {
  const { id, medida } = req.body;
  if (id) {
    await sql`UPDATE medidas SET medida=${medida} WHERE id=${id}`;
    res.send('Medida actualizada correctamente');
  } else {
    await sql`INSERT INTO medidas (medida) VALUES (${medida})`;
    res.send('Medida creada correctamente');
  }
});

// POST /ajax/listar_ruedas - Listar cubiertas para selección en micro
router.post('/listar_ruedas', requireAuth, async (req, res) => {
  const { almacen = 0, fuego = '', modelo = 0, estado = 0, micro_id, km, pos, seleccionadas = '' } = req.body;

  const cubiertas = await sql`
    SELECT c.id, c.fuego, mr.marca, mr.modelo AS modelo_nombre, m.medida, c.estado
    FROM cubiertas c
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas m ON c.medida_id = m.id
    WHERE c.activo = 1
      AND c.micro_id IS NULL
      AND (${parseInt(almacen)} = 0 OR c.almacen_id = ${parseInt(almacen)})
      AND (${fuego} = '' OR c.fuego ILIKE ${'%' + fuego + '%'})
      AND (${parseInt(modelo)} = 0 OR c.modelo_id = ${parseInt(modelo)})
      AND (${parseInt(estado)} = 0 OR c.estado = ${parseInt(estado)})
    ORDER BY c.fuego
    LIMIT 50
  `;

  const estadoNombre = (e) => e === 1 ? 'Nueva' : e === 2 ? 'Usada' : 'Recapada';

  let html = '<table><thead><th>Fuego</th><th>Modelo</th><th>Medida</th><th>Estado</th><th></th></thead>';
  for (const c of cubiertas) {
    html += `<tr>
      <td>${c.fuego || '-'}</td>
      <td>${c.marca} ${c.modelo_nombre}</td>
      <td>${c.medida || '-'}</td>
      <td>${estadoNombre(c.estado)}</td>
      <td><input type="button" value="Seleccionar" onclick="colocar(${c.id}, ${micro_id}, '${pos}')" /></td>
    </tr>`;
  }
  html += '</table>';
  res.send(html);
});

// POST /ajax/colocar_rueda - Colocar cubierta en posición de micro
router.post('/colocar_rueda', requireAuth, async (req, res) => {
  const { id, unidad, pos } = req.body;
  // Verificar si ya hay una cubierta en esa posición
  const existing = await sql`SELECT id FROM cubiertas WHERE micro_id = ${unidad} AND posicion = ${pos} AND activo = 1`;
  if (existing.length) {
    // Retorna el id de la cubierta que estaba para reubicar
    await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL WHERE id = ${existing[0].id}`;
  }
  await sql`UPDATE cubiertas SET micro_id = ${unidad}, posicion = ${pos}, almacen_id = NULL, gomeria_id = NULL WHERE id = ${id}`;
  res.send('OK');
});

// POST /ajax/almacenar_rueda - Guardar cubierta en almacén desde micro
router.post('/almacenar_rueda', requireAuth, async (req, res) => {
  const { r_id, almacen_id } = req.body;
  await sql`UPDATE cubiertas SET almacen_id = ${almacen_id}, micro_id = NULL, posicion = NULL, gomeria_id = NULL WHERE id = ${r_id}`;
  res.send('ok');
});

// POST /ajax/almacenar_ruedas - Guardar múltiples cubiertas en almacén
router.post('/almacenar_ruedas', requireAuth, async (req, res) => {
  const { almacen_id, cubiertas_ids } = req.body;
  if (!cubiertas_ids) return res.send('ok');
  const ids = Array.isArray(cubiertas_ids) ? cubiertas_ids : [cubiertas_ids];
  await sql`UPDATE cubiertas SET almacen_id = ${almacen_id}, gomeria_id = NULL, micro_id = NULL, posicion = NULL WHERE id = ANY(${ids.map(Number)})`;
  res.send('ok');
});

// POST /ajax/mb_cerrar_ot - Cerrar OT
router.post('/mb_cerrar_ot', requireAuth, async (req, res) => {
  const { ot_id, km_actual, factura, costo } = req.body;
  if (!km_actual) return res.send('');
  await sql`UPDATE ots SET estado = 1, factura = ${factura||null}, costo = ${costo||null} WHERE id = ${ot_id}`;
  if (km_actual) {
    const ot = await sql`SELECT unidad_id FROM ots WHERE id = ${ot_id}`;
    if (ot.length && ot[0].unidad_id) {
      await sql`UPDATE micro SET km_actual = ${parseInt(km_actual)} WHERE id = ${ot[0].unidad_id}`;
    }
  }
  res.send('ok');
});

// POST /ajax/nueva_ot - Crear nueva OT
router.post('/nueva_ot', requireAuth, async (req, res) => {
  const { numero, recapadora_id, fecha, gomeria_id, unidad_id } = req.body;
  const result = await sql`
    INSERT INTO ots (numero, recapadora_id, fecha, gomeria_id, unidad_id)
    VALUES (${numero}, ${recapadora_id||null}, ${fecha}, ${gomeria_id||null}, ${unidad_id||null})
    RETURNING id
  `;
  res.send(result[0].id.toString());
});

// POST /ajax/agregar_cubierta_ot - Agregar cubierta a OT
router.post('/agregar_cubierta_ot', requireAuth, async (req, res) => {
  const { ot_id, cubierta_id } = req.body;
  await sql`INSERT INTO ot_cubiertas (ot_id, cubierta_id) VALUES (${ot_id}, ${cubierta_id}) ON CONFLICT DO NOTHING`;
  await sql`UPDATE cubiertas SET gomeria_id = (SELECT gomeria_id FROM ots WHERE id = ${ot_id}), almacen_id = NULL WHERE id = ${cubierta_id}`;
  res.send('ok');
});

// POST /ajax/anular_ot
router.post('/anular_ot', requireMaster, async (req, res) => {
  const { ot_id } = req.body;
  await sql`DELETE FROM ot_cubiertas WHERE ot_id = ${ot_id}`;
  await sql`DELETE FROM ots WHERE id = ${ot_id}`;
  res.send('ok');
});

module.exports = router;
