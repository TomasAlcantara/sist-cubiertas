/**
 * Tests del módulo de Órdenes de Trabajo
 *
 * Verifica que las rutas principales de OTs respondan correctamente
 * y que los endpoints AJAX de OTs manejen datos inválidos sin explotar.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  return { sql: fn };
});

jest.mock('../lib/mailer', () => ({
  enviarAvisoPinchadura: jest.fn().mockResolvedValue(undefined),
}));

const { sql } = require('../db');
const { enviarAvisoPinchadura } = require('../lib/mailer');
const app = require('../api/index');

function makeToken(tipo = 1, permisos) {
  const payload = { id: 1, usuario: 'test', tipo, nombre: 'Test' };
  if (permisos !== undefined) payload.permisos = permisos;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue([]);
});

// ─── Listado de OTs ───────────────────────────────────────────
describe('GET /OTs/list', () => {
  test('sin sesión → redirige a /login', async () => {
    const res = await request(app).get('/OTs/list');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  test('con sesión y DB vacía → 200 (lista vacía)', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .get('/OTs/list')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── Ver OT ───────────────────────────────────────────────────
describe('GET /OTs/ver', () => {
  test('OT inexistente → redirige a /OTs/list', async () => {
    sql.mockResolvedValue([]); // OT no encontrada
    const res = await request(app)
      .get('/OTs/ver?ot=99999')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/OTs/list');
  });

  test('ot=abc (no numérico) → no explota, redirige', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .get('/OTs/ver?ot=abc')
      .set('Cookie', `token=${makeToken()}`);
    expect([200, 302]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  test('sin parámetro ot → no explota', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .get('/OTs/ver')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).not.toBe(500);
  });
});

// ─── Nueva OT ─────────────────────────────────────────────────
describe('GET /OTs/nueva', () => {
  test('con sesión → 200', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .get('/OTs/nueva')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(200);
  });
});

// ─── POST /ajax/nueva_ot ──────────────────────────────────────
describe('POST /ajax/nueva_ot', () => {
  test('sin fecha → devuelve vacío, no explota', async () => {
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ gomeria_id: 1, unidad_id: 1 }); // sin fecha
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  test('con fecha válida → llama a DB y devuelve id', async () => {
    sql.mockResolvedValueOnce([{ id: 42 }]); // INSERT ... RETURNING id
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1 });
    expect(res.status).toBe(200);
    expect(res.text).toBe('42');
  });

  test('sin sesión → redirige a /login', async () => {
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .type('form')
      .send({ fecha: '15/04/2025' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  test('con pinchadura=1 → crea la OT y envía el aviso por mail', async () => {
    sql.mockResolvedValueOnce([{ id: 42 }]); // INSERT ... RETURNING id
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1, cambio: '1', pinchadura: '1' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('42');
    expect(enviarAvisoPinchadura).toHaveBeenCalledTimes(1);
    expect(enviarAvisoPinchadura).toHaveBeenCalledWith(expect.objectContaining({ otId: 42 }));
  });

  test('sin pinchadura → no envía mail', async () => {
    sql.mockResolvedValueOnce([{ id: 43 }]);
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1, cambio: '1', pinchadura: '0' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('43');
    expect(enviarAvisoPinchadura).not.toHaveBeenCalled();
  });

  test('si el mail falla, la OT se crea igual', async () => {
    sql.mockResolvedValueOnce([{ id: 44 }]);
    sql.mockResolvedValue([]);
    enviarAvisoPinchadura.mockRejectedValueOnce(new Error('smtp down'));
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1, cambio: '1', pinchadura: '1' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('44');
  });
});

// ─── POST /ajax/actualizar_ot ─────────────────────────────────
describe('POST /ajax/actualizar_ot', () => {
  test('sin campo pinchadura (caso CARGAR) → no explota y no envía mail', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/actualizar_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ ot_id: 7, fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1, cambio: '1' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('7');
    expect(enviarAvisoPinchadura).not.toHaveBeenCalled();
  });

  test('con pinchadura=1 → actualiza sin enviar mail', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/actualizar_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ ot_id: 8, fecha: '15/04/2025', gomeria_id: 1, unidad_id: 1, cambio: '1', pinchadura: '1' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('8');
    expect(enviarAvisoPinchadura).not.toHaveBeenCalled();
  });
});

// ─── POST /ajax/confirmar_cerrar_ot ──────────────────────────
describe('POST /ajax/confirmar_cerrar_ot', () => {
  test('sin km_actual → 400', async () => {
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ ot_id: 1 }); // sin km_actual
    expect(res.status).toBe(400);
  });

  test('ot_id inválido → 400', async () => {
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ ot_id: 'inyeccion', km_actual: 50000 });
    expect(res.status).toBe(400);
  });
});

// ─── POST /ajax/anular_ot ─────────────────────────────────────
describe('POST /ajax/anular_ot', () => {
  test('sin ot_id → 400', async () => {
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${makeToken(1)}`) // tipo master
      .type('form')
      .send({});
    expect(res.status).toBe(400);
  });

  test('sin motivo → 400 (el motivo es obligatorio)', async () => {
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${makeToken(1)}`)
      .type('form')
      .send({ ot_id: 5 });
    expect(res.status).toBe(400);
  });

  test('con ot_id y motivo válidos → anula', async () => {
    sql.mockResolvedValue([{ id: 5, anulada: false, unidad_id: null }]);
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${makeToken(1)}`)
      .type('form')
      .send({ ot_id: 5, motivo: 'duplicada' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});

// ─── Permisos: compatibilidad con usuarios anteriores ─────────
describe('permisosDe — usuarios sin la columna cargada', () => {
  const { permisosDe, PRESETS, TODOS, sanitizarPermisos } = require('../lib/permisos');

  test('tipo Master sin permisos → todos (no se queda afuera al deployar)', () => {
    expect(permisosDe({ tipo: 1 })).toEqual(TODOS);
  });

  test('tipo Gomería sin permisos → preset gomero', () => {
    expect(permisosDe({ tipo: 0 })).toEqual(PRESETS.gomero);
  });

  test('permisos explícitos ganan sobre el tipo', () => {
    expect(permisosDe({ tipo: 1, permisos: 'ot_ver' })).toEqual(['ot_ver']);
  });

  test('slugs inventados se descartan', () => {
    expect(sanitizarPermisos('ot_ver,borrar_todo,admin')).toEqual(['ot_ver', 'admin']);
  });

  test('CSV vacío → cae al fallback por tipo, no a lista vacía', () => {
    expect(permisosDe({ tipo: 1, permisos: '   ' })).toEqual(TODOS);
  });
});

// ─── Motivo rotura ────────────────────────────────────────────
describe('POST /ajax/nueva_ot — motivo rotura', () => {
  test('rotura=1 se persiste y NO dispara mail', async () => {
    sql.mockResolvedValue([{ id: 77 }]);
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, gomeria_id: 1, cambio: '1', pinchadura: '0', rotura: '1' });

    expect(res.status).toBe(200);
    expect(enviarAvisoPinchadura).not.toHaveBeenCalled();

    // El INSERT lleva la columna rotura
    const inserts = sql.mock.calls.filter(c => String(c[0]).includes('INSERT INTO ots'));
    expect(inserts.length).toBeGreaterThan(0);
    expect(String(inserts[0][0])).toContain('rotura');
  });

  test('pinchadura=1 sigue disparando el mail', async () => {
    sql.mockResolvedValue([{ id: 78 }]);
    await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, gomeria_id: 1, cambio: '1', pinchadura: '1', rotura: '0' });

    expect(enviarAvisoPinchadura).toHaveBeenCalled();
  });
});

// ─── Mediciones de profundidad ────────────────────────────────
describe('POST /ajax/nueva_ot — mediciones de profundidad', () => {
  const insertsMediciones = () =>
    sql.mock.calls.filter(c => String(c[0]).includes('INSERT INTO ot_mediciones'));

  test('JSON inválido no tumba la creación de la OT', async () => {
    sql.mockResolvedValue([{ id: 90 }]);
    const res = await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, cambio: '1', pinchadura: '0', rotura: '0',
              mediciones_json: '{esto no es json' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('90');
  });

  test('valores válidos se insertan', async () => {
    sql.mockResolvedValue([{ id: 91 }]);
    await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, cambio: '1', pinchadura: '0', rotura: '0',
              mediciones_json: JSON.stringify({ ddi: { ext: 8.5, int: 3 } }) });
    expect(insertsMediciones().length).toBe(1);
  });

  test('valores fuera de rango o no numéricos se descartan', async () => {
    sql.mockResolvedValue([{ id: 92 }]);
    await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, cambio: '1', pinchadura: '0', rotura: '0',
              mediciones_json: JSON.stringify({
                ddi: { ext: 999, int: 'ocho' },   // ambos inválidos → no se inserta
                ddd: { ext: -3, int: null },      // ambos inválidos → no se inserta
                tie: { ext: 7.5, int: 'x' },      // ext válido → sí se inserta
              }) });
    expect(insertsMediciones().length).toBe(1);
  });

  test('posición con nombre absurdo se ignora', async () => {
    sql.mockResolvedValue([{ id: 93 }]);
    await request(app)
      .post('/ajax/nueva_ot')
      .set('Cookie', `token=${makeToken()}`)
      .type('form')
      .send({ fecha: '20/08/2026', unidad_id: 1, cambio: '1', pinchadura: '0', rotura: '0',
              mediciones_json: JSON.stringify({ 'posicion-larguisima-invalida': { ext: 5 } }) });
    expect(insertsMediciones().length).toBe(0);
  });
});

// ─── Filtros del listado de OTs ───────────────────────────────
describe('GET /OTs/list — filtros por fecha y número', () => {
  const ultimaQueryOts = () =>
    sql.mock.calls.map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
      .find(q => q.includes('FROM ots'));

  test('rango de fechas se aplica', async () => {
    const res = await request(app)
      .get('/OTs/list?desde=01/08/2026&hasta=20/08/2026')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(200);
    const q = ultimaQueryOts();
    expect(q).toContain('o.fecha >=');
    expect(q).toContain('o.fecha <=');
    // Las fechas se mandan como parámetros ISO, no interpoladas
    const call = sql.mock.calls.find(c => Array.isArray(c[0]) && c[0].join(' ').includes('FROM ots'));
    expect(call.slice(1)).toContain('2026-08-01');
    expect(call.slice(1)).toContain('2026-08-20');
  });

  test('fecha con formato inválido no rompe ni filtra', async () => {
    const res = await request(app)
      .get('/OTs/list?desde=' + encodeURIComponent("'; DROP TABLE ots; --"))
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(200);
    const call = sql.mock.calls.find(c => Array.isArray(c[0]) && c[0].join(' ').includes('FROM ots'));
    // Queda en '' → el filtro se desactiva solo
    expect(call.slice(1)).toContain('');
    expect(call.slice(1)).not.toContain("'; DROP TABLE ots; --");
  });

  test('búsqueda por número cubre numero e id', async () => {
    const res = await request(app)
      .get('/OTs/list?numero=1042')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(200);
    const q = ultimaQueryOts();
    expect(q).toContain('o.numero ILIKE');
    expect(q).toContain('CAST(o.id AS TEXT)');
  });
});

// ─── Paginador agrupado ───────────────────────────────────────
describe('paginacion — helper de hojas agrupadas', () => {
  const pag = app.locals.paginacion;
  const href = p => '?pagina=' + p;
  const nums = h => (h.match(/>(\d+)</g) || []).map(m => parseInt(m.slice(1, -1)));

  test('una sola hoja no dibuja paginador', () => {
    expect(pag(1, 1, href)).toBe('');
    expect(pag(1, 0, href)).toBe('');
  });

  test('con muchas hojas muestra primera, última y ±2', () => {
    expect(nums(pag(7, 120, href))).toEqual([1, 5, 6, 7, 8, 9, 120]);
  });

  test('sin saltos innecesarios cerca del inicio', () => {
    expect(pag(1, 3, href)).not.toContain('pg-gap');
  });

  test('página fuera de rango se acota al total', () => {
    expect(nums(pag(999, 10, href))).toEqual([1, 8, 9, 10]);
  });

  test('la actual se marca y no es link', () => {
    const html = pag(7, 120, href);
    expect(html).toContain('<strong class="pg-current">7</strong>');
    expect(html).not.toContain(">7</a>");
  });
});

// ─── Cierre segregado: gomero vs administrador ────────────────
describe('POST /ajax/confirmar_cerrar_ot — quién puede cerrar qué', () => {
  const OT_SOLO_PREVENTIVO = {
    id: 1, estado: 0, unidad_id: 5, fecha: '2026-08-20',
    preventivo: true, rotacion: false, arreglo: false, cambio: false,
    alinear: false, balanceo: false, armar: false,
  };
  const OT_CON_TRABAJOS = { ...OT_SOLO_PREVENTIVO, cambio: true };

  // La primera query de confirmar_cerrar_ot es el SELECT de la OT
  const conOT = (ot) => {
    sql.mockReset();
    sql.mockImplementation((q) => {
      const txt = Array.isArray(q) ? q.join(' ? ') : String(q);
      if (txt.includes('SELECT * FROM ots')) return Promise.resolve([ot]);
      return Promise.resolve([]);
    });
  };

  const tokenGomero = () => makeToken(0, 'ot_ver,ot_cerrar_preventivo');
  const tokenAdmin = () => makeToken(1, 'ot_ver,ot_cerrar');

  test('gomero + OT con trabajos → 403', async () => {
    conOT(OT_CON_TRABAJOS);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenGomero()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, descripcion_cierre: 'algo' });
    expect(res.status).toBe(403);
    // Y no llegó a tocar la OT
    expect(sql.mock.calls.some(c => String(c[0]).includes('UPDATE ots'))).toBe(false);
  });

  test('gomero + OT solo preventivo + descripción → cierra', async () => {
    conOT(OT_SOLO_PREVENTIVO);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenGomero()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, descripcion_cierre: 'Presiones revisadas, todo OK' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  test('gomero sin descripción → 400', async () => {
    conOT(OT_SOLO_PREVENTIVO);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenGomero()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, descripcion_cierre: '   ' });
    expect(res.status).toBe(400);
  });

  test('gomero no puede colar trabajos por el body', async () => {
    conOT(OT_SOLO_PREVENTIVO);
    await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenGomero()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, descripcion_cierre: 'ok',
              cambio: '1', alinear: '1', armar: '1', factura: 'FALSA-1', costo: '99999' });

    const update = sql.mock.calls.find(c => String(c[0]).includes('UPDATE ots'));
    const params = update.slice(1);
    // Los flags se ignoran: solo queda el preventivo en true
    expect(params.filter(v => v === true)).toEqual([true]);
    // Y ni factura ni costo se guardan
    expect(params).not.toContain('FALSA-1');
    expect(params).not.toContain('99999');
  });

  test('admin cierra OT con trabajos y sus flags valen', async () => {
    conOT(OT_CON_TRABAJOS);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenAdmin()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, cambio: '1', alinear: '1', factura: 'A-001' });
    expect(res.status).toBe(200);
    const update = sql.mock.calls.find(c => String(c[0]).includes('UPDATE ots'));
    expect(update.slice(1)).toContain('A-001');
  });

  test('OT ya cerrada → 400 (no se re-cierra)', async () => {
    conOT({ ...OT_SOLO_PREVENTIVO, estado: 1 });
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenAdmin()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000 });
    expect(res.status).toBe(400);
  });

  test('OT inexistente → 404', async () => {
    conOT(undefined);
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenAdmin()}`)
      .type('form')
      .send({ ot_id: 999, km_actual: 250000 });
    expect(res.status).toBe(404);
  });
});

// ─── Nueva → Usada al montarse ────────────────────────────────
describe('Cubierta Nueva pasa a Usada al montarse', () => {
  test('colocar_rueda degrada Nueva pero respeta Recapada', async () => {
    sql.mockResolvedValue([]);
    await request(app)
      .post('/ajax/colocar_rueda')
      .set('Cookie', `token=${makeToken(1, 'cubiertas_mover')}`)
      .type('form')
      .send({ id: 3, unidad: 5, pos: 'ddi' });

    const update = sql.mock.calls
      .map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
      .find(q => q.includes('UPDATE cubiertas SET micro_id'));
    expect(update).toContain('CASE WHEN estado = 1 THEN 2 ELSE estado END');
  });
});
