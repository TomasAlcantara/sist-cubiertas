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

  test('con ot_id válido y tipo master → llama a DB', async () => {
    sql.mockResolvedValue([]);
    const res = await request(app)
      .post('/ajax/anular_ot')
      .set('Cookie', `token=${makeToken(1)}`)
      .type('form')
      .send({ ot_id: 5 });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(sql).toHaveBeenCalled();
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
