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

  // La ruta pide gomerías, unidades y OTs en ese orden (Promise.all).
  const listaCon = (...ots) => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(ots);
    return request(app).get('/OTs/list').set('Cookie', `token=${makeToken()}`);
  };

  test('una OT cerrada muestra ingreso, salida y cuánto tardó', async () => {
    const res = await listaCon({
      id: 342, estado: 1, fecha: new Date(2026, 7, 25),
      creado_en: '2026-08-25T11:47:00Z',   // 08:47 en Argentina
      cerrado_en: '2026-08-25T14:02:00Z',  // 11:02 en Argentina
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('08:47');
    expect(res.text).toContain('11:02');
    expect(res.text).toContain('2 h 15 min');
  });

  test('una OT pendiente muestra la salida en curso', async () => {
    const res = await listaCon({
      id: 343, estado: 0, fecha: new Date(2026, 7, 25),
      creado_en: '2026-08-25T11:47:00Z', cerrado_en: null,
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('en curso');
  });

  test('una OT cerrada antes de la migración no inventa una duración', async () => {
    const res = await listaCon({
      id: 100, estado: 1, fecha: new Date(2026, 4, 10),
      creado_en: '2026-05-10T03:00:00Z',   // backfill: medianoche argentina
      cerrado_en: null,
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain('sin dato');
    expect(res.text).not.toMatch(/\d+ h \d+ min/);
  });

  test('la fecha de la OT no retrocede un día en UTC', async () => {
    // El runtime de Vercel está en UTC: una columna DATE llega como medianoche
    // UTC y antes se mostraba como el día anterior.
    const res = await listaCon({
      id: 342, estado: 1, fecha: new Date(2026, 7, 25), creado_en: null, cerrado_en: null,
    });
    expect(res.text).toContain('25/8/2026');
    expect(res.text).not.toContain('24/8/2026');
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

  // La hora de salida es la mitad de "cuanto tardo el trabajo": si el cierre no
  // la graba, la columna Ingreso/Salida queda en "sin dato" para siempre y nadie
  // se entera hasta que alguien mira la pantalla.
  const updateDeCierre = () => sql.mock.calls
    .map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
    .find(q => q.includes('UPDATE ots SET') && q.includes('estado = 1'));

  test('cerrar como admin graba la hora de salida', async () => {
    conOT(OT_CON_TRABAJOS);
    await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenAdmin()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000 });
    expect(updateDeCierre()).toContain('cerrado_en = NOW()');
  });

  test('cerrar un preventivo como gomero tambien graba la hora de salida', async () => {
    conOT(OT_SOLO_PREVENTIVO);
    await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenGomero()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000, descripcion_cierre: 'Todo OK' });
    expect(updateDeCierre()).toContain('cerrado_en = NOW()');
  });

  test('la hora de salida viaja en el mismo UPDATE que el estado', async () => {
    // Si algun dia se separan en dos statements, un fallo entre medio deja la OT
    // cerrada sin hora de salida. Que sea uno solo es lo que lo hace imposible.
    conOT(OT_CON_TRABAJOS);
    await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${tokenAdmin()}`)
      .type('form')
      .send({ ot_id: 1, km_actual: 250000 });
    const updates = sql.mock.calls
      .map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
      .filter(q => q.includes('UPDATE ots SET'));
    expect(updates.length).toBe(1);
    expect(updates[0]).toContain('estado = 1');
    expect(updates[0]).toContain('cerrado_en = NOW()');
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

// ─── La cubierta ya no lleva estado ───────────────────────────
describe('Montar una cubierta no le cambia ningún estado', () => {
  test('colocar_rueda solo mueve la cubierta, sin tocar estado', async () => {
    sql.mockResolvedValue([]);
    await request(app)
      .post('/ajax/colocar_rueda')
      .set('Cookie', `token=${makeToken(1, 'cubiertas_mover')}`)
      .type('form')
      .send({ id: 3, unidad: 5, pos: 'ddi' });

    const update = sql.mock.calls
      .map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
      .find(q => q.includes('UPDATE cubiertas SET micro_id'));
    expect(update).not.toContain('estado');
  });
});
