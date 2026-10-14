/**
 * Tests del módulo de Órdenes de Trabajo
 *
 * Verifica que las rutas principales de OTs respondan correctamente
 * y que los endpoints AJAX de OTs manejen datos inválidos sin explotar.
 */
const request = require('./pedido');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  // sql.transaction([...]) recibe las consultas ya armadas y devuelve, en orden,
  // el resultado de cada una. Acá una "consulta" es la promesa que devolvió el
  // mock de sql, así que alcanza con esperarlas todas.
  fn.transaction = jest.fn((consultas) => Promise.all(consultas));
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

// Texto de una llamada a sql`...`, en una línea y con un ? donde iba cada valor.
const textoDe = (q) => (Array.isArray(q) ? q.join('?') : String(q)).replace(/\s+/g, ' ').trim();

/**
 * Base de mentira armada con reglas [texto, filas]: la primera regla cuyo texto
 * aparezca en la consulta decide qué devuelve (o, si es un Error, con qué falla).
 * Cada promesa lleva pegados el texto y los valores de su consulta, para poder
 * mirar después qué viajó adentro de un sql.transaction([...]).
 */
function baseCon(reglas = []) {
  sql.mockReset();
  sql.mockImplementation((q, ...valores) => {
    const texto = textoDe(q);
    const regla = reglas.find(([clave]) => texto.includes(clave));
    const filas = regla ? regla[1] : [];
    const promesa = filas instanceof Error ? Promise.reject(filas) : Promise.resolve(filas);
    promesa.catch(() => {});   // la espera quien la use; acá solo se evita el aviso de rechazo suelto
    promesa.texto = texto;
    promesa.valores = valores;
    return promesa;
  });
}

// Todas las consultas que se armaron, en orden, hayan ido o no en una transacción.
const consultas = () => sql.mock.results.map(r => r.value).filter(p => p && p.texto);
const consultaCon = (clave) => consultas().find(p => p.texto.includes(clave));
const esEscritura = (p) => /^(INSERT|UPDATE|DELETE)/.test(p.texto);
// Lo que viajó dentro de sql.transaction, en orden.
const enTransaccion = () => sql.transaction.mock.calls.flatMap(([lote]) => lote);
const comienzo = (p) => p.texto.split(' ').slice(0, 3).join(' ');

// Los tests que provocan un rechazo a propósito pasan por el handler global, que
// lo imprime por consola: se calla para que la salida muestre solo lo inesperado.
const callarErrores = () => {
  let espia;
  beforeEach(() => { espia = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => espia.mockRestore());
};

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
      // El cierre pide RETURNING id para saber que fue este pedido el que la cerró
      if (txt.includes('UPDATE ots SET') && ot) return Promise.resolve([{ id: ot.id }]);
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

// ─── Cubiertas de la OT: una sola por posición ────────────────
// Guardar una OT hacía un upsert por (ot, cubierta): al elegir otra cubierta
// para una posición ya cargada, la fila de la primera quedaba viva y el cierre
// montaba las dos en el mismo lugar. Así quedó la unidad 5074 con 12 cubiertas
// en 6 posiciones.
const CUBIERTAS_ELEGIDAS = 'c.activo, c.micro_id, m.unidad';      // validarCubiertasDeOt: las de la OT
const OCUPANTES = 'SELECT id, posicion FROM cubiertas';            // validarCubiertasDeOt: lo montado hoy
const FILAS_DE_LA_OT = 'posicion_actual';                          // leerEstadoParaCierre: filas de la OT
const MONTADAS = 'SELECT id, fuego, posicion FROM cubiertas';      // leerEstadoParaCierre: lo montado hoy
const A_VERIFICAR = 'SELECT id, activo FROM almacen';              // almacenAVerificar

const LIBRES = [
  { id: 13220, fuego: '14291', activo: 1, micro_id: null, unidad: null },
  { id: 13219, fuego: '14290', activo: 1, micro_id: null, unidad: null },
];
// Una fila de la OT tal como la devuelve leerEstadoParaCierre: libre, salvo que se diga dónde está.
const fila = (cubierta_id, posicion, fuego, donde = {}) => ({
  cubierta_id, posicion, fuego, activo: 1, micro_id: null, posicion_actual: null, unidad: null, ...donde,
});

describe('POST /ajax/actualizar_ot — cubiertas de la OT', () => {
  callarErrores();
  const OT = { id: 592, estado: 0, anulada: false, unidad_id: 399 };

  const guardar = (extra = {}) => request(app)
    .post('/ajax/actualizar_ot')
    .set('Cookie', `token=${makeToken()}`)
    .type('form')
    .send({ ot_id: 592, fecha: '07/10/2026', unidad_id: 399, gomeria_id: 1, cambio: '1', ...extra });

  test('guardar reemplaza el juego: borra lo que había e inserta lo de la pantalla, en una transacción', async () => {
    baseCon([['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await guardar({ cambios_ot_json: '{"ddi":13220,"ddd":13219}' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('592');
    expect(sql.transaction).toHaveBeenCalledTimes(1);
    const lote = enTransaccion();
    expect(lote.map(comienzo)).toEqual([
      'DELETE FROM ot_cubiertas', 'INSERT INTO ot_cubiertas', 'INSERT INTO ot_cubiertas',
    ]);
    // El DELETE es de esta OT y no se lleva las filas sin posición
    expect(lote[0].valores).toEqual([592]);
    expect(lote[0].texto).toContain('posicion IS NOT NULL');
    // Ninguna fila de cubiertas se escribe por fuera de la transacción
    const sueltas = consultas().filter(p => esEscritura(p) && p.texto.includes('ot_cubiertas') && !lote.includes(p));
    expect(sueltas).toHaveLength(0);
  });

  test('la "anterior" que anota es la que hoy ocupa esa posición', async () => {
    baseCon([
      ['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES],
      [OCUPANTES, [{ id: 13340, posicion: 'ddi' }]],
    ]);
    await guardar({ cambios_ot_json: '{"ddi":13220,"ddd":13219}' });
    const filas = enTransaccion().filter(p => p.texto.startsWith('INSERT')).map(p => p.valores);
    expect(filas).toEqual([[592, 13220, 'ddi', 13340], [592, 13219, 'ddd', null]]);
  });

  test('las cubiertas se validan antes de tocar la OT', async () => {
    baseCon([['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    await guardar({ cambios_ot_json: '{"ddi":13220}' });
    const orden = consultas().map(p => p.texto);
    const valida = orden.findIndex(t => t.includes(CUBIERTAS_ELEGIDAS));
    const actualiza = orden.findIndex(t => t.startsWith('UPDATE ots SET'));
    expect(valida).toBeGreaterThan(-1);
    expect(valida).toBeLessThan(actualiza);
  });

  test('{} es una OT sin cubiertas en pantalla: borra las filas', async () => {
    baseCon([['SELECT * FROM ots', [OT]]]);
    const res = await guardar({ cambios_ot_json: '{}' });
    expect(res.status).toBe(200);
    expect(enTransaccion().map(comienzo)).toEqual(['DELETE FROM ot_cubiertas']);
  });

  test('si el formulario no manda cubiertas, no las toca', async () => {
    baseCon([['SELECT * FROM ots', [OT]]]);
    const res = await guardar();
    expect(res.status).toBe(200);
    expect(sql.transaction).not.toHaveBeenCalled();
    expect(consultaCon('ot_cubiertas')).toBeUndefined();
  });

  test('cubierta montada en otra unidad → 400 con el motivo, y no escribe nada', async () => {
    // Lo que pasó con la OT 80: se armó para la unidad 153, se la cambió a la
    // 267 y al cerrar se llevó puestas cuatro cubiertas de la 153.
    baseCon([
      ['SELECT * FROM ots', [OT]],
      [CUBIERTAS_ELEGIDAS, [{ id: 6218, fuego: '7074', activo: 1, micro_id: 153, unidad: '153' }]],
    ]);
    const res = await guardar({ cambios_ot_json: '{"ddi":6218}' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('7074');
    expect(res.text).toContain('unidad 153');
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('una cubierta montada en esta misma unidad sí se puede cargar (rotación)', async () => {
    baseCon([
      ['SELECT * FROM ots', [OT]],
      [CUBIERTAS_ELEGIDAS, [{ id: 13221, fuego: '14292', activo: 1, micro_id: 399, unidad: '5074' }]],
    ]);
    const res = await guardar({ cambios_ot_json: '{"tde":13221}' });
    expect(res.status).toBe(200);
    expect(enTransaccion().map(comienzo)).toEqual(['DELETE FROM ot_cubiertas', 'INSERT INTO ot_cubiertas']);
  });

  test('cubierta dada de baja → 400', async () => {
    baseCon([
      ['SELECT * FROM ots', [OT]],
      [CUBIERTAS_ELEGIDAS, [{ id: 13220, fuego: '14291', activo: 0, micro_id: null, unidad: null }]],
    ]);
    const res = await guardar({ cambios_ot_json: '{"ddi":13220}' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('14291');
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('cubierta que no existe → 400', async () => {
    baseCon([['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, []]]);
    const res = await guardar({ cambios_ot_json: '{"ddi":99999}' });
    expect(res.status).toBe(400);
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test.each([
    ['la misma cubierta en dos posiciones', '{"ddi":13220,"tie":13220}'],
    ['una posición que no existe', '{"xyz":13220}'],
    ['algo que no es JSON', '{ddi:'],
  ])('%s → 400 y no escribe nada', async (_caso, json) => {
    baseCon([['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await guardar({ cambios_ot_json: json });
    expect(res.status).toBe(400);
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('OT cerrada → 400 y no le reescribe las cubiertas', async () => {
    // Antes el UPDATE de la OT se frenaba con "AND estado = 0", pero las filas
    // de cubiertas se regrababan igual desde una pestaña que hubiera quedado abierta.
    baseCon([['SELECT * FROM ots', [{ ...OT, estado: 1 }]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await guardar({ cambios_ot_json: '{"ddi":13220}' });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/cerrada/);
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('si la base falla al guardar las cubiertas responde 500, ya no dice que guardó', async () => {
    // El catch que estaba pensado para un JSON inválido también se tragaba esto.
    baseCon([
      ['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES],
      ['INSERT INTO ot_cubiertas', new Error('se cayó la conexión')],
    ]);
    const res = await guardar({ cambios_ot_json: '{"ddi":13220}' });
    expect(res.status).toBe(500);
  });
});

describe('POST /ajax/nueva_ot — cubiertas de la OT', () => {
  callarErrores();

  const crear = (extra = {}) => request(app)
    .post('/ajax/nueva_ot')
    .set('Cookie', `token=${makeToken()}`)
    .type('form')
    .send({ fecha: '08/10/2026', unidad_id: 399, gomeria_id: 1, cambio: '1', pinchadura: '0', rotura: '0', ...extra });

  test('crea la OT y le guarda sus cubiertas con el id nuevo', async () => {
    baseCon([['INSERT INTO ots', [{ id: 700 }]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await crear({ cambios_ot_json: '{"ddi":13220}' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('700');
    const filas = enTransaccion().filter(p => p.texto.startsWith('INSERT INTO ot_cubiertas')).map(p => p.valores);
    expect(filas).toEqual([[700, 13220, 'ddi', null]]);
  });

  test('con una cubierta que no se puede usar → 400 y la OT no se crea', async () => {
    baseCon([
      ['INSERT INTO ots', [{ id: 701 }]],
      [CUBIERTAS_ELEGIDAS, [{ id: 6218, fuego: '7074', activo: 1, micro_id: 153, unidad: '153' }]],
    ]);
    const res = await crear({ cambios_ot_json: '{"ddi":6218}' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('unidad 153');
    expect(consultaCon('INSERT INTO ots')).toBeUndefined();
  });

  test('una OT sin cubiertas no consulta ni abre una transacción de más', async () => {
    baseCon([['INSERT INTO ots', [{ id: 702 }]]]);
    const res = await crear({ cambios_ot_json: '{}' });
    expect(res.text).toBe('702');
    expect(sql.transaction).not.toHaveBeenCalled();
    expect(consultaCon(CUBIERTAS_ELEGIDAS)).toBeUndefined();
  });
});

// ─── Cierre: qué se mueve ─────────────────────────────────────
// El cierre montaba todas las filas de la OT y solo sacaba la "anterior" anotada
// al cargarla, con decenas de queries sueltas. Ahora decide con lo que hay
// montado en ese momento y escribe todo junto o nada.
describe('POST /ajax/confirmar_cerrar_ot — qué cubiertas se mueven', () => {
  callarErrores();
  const OT = {
    id: 592, estado: 0, anulada: false, unidad_id: 399, fecha: '2026-10-07',
    preventivo: false, rotacion: false, arreglo: false, cambio: true,
    alinear: false, balanceo: false, armar: false,
  };
  const VIEJA_EN_DDI = { id: 13340, fuego: '14404', posicion: 'ddi' };

  const escenario = ({ filas = [], montadas = [], reglas = [] } = {}) => baseCon([
    ...reglas,
    ['SELECT * FROM ots', [OT]],
    [FILAS_DE_LA_OT, filas],
    [MONTADAS, montadas],
    ['UPDATE ots SET', [{ id: OT.id }]],
  ]);
  const cerrar = (extra = {}) => request(app)
    .post('/ajax/confirmar_cerrar_ot')
    .set('Cookie', `token=${makeToken(1, 'ot_ver,ot_cerrar')}`)
    .type('form')
    .send({ ot_id: 592, km_actual: 2362, cambio: '1', destino_almacen_id: '2', ...extra });
  const paso = (p) => {
    if (p.texto.startsWith('UPDATE ots SET')) return 'ot';
    if (p.texto.startsWith('UPDATE micro SET km_actual')) return 'km';
    if (p.texto.startsWith('UPDATE cubiertas SET micro_id = NULL')) return 'salen';
    if (p.texto.startsWith('UPDATE cubiertas SET posicion = NULL')) return 'sueltan';
    if (p.texto.startsWith('UPDATE cubiertas SET micro_id = ?')) return 'entra';
    if (p.texto.startsWith('UPDATE ot_cubiertas SET cubierta_anterior_id')) return 'anterior';
    if (p.texto.startsWith('INSERT INTO cubierta_eventos')) return 'evento:' + p.valores[1];
    return p.texto;
  };

  test('todo el cierre viaja en una sola transacción', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291')], montadas: [VIEJA_EN_DDI] });
    const res = await cerrar();

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
    expect(sql.transaction).toHaveBeenCalledTimes(1);
    // La OT, el km, las cubiertas y el historial: o se escribe todo, o nada.
    const lote = enTransaccion();
    expect(lote.map(paso)).toEqual([
      'ot', 'km', 'salen', 'entra', 'anterior', 'evento:retiro', 'evento:colocacion',
    ]);
    // Por fuera de la transacción solo queda el log de auditoría.
    const sueltas = consultas().filter(p => esEscritura(p) && !lote.includes(p));
    expect(sueltas.map(comienzo)).toEqual(['INSERT INTO auditoria']);
  });

  test('sale la que ocupa hoy la posición, aunque la OT no la tuviera anotada', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291')], montadas: [VIEJA_EN_DDI] });
    await cerrar();
    const lote = enTransaccion();
    // Al almacén elegido, y solo si sigue montada en esta unidad
    expect(lote.find(p => paso(p) === 'salen').valores).toEqual([2, [13340], 399]);
    expect(lote.find(p => paso(p) === 'entra').valores).toEqual([399, 'ddi', 13220]);
    // Y la OT queda diciendo a quién reemplazó de verdad
    expect(lote.find(p => paso(p) === 'anterior').valores).toEqual([13340, 592, 13220]);
  });

  test('rotación con recambio: primero salen, después sueltan su lugar las que rotan, recién ahí entran', async () => {
    // Las delanteras pasan atrás, entran dos nuevas adelante y las traseras viejas salen.
    const enUnidad = (posicion_actual) => ({ micro_id: 399, posicion_actual, unidad: '5074' });
    escenario({
      filas: [
        fila(91, 'ddd', '13402'), fila(92, 'ddi', '13412'),
        fila(1, 'tde', '12398', enUnidad('ddd')), fila(2, 'tdi', '12389', enUnidad('ddi')),
      ],
      montadas: [
        { id: 1, fuego: '12398', posicion: 'ddd' }, { id: 2, fuego: '12389', posicion: 'ddi' },
        { id: 3, fuego: '12394', posicion: 'tde' }, { id: 4, fuego: '11516', posicion: 'tdi' },
      ],
    });
    const res = await cerrar();
    expect(res.text).toBe('ok');
    const lote = enTransaccion();
    expect(lote.map(paso).filter(x => !x.startsWith('evento') && x !== 'anterior')).toEqual([
      'ot', 'km', 'salen', 'sueltan', 'entra', 'entra', 'entra', 'entra',
    ]);
    expect(lote.find(p => paso(p) === 'salen').valores[1]).toEqual([3, 4]);
    expect(lote.find(p => paso(p) === 'sueltan').valores[0]).toEqual([1, 2]);
    // En el historial, los retiros van antes que las colocaciones
    const eventos = lote.map(paso).filter(x => x.startsWith('evento'));
    expect(eventos).toEqual([...Array(4).fill('evento:retiro'), ...Array(4).fill('evento:colocacion')]);
  });

  test('una OT sin cubiertas solo cierra la OT y actualiza el km', async () => {
    escenario();
    const res = await cerrar();
    expect(res.text).toBe('ok');
    expect(enTransaccion().map(paso)).toEqual(['ot', 'km']);
  });

  test('dos cubiertas cargadas para la misma posición → 400 y no se escribe nada', async () => {
    escenario({ filas: [fila(13340, 'ddi', '14404'), fila(13220, 'ddi', '14291')] });
    const res = await cerrar();
    expect(res.status).toBe(400);
    expect(res.text).toContain('Del. Izq.');
    expect(res.text).toContain('14404');
    expect(res.text).toContain('14291');
    expect(sql.transaction).not.toHaveBeenCalled();
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('entrante que figura montada en otra unidad → 400 y no se la lleva', async () => {
    escenario({ filas: [fila(6218, 'ddi', '7074', { micro_id: 153, posicion_actual: 'tie', unidad: '153' })] });
    const res = await cerrar();
    expect(res.status).toBe(400);
    expect(res.text).toContain('unidad 153');
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('entrante dada de baja → 400', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291', { activo: 0 })] });
    const res = await cerrar();
    expect(res.status).toBe(400);
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('si otro pedido la cerró primero (doble clic) → 400 y no lo asienta dos veces', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291')], reglas: [['UPDATE ots SET', []]] });
    const res = await cerrar();
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/ya está cerrada/);
    expect(consultaCon('INSERT INTO auditoria')).toBeUndefined();
  });

  test('el cierre solo toma una OT que siga abierta y sin anular', async () => {
    escenario();
    await cerrar();
    const update = consultaCon('UPDATE ots SET estado = 1');
    expect(update.texto).toContain('AND estado = 0 AND anulada = FALSE');
    expect(update.texto).toContain('RETURNING id');
  });

  test('choque con un índice único → 409 para reintentar, sin asentar el cierre', async () => {
    const choque = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    escenario({
      filas: [fila(13220, 'ddi', '14291')],
      reglas: [['UPDATE cubiertas SET micro_id = ?, posicion = ?', choque]],
    });
    const res = await cerrar();
    expect(res.status).toBe(409);
    expect(res.text).toMatch(/Volvé a intentarlo/);
    expect(consultaCon('INSERT INTO auditoria')).toBeUndefined();
  });

  test('cualquier otro error de la base → 500', async () => {
    escenario({
      filas: [fila(13220, 'ddi', '14291')],
      reglas: [['UPDATE cubiertas SET micro_id = ?, posicion = ?', new Error('se cayó la conexión')]],
    });
    const res = await cerrar();
    expect(res.status).toBe(500);
    expect(consultaCon('INSERT INTO auditoria')).toBeUndefined();
  });

  test('el log dice qué fuegos salieron y cuáles entraron', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291')], montadas: [VIEJA_EN_DDI] });
    await cerrar();
    const cambios = JSON.parse(consultaCon('INSERT INTO auditoria').valores[6]);
    expect(cambios).toContainEqual({ campo: 'cubiertas', antes: 'Del. Izq.: 14404', despues: 'Del. Izq.: 14291' });
  });

  test('CEAMSE: la saliente se da de baja y queda asentado en su historial', async () => {
    escenario({ filas: [fila(13220, 'ddi', '14291')], montadas: [VIEJA_EN_DDI] });
    const res = await cerrar({ destino_almacen_id: 'ceamse' });
    expect(res.text).toBe('ok');
    const lote = enTransaccion();
    const salen = lote.find(p => paso(p) === 'salen');
    expect(salen.texto).toContain('activo = 0');
    expect(salen.valores).toEqual([[13340], 399]);
    expect(lote.map(paso).filter(x => x.startsWith('evento'))).toEqual([
      'evento:retiro', 'evento:baja', 'evento:colocacion',
    ]);
    // Dar de baja no es "sin destino": no va a buscar el almacén de verificación
    expect(consultaCon(A_VERIFICAR)).toBeUndefined();
  });
});

describe('POST /ajax/confirmar_cerrar_ot — salientes sin destino elegido', () => {
  // El formulario con el que el gomero cierra un preventivo no tiene selector de
  // destino. Las salientes caían en el almacén id 1 por un default del código, y
  // en producción el id 1 es "PRUEBA 01".
  const OT_PREVENTIVO = {
    id: 7, estado: 0, anulada: false, unidad_id: 5, fecha: '2026-10-08',
    preventivo: true, rotacion: false, arreglo: false, cambio: false,
    alinear: false, balanceo: false, armar: false,
  };
  const conUnaSaliente = (reglas = []) => baseCon([
    ...reglas,
    ['SELECT * FROM ots', [OT_PREVENTIVO]],
    [FILAS_DE_LA_OT, [fila(50, 'ddi', 'NUEVA')]],
    [MONTADAS, [{ id: 8, fuego: 'VIEJA', posicion: 'ddi' }]],
    ['UPDATE ots SET', [{ id: 7 }]],
  ]);
  const cerrarComoGomero = () => request(app)
    .post('/ajax/confirmar_cerrar_ot')
    .set('Cookie', `token=${makeToken(0, 'ot_ver,ot_cerrar_preventivo')}`)
    .type('form')
    .send({ ot_id: 7, km_actual: 250000, descripcion_cierre: 'Todo OK' });
  const salida = () => enTransaccion().find(p => p.texto.startsWith('UPDATE cubiertas SET micro_id = NULL'));

  test('van a "A VERIFICAR", no al almacén 1', async () => {
    conUnaSaliente([[A_VERIFICAR, [{ id: 19, activo: 1 }]]]);
    const res = await cerrarComoGomero();
    expect(res.text).toBe('ok');
    expect(consultaCon(A_VERIFICAR).valores).toEqual(['A VERIFICAR']);
    expect(salida().valores).toEqual([19, [8], 5]);
    // Ya existía y estaba activo: no hay nada que escribir en almacenes
    expect(consultaCon('INSERT INTO almacen')).toBeUndefined();
    expect(consultaCon('UPDATE almacen')).toBeUndefined();
  });

  test('si "A VERIFICAR" todavía no existe, lo crea', async () => {
    conUnaSaliente([[A_VERIFICAR, []], ['INSERT INTO almacen', [{ id: 20 }]]]);
    const res = await cerrarComoGomero();
    expect(res.text).toBe('ok');
    expect(consultaCon('INSERT INTO almacen').valores).toEqual(['A VERIFICAR']);
    expect(salida().valores[0]).toBe(20);
  });

  test('si estaba dado de baja lo reactiva: en un almacén inactivo las cubiertas no se ven', async () => {
    conUnaSaliente([[A_VERIFICAR, [{ id: 19, activo: 0 }]]]);
    await cerrarComoGomero();
    expect(consultaCon('UPDATE almacen SET activo = 1').valores).toEqual([19]);
    expect(salida().valores[0]).toBe(19);
  });

  test('si no sale ninguna cubierta, ni lo busca ni lo crea', async () => {
    baseCon([['SELECT * FROM ots', [OT_PREVENTIVO]], ['UPDATE ots SET', [{ id: 7 }]]]);
    const res = await cerrarComoGomero();
    expect(res.text).toBe('ok');
    expect(consultaCon(A_VERIFICAR)).toBeUndefined();
    expect(consultaCon('INSERT INTO almacen')).toBeUndefined();
  });

  test('con destino elegido se respeta y no se consulta "A VERIFICAR"', async () => {
    conUnaSaliente();
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${makeToken(1, 'ot_ver,ot_cerrar')}`)
      .type('form')
      .send({ ot_id: 7, km_actual: 250000, preventivo: '1', destino_almacen_id: '2' });
    expect(res.text).toBe('ok');
    expect(salida().valores[0]).toBe(2);
    expect(consultaCon(A_VERIFICAR)).toBeUndefined();
  });

  test('queda asentado en el log que no se eligió destino', async () => {
    conUnaSaliente([[A_VERIFICAR, [{ id: 19, activo: 1 }]]]);
    await cerrarComoGomero();
    const cambios = JSON.parse(consultaCon('INSERT INTO auditoria').valores[6]);
    expect(cambios.find(c => c.campo === 'destino de las salientes').despues).toContain('A VERIFICAR');
  });

  test('el modal le avisa al gomero a dónde van', async () => {
    baseCon([
      ['FROM ots o', [{ ...OT_PREVENTIVO, unidad: 'INT 5', tipo_unidad: 3, km_actual: 250000 }]],
      [FILAS_DE_LA_OT, [fila(50, 'ddi', 'NUEVA')]],
      [MONTADAS, [{ id: 8, fuego: 'VIEJA', posicion: 'ddi' }]],
    ]);
    const res = await request(app)
      .post('/ajax/mb_cerrar_ot')
      .set('Cookie', `token=${makeToken(0, 'ot_ver,ot_cerrar_preventivo')}`)
      .type('form')
      .send({ ot_id: 7 });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Cerrar Preventivo');
    expect(res.text).toMatch(/Las cubiertas que salen \(VIEJA\) van al almacén <strong>A VERIFICAR<\/strong>/);
  });
});

describe('POST /ajax/mb_cerrar_ot — vista previa del cierre', () => {
  const OT = {
    id: 592, estado: 0, anulada: false, unidad_id: 399, unidad: '5074', tipo_unidad: 3,
    km_actual: 2362, cambio: true,
  };
  const abrir = () => request(app)
    .post('/ajax/mb_cerrar_ot')
    .set('Cookie', `token=${makeToken(1, 'ot_ver,ot_cerrar')}`)
    .type('form')
    .send({ ot_id: 592 });

  test('muestra como saliente a la que está montada hoy y ofrece cerrar', async () => {
    baseCon([
      ['FROM ots o', [OT]],
      [FILAS_DE_LA_OT, [fila(13220, 'ddi', '14291')]],
      [MONTADAS, [{ id: 13340, fuego: '14404', posicion: 'ddi' }]],
    ]);
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.text).toContain('14291');
    expect(res.text).toContain('14404');
    expect(res.text).toContain('value="Cerrar OT"');
    expect(res.text).not.toContain('todavía no se puede cerrar');
  });

  test('una posición con dos cubiertas montadas las muestra a las dos', async () => {
    // Mientras no se limpien los duplicados, que se vean en vez de elegir una al azar.
    baseCon([
      ['FROM ots o', [OT]],
      [MONTADAS, [{ id: 6218, fuego: '7074', posicion: 'ddi' }, { id: 12671, fuego: '13574', posicion: 'ddi' }]],
    ]);
    const res = await abrir();
    expect(res.text).toContain('7074 / 13574');
  });

  test('si la OT no se puede cerrar lo explica y no ofrece el botón', async () => {
    baseCon([
      ['FROM ots o', [OT]],
      [FILAS_DE_LA_OT, [fila(13340, 'ddi', '14404'), fila(13220, 'ddi', '14291')]],
    ]);
    const res = await abrir();
    expect(res.status).toBe(200);
    expect(res.text).toContain('todavía no se puede cerrar');
    expect(res.text).toContain('Del. Izq.');
    expect(res.text).not.toContain('value="Cerrar OT"');
    expect(res.text).toContain('value="Cancelar"');
  });
});

// ─── La OT cerrada es una foto ────────────────────────────────
// El taller: "si cambio las cubiertas y cargo hoy, me modifica las órdenes
// pasadas". La pantalla de una OT cerrada rellenaba lo que esa OT no había tocado
// con lo que la unidad tiene montado hoy, y nunca mostraba la cubierta que salió.
describe('POST /ajax/confirmar_cerrar_ot — guarda cómo queda la unidad', () => {
  const OT = {
    id: 592, estado: 0, anulada: false, unidad_id: 399, fecha: '2026-10-07',
    preventivo: false, rotacion: false, arreglo: false, cambio: true,
    alinear: false, balanceo: false, armar: false,
  };
  const cerrarCon = async (filas, montadas) => {
    baseCon([
      ['SELECT * FROM ots', [OT]], [FILAS_DE_LA_OT, filas], [MONTADAS, montadas],
      ['UPDATE ots SET', [{ id: OT.id }]],
    ]);
    const res = await request(app)
      .post('/ajax/confirmar_cerrar_ot')
      .set('Cookie', `token=${makeToken(1, 'ot_ver,ot_cerrar')}`)
      .type('form')
      .send({ ot_id: 592, km_actual: 2362, cambio: '1', destino_almacen_id: '2' });
    expect(res.text).toBe('ok');
    const update = consultaCon('UPDATE ots SET estado = 1');
    return { update, esquema: JSON.parse(update.valores.find(v => typeof v === 'string' && v.startsWith('{"antes"'))) };
  };

  test('el esquema viaja en el mismo UPDATE que cierra la OT', async () => {
    const { update, esquema } = await cerrarCon(
      [fila(13220, 'ddi', '14291')],
      [{ id: 13340, fuego: '14404', posicion: 'ddi' }, { id: 9, fuego: 'B002', posicion: 'ddd' }]);

    expect(update.texto).toContain('esquema_cierre = ?');
    expect(enTransaccion()).toContain(update);
    expect(esquema).toEqual({
      antes:   { ddi: { id: 13340, fuego: '14404' }, ddd: { id: 9, fuego: 'B002' } },
      despues: { ddi: { id: 13220, fuego: '14291' }, ddd: { id: 9, fuego: 'B002' } },
    });
  });

  test('un preventivo sin cubiertas guarda la unidad tal como estaba ese día', async () => {
    const { esquema } = await cerrarCon([], [{ id: 9, fuego: 'B002', posicion: 'ddd' }]);
    expect(esquema.despues).toEqual({ ddd: { id: 9, fuego: 'B002' } });
    expect(esquema.antes).toEqual(esquema.despues);
  });
});

describe('GET /OTs/ver — una OT cerrada no se rellena con la unidad de hoy', () => {
  const DE_HOY = 'FROM cubiertas c WHERE c.micro_id';     // lo que la unidad tiene montado hoy
  const FILAS = 'fuego_anterior';                          // las cubiertas de la OT, con la que salió
  const CERRADA = {
    id: 394, numero: '394', estado: 1, anulada: false, fecha: '2026-09-02',
    unidad_id: 140, unidad: '267', tipo_unidad: 3, preventivo: true,
  };
  const HOY = [{ id: 1, fuego: 'MONTADA-HOY', posicion: 'tie' }];
  const ver = () => request(app).get('/OTs/ver?ot=394').set('Cookie', `token=${makeToken()}`);
  const esquemaEnPantalla = (html) => JSON.parse(html.match(/var ESQUEMA\s+= (.*);/)[1]);

  test('cerrada: ni consulta ni muestra lo que la unidad tiene montado hoy', async () => {
    baseCon([['FROM ots o', [CERRADA]], [DE_HOY, HOY]]);
    const res = await ver();
    expect(res.status).toBe(200);
    expect(consultaCon(DE_HOY)).toBeUndefined();
    expect(res.text).not.toContain('MONTADA-HOY');
  });

  test('abierta: sigue mostrando la unidad de hoy, que es lo que se va a trabajar', async () => {
    baseCon([['FROM ots o', [{ ...CERRADA, estado: 0 }]], [DE_HOY, HOY]]);
    const res = await ver();
    expect(consultaCon(DE_HOY)).toBeDefined();
    expect(res.text).toContain('MONTADA-HOY');
    expect(esquemaEnPantalla(res.text)).toBeNull();
  });

  test('cerrada con esquema guardado: la pantalla recibe la unidad completa de ese momento', async () => {
    const guardado = {
      antes:   { ddi: { id: 7, fuego: 'VIEJA' }, ddd: { id: 9, fuego: 'IGUAL' } },
      despues: { ddi: { id: 50, fuego: 'NUEVA' }, ddd: { id: 9, fuego: 'IGUAL' } },
    };
    baseCon([['FROM ots o', [{ ...CERRADA, esquema_cierre: guardado }]], [DE_HOY, HOY]]);
    const res = await ver();
    expect(esquemaEnPantalla(res.text)).toEqual({ completo: true, ...guardado });
    expect(res.text).toContain('Esquema al cerrar la OT');
    expect(res.text).not.toContain('se cerró antes de que el sistema guardara');
    expect(res.text).not.toContain('leyenda-dot sin-registro');
  });

  test('cerrada con esquema reconstruido (OT vieja): lo aclara, y marca lo que no se pudo saber', async () => {
    const guardado = {
      antes:   { ddi: { id: 7, fuego: 'VIEJA' }, ddd: { id: 9, fuego: 'IGUAL' } },
      despues: { ddi: { id: 7, fuego: 'VIEJA' }, ddd: { id: 9, fuego: 'IGUAL' } },
      sin_registro: ['ra'], reconstruido: true,
    };
    baseCon([['FROM ots o', [{ ...CERRADA, esquema_cierre: guardado }]], [DE_HOY, HOY]]);
    const res = await ver();
    expect(consultaCon(DE_HOY)).toBeUndefined();
    expect(esquemaEnPantalla(res.text)).toEqual({
      completo: true, antes: guardado.antes, despues: guardado.despues, reconstruido: true, sinRegistro: ['ra'],
    });
    expect(res.text).toContain('el esquema se reconstruyó con el historial de movimientos de cubiertas');
    expect(res.text).toContain('De las posiciones sin registro el historial no alcanza');
    expect(res.text).toContain('leyenda-dot sin-registro');
    expect(res.text).not.toContain('se ven solo las posiciones que cambió');
  });

  test('reconstruido sin posiciones dudosas: la nota, sin hablar de "sin registro"', async () => {
    const guardado = { antes: { ddd: { id: 9, fuego: 'IGUAL' } }, despues: { ddd: { id: 9, fuego: 'IGUAL' } }, reconstruido: true };
    baseCon([['FROM ots o', [{ ...CERRADA, esquema_cierre: guardado }]]]);
    const res = await ver();
    expect(res.text).toContain('el esquema se reconstruyó');
    expect(res.text).not.toContain('leyenda-dot sin-registro');
    expect(res.text).not.toContain('De las posiciones sin registro');
  });

  test('cerrada sin esquema (OT vieja): solo lo que cambió, y avisa que del resto no hay registro', async () => {
    baseCon([
      ['FROM ots o', [CERRADA]],
      [FILAS, [{ id: 50, fuego: 'NUEVA', posicion: 'ddi', cubierta_anterior_id: 7, fuego_anterior: 'VIEJA' }]],
    ]);
    const res = await ver();
    expect(esquemaEnPantalla(res.text)).toEqual({
      completo: false, antes: { ddi: { id: 7, fuego: 'VIEJA' } }, despues: { ddi: { id: 50, fuego: 'NUEVA' } },
    });
    expect(res.text).toContain('se cerró antes de que el sistema guardara');
    expect(res.text).toContain('Sin registro');
  });

  test('la tabla muestra qué cubierta salió de cada posición', async () => {
    baseCon([
      ['FROM ots o', [CERRADA]],
      [FILAS, [{ id: 50, fuego: 'NUEVA', posicion: 'ddi', cubierta_anterior_id: 7, fuego_anterior: 'VIEJA' }]],
    ]);
    const res = await ver();
    expect(res.text).toContain('<th>Sale</th>');
    expect(res.text).toMatch(/<td[^>]*>NUEVA<\/td>[\s\S]*?<td[^>]*>VIEJA<\/td>/);
  });

  test('la tabla suma las posiciones que la OT dejó vacías, y dice si la cubierta salió o rotó', async () => {
    const guardado = {
      antes:   { ra: { id: 7, fuego: 'AUXILIO' }, tie: { id: 1, fuego: 'ROTADA' } },
      despues: { tde: { id: 1, fuego: 'ROTADA' } },
    };
    baseCon([['FROM ots o', [{ ...CERRADA, esquema_cierre: guardado }]]]);
    const res = await ver();
    expect(res.text).toMatch(/Auxilio<\/td>\s*<td[^>]*>queda vacía<\/td>\s*<td[^>]*>AUXILIO</);
    expect(res.text).toContain('queda vacía: la cubierta pasó a Tras. Der. Ext.');
  });

  test('una OT vieja sin cubiertas no muestra ninguna: no hay registro', async () => {
    baseCon([['FROM ots o', [CERRADA]], [DE_HOY, HOY]]);
    const res = await ver();
    expect(esquemaEnPantalla(res.text)).toEqual({ completo: false, antes: {}, despues: {} });
    expect(res.text).toContain('Sin cubiertas registradas');
  });
});

// ─── Dejar un auxilio vacío ───────────────────────────────────
// El taller: "con los auxilios solo me permite cambiar un auxilio por otro, no me
// permite sacarlo por completo, para que quede vacía". La OT ahora puede anotar
// posiciones de las que sale la cubierta y no entra otra (`ots.posiciones_vaciar`).
describe('POST /ajax/nueva_ot — posiciones que la OT deja vacías', () => {
  callarErrores();
  const crear = (extra = {}) => request(app)
    .post('/ajax/nueva_ot')
    .set('Cookie', `token=${makeToken()}`)
    .type('form')
    .send({ fecha: '13/10/2026', unidad_id: 399, gomeria_id: 1, cambio: '1', pinchadura: '0', rotura: '0', ...extra });
  const alta = () => consultaCon('INSERT INTO ots');

  test('las guarda con la OT', async () => {
    baseCon([['INSERT INTO ots', [{ id: 700 }]]]);
    const res = await crear({ cambios_ot_json: '{}', vaciar_ot_json: '["ra"]' });
    expect(res.text).toBe('700');
    expect(alta().texto).toContain('posiciones_vaciar');
    expect(alta().valores.pop()).toEqual(['ra']);
  });

  test('una OT que no vacía nada guarda la lista vacía', async () => {
    baseCon([['INSERT INTO ots', [{ id: 701 }]]]);
    await crear({ cambios_ot_json: '{}' });
    expect(alta().valores.pop()).toEqual([]);
  });

  test('una rueda de rodado no se puede dejar vacía → 400 y la OT no se crea', async () => {
    baseCon([['INSERT INTO ots', [{ id: 702 }]]]);
    const res = await crear({ cambios_ot_json: '{}', vaciar_ot_json: '["ddi"]' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Del. Izq.');
    expect(alta()).toBeUndefined();
  });

  test('la misma posición para vaciar y con una cubierta → 400 y la OT no se crea', async () => {
    baseCon([['INSERT INTO ots', [{ id: 703 }]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await crear({ cambios_ot_json: '{"ra":13220}', vaciar_ot_json: '["ra"]' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Auxilio');
    expect(alta()).toBeUndefined();
  });
});

describe('POST /ajax/actualizar_ot — posiciones que la OT deja vacías', () => {
  callarErrores();
  const OT = { id: 592, estado: 0, anulada: false, unidad_id: 399 };
  const guardar = (extra = {}) => request(app)
    .post('/ajax/actualizar_ot')
    .set('Cookie', `token=${makeToken()}`)
    .type('form')
    .send({ ot_id: 592, fecha: '13/10/2026', unidad_id: 399, gomeria_id: 1, cambio: '1', ...extra });
  // Lo que quedó guardado en ots.posiciones_vaciar: el único valor del UPDATE que es una lista.
  const guardadas = () => {
    const update = consultaCon('UPDATE ots SET');
    expect(update.texto).toContain('posiciones_vaciar = ?');
    return update.valores.find(Array.isArray);
  };

  test('guarda las que manda la pantalla', async () => {
    baseCon([['SELECT * FROM ots', [OT]]]);
    const res = await guardar({ cambios_ot_json: '{}', vaciar_ot_json: '["ra"]' });
    expect(res.status).toBe(200);
    expect(guardadas()).toEqual(['ra']);
  });

  test('[] las borra: en pantalla se deshizo la marca', async () => {
    baseCon([['SELECT * FROM ots', [{ ...OT, posiciones_vaciar: ['ra'] }]]]);
    await guardar({ cambios_ot_json: '{}', vaciar_ot_json: '[]' });
    expect(guardadas()).toEqual([]);
  });

  describe('si el formulario no las manda', () => {
    const CON_MARCAS = { ...OT, posiciones_vaciar: ['ra', 'ra2'] };

    test('conserva las guardadas', async () => {
      baseCon([['SELECT * FROM ots', [CON_MARCAS]]]);
      await guardar();
      expect(guardadas()).toEqual(['ra', 'ra2']);
    });

    test('pero si la OT cambió de unidad las descarta: eran los auxilios de la otra', async () => {
      baseCon([['SELECT * FROM ots', [CON_MARCAS]]]);
      await guardar({ unidad_id: 140 });
      expect(guardadas()).toEqual([]);
    });

    test('y descarta la de una posición que en este guardado recibe una cubierta', async () => {
      baseCon([['SELECT * FROM ots', [CON_MARCAS]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
      const res = await guardar({ cambios_ot_json: '{"ra":13220}' });
      expect(res.status).toBe(200);
      expect(guardadas()).toEqual(['ra2']);
    });
  });

  test('una rueda de rodado → 400 y no escribe nada', async () => {
    baseCon([['SELECT * FROM ots', [OT]]]);
    const res = await guardar({ cambios_ot_json: '{}', vaciar_ot_json: '["tie"]' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Tras. Izq. Ext.');
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('la misma posición para vaciar y con una cubierta → 400 y no escribe nada', async () => {
    baseCon([['SELECT * FROM ots', [OT]], [CUBIERTAS_ELEGIDAS, LIBRES]]);
    const res = await guardar({ cambios_ot_json: '{"ra":13220}', vaciar_ot_json: '["ra"]' });
    expect(res.status).toBe(400);
    expect(consultas().some(esEscritura)).toBe(false);
  });
});

describe('POST /ajax/confirmar_cerrar_ot — un auxilio que queda vacío', () => {
  callarErrores();
  const OT = {
    id: 610, estado: 0, anulada: false, unidad_id: 399, fecha: '2026-10-13',
    preventivo: false, rotacion: false, arreglo: false, cambio: true,
    alinear: false, balanceo: false, armar: false, posiciones_vaciar: ['ra'],
  };
  const AUXILIO = { id: 7, fuego: 'A007', posicion: 'ra' };
  const DELANTERA = { id: 8, fuego: 'B002', posicion: 'ddi' };

  const escenario = ({ ot = OT, filas = [], montadas = [AUXILIO, DELANTERA], reglas = [] } = {}) => baseCon([
    ...reglas,
    ['SELECT * FROM ots', [ot]], [FILAS_DE_LA_OT, filas], [MONTADAS, montadas],
    ['UPDATE ots SET', [{ id: ot.id }]],
  ]);
  const cerrar = (token = makeToken(1, 'ot_ver,ot_cerrar'), extra = { cambio: '1', destino_almacen_id: '2' }) => request(app)
    .post('/ajax/confirmar_cerrar_ot')
    .set('Cookie', `token=${token}`)
    .type('form')
    .send({ ot_id: 610, km_actual: 5100, ...extra });
  const escrituras = () => enTransaccion().map(p => p.texto.split(' ').slice(0, 2).join(' ') + (p.texto.startsWith('INSERT INTO cubierta_eventos') ? ':' + p.valores[1] : ''));
  const salida = () => enTransaccion().find(p => p.texto.startsWith('UPDATE cubiertas SET micro_id = NULL'));

  test('sale el auxilio al destino elegido y no entra ninguna cubierta', async () => {
    escenario();
    const res = await cerrar();
    expect(res.text).toBe('ok');
    expect(escrituras()).toEqual(['UPDATE ots', 'UPDATE micro', 'UPDATE cubiertas', 'INSERT INTO:retiro']);
    expect(salida().valores).toEqual([2, [7], 399]);
  });

  test('la OT guarda que el auxilio estaba y ya no está', async () => {
    escenario();
    await cerrar();
    const update = consultaCon('UPDATE ots SET estado = 1');
    const esquema = JSON.parse(update.valores.find(v => typeof v === 'string' && v.startsWith('{"antes"')));
    expect(esquema.antes.ra).toEqual({ id: 7, fuego: 'A007' });
    expect(esquema.despues).toEqual({ ddi: { id: 8, fuego: 'B002' } });
  });

  test('el log dice qué auxilio salió', async () => {
    escenario();
    await cerrar();
    const cambios = JSON.parse(consultaCon('INSERT INTO auditoria').valores[6]);
    expect(cambios).toContainEqual({ campo: 'cubiertas', antes: 'Auxilio: A007', despues: null });
  });

  test('sin destino elegido (preventivo que cierra el gomero) va a "A VERIFICAR"', async () => {
    const preventivo = { ...OT, cambio: false, preventivo: true };
    escenario({ ot: preventivo, reglas: [[A_VERIFICAR, [{ id: 19, activo: 1 }]]] });
    const res = await cerrar(makeToken(0, 'ot_ver,ot_cerrar_preventivo'), { descripcion_cierre: 'Se retiró el auxilio' });
    expect(res.text).toBe('ok');
    expect(salida().valores).toEqual([19, [7], 399]);
  });

  test('si el auxilio ya no está montado, la OT se cierra igual y no mueve nada', async () => {
    escenario({ montadas: [DELANTERA] });
    const res = await cerrar();
    expect(res.text).toBe('ok');
    expect(escrituras()).toEqual(['UPDATE ots', 'UPDATE micro']);
  });

  test('si además tiene una cubierta cargada en ese lugar → 400 y no se escribe nada', async () => {
    escenario({ filas: [fila(50, 'ra', 'NUEVA')] });
    const res = await cerrar();
    expect(res.status).toBe(400);
    expect(res.text).toContain('Auxilio');
    expect(consultas().some(esEscritura)).toBe(false);
  });

  test('una OT sin posiciones a vaciar (o anterior a que existieran) cierra como siempre', async () => {
    escenario({ ot: { ...OT, posiciones_vaciar: undefined } });
    const res = await cerrar();
    expect(res.text).toBe('ok');
    expect(escrituras()).toEqual(['UPDATE ots', 'UPDATE micro']);
  });
});

describe('POST /ajax/mb_cerrar_ot — vista previa de un auxilio que queda vacío', () => {
  const OT = {
    id: 610, estado: 0, anulada: false, unidad_id: 399, unidad: 'PRUEBA 01', tipo_unidad: 4,
    km_actual: 5000, cambio: true, posiciones_vaciar: ['ra'],
  };
  const MONTADO = [{ id: 7, fuego: 'A007', posicion: 'ra' }, { id: 8, fuego: 'B002', posicion: 'ddi' }];
  const abrir = () => request(app)
    .post('/ajax/mb_cerrar_ot')
    .set('Cookie', `token=${makeToken(1, 'ot_ver,ot_cerrar')}`)
    .type('form')
    .send({ ot_id: 610 });

  test('muestra la que sale y que el lugar queda vacío, y ofrece cerrar', async () => {
    baseCon([['FROM ots o', [OT]], [MONTADAS, MONTADO]]);
    const res = await abrir();
    expect(res.status).toBe(200);
    // La rueda del auxilio: arriba la que sale, abajo "VACÍA" en vez de una entrante
    expect(res.text).toMatch(/>A007<\/span><span[^>]*>VACÍA<\/span>/);
    expect(res.text).toContain('Queda vacía');
    expect(res.text).toContain('value="Cerrar OT"');
  });

  test('sin posiciones a vaciar no aparece esa leyenda', async () => {
    baseCon([['FROM ots o', [{ ...OT, posiciones_vaciar: [] }]], [MONTADAS, MONTADO]]);
    const res = await abrir();
    expect(res.text).not.toContain('Queda vacía');
    expect(res.text).not.toContain('VACÍA');
  });

  test('si el auxilio ya no está montado no dibuja ningún cambio', async () => {
    baseCon([['FROM ots o', [OT]], [MONTADAS, [MONTADO[1]]]]);
    const res = await abrir();
    expect(res.text).not.toContain('VACÍA');
    expect(res.text).toContain('value="Cerrar OT"');
  });

  test('con una cubierta cargada en ese mismo lugar explica por qué no se puede cerrar', async () => {
    baseCon([['FROM ots o', [OT]], [FILAS_DE_LA_OT, [fila(50, 'ra', 'NUEVA')]], [MONTADAS, MONTADO]]);
    const res = await abrir();
    expect(res.text).toContain('todavía no se puede cerrar');
    expect(res.text).not.toContain('value="Cerrar OT"');
  });
});

describe('GET /OTs/ver — una OT abierta que va a dejar un auxilio vacío', () => {
  const ABIERTA = {
    id: 610, numero: '610', estado: 0, anulada: false, fecha: '2026-10-13',
    unidad_id: 399, unidad: 'PRUEBA 01', tipo_unidad: 4, cambio: true, posiciones_vaciar: ['ra'],
  };
  const DE_HOY = 'FROM cubiertas c WHERE c.micro_id';
  const ver = () => request(app).get('/OTs/ver?ot=610').set('Cookie', `token=${makeToken()}`);
  const porVaciar = (html) => JSON.parse(html.match(/var POR_VACIAR\s+= (.*);/)[1]);

  test('lo avisa en la tabla, con la cubierta que va a salir', async () => {
    baseCon([['FROM ots o', [ABIERTA]], [DE_HOY, [{ id: 7, fuego: 'A007', posicion: 'ra' }]]]);
    const res = await ver();
    expect(res.status).toBe(200);
    expect(porVaciar(res.text)).toEqual(['ra']);
    expect(res.text).toMatch(/Auxilio<\/td>\s*<td[^>]*>queda vacía al cerrar la OT<\/td>\s*<td[^>]*>A007</);
    expect(res.text).not.toContain('Sin cubiertas registradas');
  });

  test('una vez cerrada ya no se lee la marca: manda lo que la OT guardó', async () => {
    const guardado = { antes: { ra: { id: 7, fuego: 'A007' } }, despues: {} };
    baseCon([['FROM ots o', [{ ...ABIERTA, estado: 1, esquema_cierre: guardado }]]]);
    const res = await ver();
    expect(porVaciar(res.text)).toEqual([]);
    expect(res.text).toMatch(/Auxilio<\/td>\s*<td[^>]*>queda vacía<\/td>\s*<td[^>]*>A007</);
    expect(res.text).not.toContain('al cerrar la OT</td>');
  });
});
