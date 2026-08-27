/**
 * Smoke de render de todas las pantallas.
 *
 * Compilar el EJS no alcanza: lo que rompe al sacar una feature es una vista que
 * sigue leyendo una variable que la ruta ya no le pasa. Acá cada pantalla se
 * renderiza entera contra una DB vacía, que es donde eso explota.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');

// Un COUNT/agregado siempre devuelve exactamente una fila, también contra una
// base vacía. Si el mock contesta [] a todo, las rutas que leen `filas[0].total`
// tiran 500 por el mock y no por la pantalla, que es lo que se quiere probar.
jest.mock('../db', () => ({ sql: jest.fn() }));

const { sql } = require('../db');
const app = require('../api/index');

const AGREGADO = { total: 0, en_unidad: 0, en_almacen: 0, en_gomeria: 0, sin_ubicar: 0 };

function baseVacia(q) {
  const texto = Array.isArray(q) ? q.join(' ') : String(q);
  return Promise.resolve(/COUNT\s*\(/i.test(texto) ? [AGREGADO] : []);
}

const token = jwt.sign({ id: 1, usuario: 'test', tipo: 1, nombre: 'Test' },
  process.env.JWT_SECRET, { expiresIn: '1h' });

const PAGINAS = [
  '/', '/cubiertas', '/cubiertas/nuevo',
  '/almacen', '/gomerias', '/recapadoras',
  '/OTs/list', '/OTs/nueva', '/CargaKm',
  '/reportes', '/reportes/recorrido', '/reportes/historial',
  '/reportes/estados', '/reportes/reporte_unidad', '/reportes/reporte_gomeria',
  '/reportes/cubierta_proveedor',
  '/admin', '/admin/medidas', '/admin/medidas/nuevo', '/admin/usuarios',
  '/admin/auditoria', '/admin/micros', '/manual',
];

beforeEach(() => { sql.mockReset(); sql.mockImplementation(baseVacia); });

describe('smoke de render', () => {
  test.each(PAGINAS)('%s renderiza', async (url) => {
    const res = await request(app).get(url).set('Cookie', `token=${token}`);
    if (res.status === 500) throw new Error(`${url} → 500: ${res.text.slice(0, 300)}`);
    expect([200, 302]).toContain(res.status);
  });
});

// Estas tres necesitan una OT existente: con la base vacía redirigen sin llegar
// a renderizar, que es justo donde viven el esquema de ruedas y las tablas de
// cubiertas que se tocaron.
describe('pantallas de una OT concreta', () => {
  const OT = {
    id: 7, numero: '7', estado: 0, anulada: false, fecha: '2026-08-20',
    unidad_id: 5, unidad: 'INT 5', tipo_unidad: 3, km_actual: 100000,
    gomeria_id: 1, pinchadura: false, rotura: true,
  };

  beforeEach(() => {
    sql.mockImplementation((q) => {
      const texto = Array.isArray(q) ? q.join(' ') : String(q);
      if (/FROM ots/i.test(texto)) return Promise.resolve([OT]);
      return baseVacia(q);
    });
  });

  test.each(['/OTs/ver?ot=7', '/OTs/cargar?ot=7', '/OTs/editar?ot=7'])('%s renderiza', async (url) => {
    const res = await request(app).get(url).set('Cookie', `token=${token}`);
    if (res.status === 500) throw new Error(`${url} → 500: ${res.text.slice(0, 300)}`);
    expect(res.status).toBe(200);
  });
});

describe('pantallas dadas de baja', () => {
  test.each(['/presiones', '/mantenimiento', '/admin/config'])('%s → 404', async (url) => {
    const res = await request(app).get(url).set('Cookie', `token=${token}`);
    expect(res.status).toBe(404);
  });
});

describe('endpoints dados de baja', () => {
  test('POST /ajax/nuevo_estado ya no existe', async () => {
    const res = await request(app).post('/ajax/nuevo_estado')
      .set('Cookie', `token=${token}`).type('form').send({ r_id: 1, estado: 2 });
    expect(res.status).toBe(404);
  });

  test('POST /ajax/save_config ya no existe', async () => {
    const res = await request(app).post('/ajax/save_config')
      .set('Cookie', `token=${token}`).type('form').send({ mm_min: 5 });
    expect(res.status).toBe(404);
  });

  test('POST /ajax/marcar_recapada asienta el recapado en el historial', async () => {
    sql.mockResolvedValue([{ id: 1, fuego: 'A1' }]);
    const res = await request(app).post('/ajax/marcar_recapada')
      .set('Cookie', `token=${token}`).type('form').send({ r_id: 1 });
    expect(res.status).toBe(200);
    const inserts = sql.mock.calls
      .map(c => (Array.isArray(c[0]) ? c[0].join(' ? ') : String(c[0])))
      .filter(q => q.includes('INSERT INTO cubierta_eventos'));
    expect(inserts.length).toBe(1);
  });
});
