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
  await sql(`UPDATE ${table} SET activo = $1 WHERE id = $2`, [active, id]);
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
  const { r_id, estado } = req.body;
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

// POST /ajax/listar_ruedas - Listar cubiertas para selección en micro u OT
router.post('/listar_ruedas', requireAuth, async (req, res) => {
  const { almacen = 0, fuego = '', modelo = 0, medida = 0, estado = 0, micro_id, pos, modo = 'micro' } = req.body;

  const cubiertas = await sql`
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
  `;

  const estadoNombre = (e) => e === 1 ? 'Nueva' : e === 2 ? 'Usada' : 'Recapada';

  let html = '<table><thead><th>Fuego</th><th>Modelo</th><th>Medida</th><th>Estado</th><th>Kilómetros</th><th></th></thead>';
  for (const c of cubiertas) {
    const fuegoSafe = (c.fuego || '').replace(/'/g, "\\'");
    const modeloSafe = ((c.marca || '') + ' ' + (c.modelo_nombre || '')).trim().replace(/'/g, "\\'");
    const medidaSafe = (c.medida || '-').replace(/'/g, "\\'");
    const btn = modo === 'ot'
      ? `<input type="button" value="Seleccionar" onclick="seleccionar_ot(${c.id}, '${fuegoSafe}', '${modeloSafe}', '${medidaSafe}')" />`
      : `<input type="button" value="Seleccionar" onclick="colocar(${c.id}, ${micro_id}, '${pos}')" />`;
    html += `<tr>
      <td>${c.fuego || '-'}</td>
      <td>${c.marca || ''} ${c.modelo_nombre || ''}</td>
      <td>${c.medida || '-'}</td>
      <td>${estadoNombre(c.estado)}</td>
      <td>${c.km || 0}</td>
      <td>${btn}</td>
    </tr>`;
  }
  html += '</table>';
  res.send(html);
});

// GET /ajax/cubiertas_unidad - Obtener cubiertas actuales de un micro por posición
router.get('/cubiertas_unidad', requireAuth, async (req, res) => {
  const { unidad_id } = req.query;
  if (!unidad_id) return res.json({ tipo_unidad: 1, cubiertas: [] });
  const [micros, cubiertas] = await Promise.all([
    sql`SELECT tipo_unidad FROM micro WHERE id = ${parseInt(unidad_id)}`,
    sql`
      SELECT c.id, c.fuego, c.posicion
      FROM cubiertas c
      WHERE c.micro_id = ${parseInt(unidad_id)} AND c.activo = 1 AND c.posicion IS NOT NULL
      ORDER BY c.posicion
    `
  ]);
  res.json({
    tipo_unidad: micros[0]?.tipo_unidad || 1,
    cubiertas
  });
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

// POST /ajax/mb_cerrar_ot - Devuelve formulario HTML para confirmar cierre de OT
router.post('/mb_cerrar_ot', requireAuth, async (req, res) => {
  const { ot_id } = req.body;
  const rows = await sql`
    SELECT o.*, m.unidad, m.km_actual, g.nombre AS gomeria_nombre
    FROM ots o
    LEFT JOIN micro m ON o.unidad_id = m.id
    LEFT JOIN gomeria g ON o.gomeria_id = g.id
    WHERE o.id = ${ot_id}
  `;
  if (!rows.length) return res.send('');
  const ot = rows[0];

  const cubiertas = await sql`
    SELECT oc.posicion, c.fuego, mr.marca, mr.modelo AS modelo_nombre, med.medida
    FROM ot_cubiertas oc
    JOIN cubiertas c ON oc.cubierta_id = c.id
    LEFT JOIN marcas_ruedas mr ON c.modelo_id = mr.id
    LEFT JOIN medidas med ON c.medida_id = med.id
    WHERE oc.ot_id = ${ot_id} AND oc.posicion IS NOT NULL
    ORDER BY oc.posicion
  `;

  const trabajos = [];
  if (ot.rotacion) trabajos.push('Rotación');
  if (ot.arreglo) trabajos.push('Arreglo');
  if (ot.cambio) trabajos.push('Cambio');
  if (ot.alinear) trabajos.push('Alinear');
  if (ot.balanceo) trabajos.push('Balanceo');
  if (ot.armar) trabajos.push('Armar');

  let html = `
    <div style="padding:16px; font-size:13px;">
      <img src="/images/rojo.png" style="float:right; border:0; margin:2px; height:15px; cursor:pointer;" onclick="close_carga();" />
      <h3 style="margin:0 0 10px 0;">Cerrar OT N° ${ot_id}</h3>
      <p><strong>Unidad:</strong> ${ot.unidad||'-'} &nbsp;&nbsp; <strong>Gomería:</strong> ${ot.gomeria_nombre||'-'}</p>
      ${trabajos.length ? `<p><strong>Trabajos:</strong> ${trabajos.join(', ')}</p>` : ''}
      ${cubiertas.length ? `
        <p><strong>Cubiertas a cambiar:</strong></p>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead><tr><th>Posición</th><th>Fuego</th><th>Modelo</th><th>Medida</th></tr></thead>
          ${cubiertas.map(c => `<tr>
            <td align="center">${c.posicion||'-'}</td>
            <td align="center">${c.fuego||'-'}</td>
            <td align="center">${c.marca||''} ${c.modelo_nombre||''}</td>
            <td align="center">${c.medida||'-'}</td>
          </tr>`).join('')}
        </table>
      ` : ''}
      <hr style="margin:12px 0;" />
      <p>
        <strong>Km actuales de la unidad:</strong>
        <input type="number" id="km_cierre" value="${ot.km_actual||''}" style="width:120px; margin-left:10px;" placeholder="km" />
      </p>
      <p>
        <strong>N° Factura:</strong>
        <input type="text" id="factura_cierre" style="width:180px; margin-left:10px;" placeholder="Opcional" />
      </p>
      <p>
        <strong>Costo $:</strong>
        <input type="number" id="costo_cierre" style="width:120px; margin-left:10px;" placeholder="Opcional" />
      </p>
      <div style="margin-top:14px; text-align:center;">
        <input type="button" value="Confirmar cierre" onclick="confirmar_cerrar(${ot_id})" style="width:160px;" />
        <input type="button" value="Cancelar" onclick="close_carga();" style="width:100px; margin-left:12px;" />
      </div>
    </div>`;
  res.send(html);
});

// POST /ajax/confirmar_cerrar_ot - Ejecuta el cierre de OT y mueve cubiertas
router.post('/confirmar_cerrar_ot', requireAuth, async (req, res) => {
  const { ot_id, km_actual, factura, costo } = req.body;
  if (!km_actual) return res.status(400).send('km requerido');

  await sql`UPDATE ots SET estado = 1, factura = ${factura||null}, costo = ${costo||null} WHERE id = ${ot_id}`;

  const ot = await sql`SELECT unidad_id FROM ots WHERE id = ${ot_id}`;
  const unidad_id = ot[0]?.unidad_id;
  if (unidad_id) {
    await sql`UPDATE micro SET km_actual = ${parseInt(km_actual)} WHERE id = ${unidad_id}`;
  }

  const cambios = await sql`
    SELECT cubierta_id, cubierta_anterior_id, posicion
    FROM ot_cubiertas
    WHERE ot_id = ${ot_id} AND posicion IS NOT NULL AND cubierta_id IS NOT NULL
  `;

  for (const c of cambios) {
    await sql`
      UPDATE cubiertas SET micro_id = ${unidad_id}, posicion = ${c.posicion}, almacen_id = NULL, gomeria_id = NULL
      WHERE id = ${c.cubierta_id}
    `;
    if (c.cubierta_anterior_id) {
      await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = 1 WHERE id = ${c.cubierta_anterior_id}`;
    } else if (unidad_id) {
      await sql`UPDATE cubiertas SET micro_id = NULL, posicion = NULL, almacen_id = 1 WHERE micro_id = ${unidad_id} AND posicion = ${c.posicion} AND id != ${c.cubierta_id}`;
    }
  }

  res.send('ok');
});

// POST /ajax/nueva_ot - Crear nueva OT con posiciones de cubiertas
router.post('/nueva_ot', requireAuth, async (req, res) => {
  const { fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar } = req.body;
  if (!fecha) return res.send('');

  const result = await sql`
    INSERT INTO ots (fecha, gomeria_id, unidad_id, observaciones, rotacion, arreglo, cambio, alinear, balanceo, armar)
    VALUES (
      ${fecha}, ${gomeria_id||null}, ${unidad_id||null}, ${observaciones||null},
      ${rotacion === '1'}, ${arreglo === '1'}, ${cambio === '1'},
      ${alinear === '1'}, ${balanceo === '1'}, ${armar === '1'}
    )
    RETURNING id
  `;
  const ot_id = result[0].id;

  // Recibir cambios como JSON: { pos: cubierta_id, ... }
  // El frontend envía cambios_ot_json = JSON.stringify({ddi: 5, ddd: 8, ...})
  const cambiosJson = req.body.cambios_ot_json;
  if (cambiosJson) {
    try {
      const cambios = JSON.parse(cambiosJson); // { posicion: cubierta_nueva_id }
      for (const [posicion, cubierta_id] of Object.entries(cambios)) {
        if (!cubierta_id) continue;
        // Buscar cubierta anterior en esa posición
        const anterior = await sql`
          SELECT id FROM cubiertas
          WHERE micro_id = ${unidad_id||null} AND posicion = ${posicion} AND activo = 1
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
