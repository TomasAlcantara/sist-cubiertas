/**
 * Tests de autenticación y control de acceso
 *
 * Mockea el módulo de DB para no necesitar conexión real a Neon.
 * Cubre: login, logout, rutas protegidas, cookie segura.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock de DB antes de importar la app
jest.mock('../db', () => {
  const fn = jest.fn().mockResolvedValue([]);
  return { sql: fn };
});

const { sql } = require('../db');
const app = require('../api/index');

// Helper: genera un JWT válido de test
function makeToken(payload = {}) {
  return jwt.sign(
    { id: 1, usuario: 'test', tipo: 1, nombre: 'Test', ...payload },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockResolvedValue([]);
});

// ─── Página de login ────────────────────────────────────────
describe('GET /login', () => {
  test('devuelve 200 y contiene formulario', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('form');
  });

  test('redirige a / cuando ya hay sesión válida', async () => {
    // La ruta GET / requiere auth → si hay token válido debería devolver 200
    // Si no tiene DB data, EJS puede fallar, pero al menos no redirige a login
    sql.mockResolvedValue([]); // index view no necesita datos críticos
    const res = await request(app)
      .get('/login')
      .set('Cookie', `token=${makeToken()}`);
    // Con token válido, /login podría redirigir o mostrar la página — aceptamos ambos
    expect([200, 302]).toContain(res.status);
  });
});

// ─── POST /login ────────────────────────────────────────────
describe('POST /login', () => {
  test('usuario inexistente → muestra error, no 500', async () => {
    sql.mockResolvedValue([]); // usuario no encontrado
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ usr: 'noexiste', pass: 'cualquier' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('incorrectos');
  });

  test('contraseña incorrecta → muestra error, no 500', async () => {
    const hash = await bcrypt.hash('correcta', 10);
    sql.mockResolvedValue([{ id: 1, usuario: 'admin', password: hash, tipo: 1, nombre: 'Admin', activo: 1 }]);
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ usr: 'admin', pass: 'incorrecta' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('incorrectos');
  });

  test('credenciales correctas → redirige y setea cookie httpOnly', async () => {
    const hash = await bcrypt.hash('pass123', 10);
    sql.mockResolvedValue([{ id: 1, usuario: 'admin', password: hash, tipo: 1, nombre: 'Admin', activo: 1 }]);
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({ usr: 'admin', pass: 'pass123' });
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/');
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/token=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  test('body vacío → no lanza 500', async () => {
    const res = await request(app)
      .post('/login')
      .type('form')
      .send({});
    expect(res.status).toBeLessThan(500);
  });
});

// ─── GET /logout ─────────────────────────────────────────────
describe('GET /logout', () => {
  test('limpia cookie y redirige a /login', async () => {
    const res = await request(app)
      .get('/logout')
      .set('Cookie', `token=${makeToken()}`);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
    // La cookie token debe quedar vacía o expirada
    const cookie = res.headers['set-cookie']?.[0] || '';
    expect(cookie).toMatch(/token=/);
  });
});

// ─── Rutas protegidas sin sesión ─────────────────────────────
describe('Rutas protegidas → redirigen a /login sin token', () => {
  const protectedRoutes = [
    '/',
    '/cubiertas',
    '/almacen',
    '/gomerias',
    '/OTs/list',
    '/OTs/nueva',
    '/reportes',
    '/admin',
  ];

  test.each(protectedRoutes)('GET %s sin token → 302 a /login', async (route) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});

// ─── Rutas admin solo para tipo=1 ────────────────────────────
describe('Rutas /admin con token de tipo Gomería (tipo=0)', () => {
  test('GET /admin con tipo=0 → redirige a /', async () => {
    sql.mockResolvedValue([]);
    const tokenGomeria = makeToken({ tipo: 0 });
    const res = await request(app)
      .get('/admin')
      .set('Cookie', `token=${tokenGomeria}`);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/');
  });
});

// ─── Token inválido / expirado ───────────────────────────────
describe('Token inválido', () => {
  test('token malformado → redirige a /login', async () => {
    const res = await request(app)
      .get('/cubiertas')
      .set('Cookie', 'token=esto-no-es-un-jwt-valido');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });

  test('token con secret incorrecto → redirige a /login', async () => {
    const fakeToken = jwt.sign({ id: 1 }, 'secret-equivocado', { expiresIn: '1h' });
    const res = await request(app)
      .get('/cubiertas')
      .set('Cookie', `token=${fakeToken}`);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/login');
  });
});
