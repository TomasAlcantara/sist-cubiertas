/**
 * Lógica de pantalla de "Editar OT" y "Cargar": qué queda asignado en cada
 * posición después de cada clic y qué se manda al guardar.
 *
 * El proyecto no tiene un navegador para tests, así que la vista se renderiza de
 * verdad (ruta + EJS) y su <script> se corre contra un documento de mentira que
 * guarda, por id, lo mínimo que esas funciones tocan: texto, clases y valor.
 * No prueba el dibujo sino el estado, que es donde estaba el problema: "Editar"
 * dejaba cambiar la unidad arrastrando las cubiertas elegidas para la anterior,
 * y ni ahí ni en "Cargar" había forma de quitar una asignación.
 */
const vm = require('vm');
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../db', () => ({ sql: jest.fn() }));

const { sql } = require('../db');
const app = require('../api/index');

const token = jwt.sign({ id: 1, usuario: 'test', tipo: 1, nombre: 'Test' },
  process.env.JWT_SECRET, { expiresIn: '1h' });

const OT = {
  id: 592, numero: '592', estado: 0, anulada: false, fecha: '2026-10-07',
  unidad_id: 399, unidad: '5074', tipo_unidad: 3, gomeria_id: 1, cambio: true,
};
// Lo que la OT ya tiene cargado…
const FILAS = [
  { posicion: 'ddi', cubierta_id: 13220, fuego: '14291' },
  { posicion: 'ddd', cubierta_id: 13219, fuego: '14290' },
];
// …y lo que hay montado en cada unidad (solo la delantera izquierda).
const MONTADAS = {
  399: [{ id: 1, fuego: 'MONTADA-399', posicion: 'ddi' }],
  140: [{ id: 2, fuego: 'MONTADA-140', posicion: 'ddi' }],
};

beforeEach(() => {
  sql.mockReset();
  sql.mockImplementation((q) => {
    const texto = Array.isArray(q) ? q.join(' ') : String(q);
    if (/FROM ots/i.test(texto)) return Promise.resolve([OT]);
    if (/FROM ot_cubiertas/i.test(texto)) return Promise.resolve(FILAS);
    if (/FROM cubiertas c WHERE c\.micro_id/i.test(texto)) return Promise.resolve(MONTADAS[399]);
    return Promise.resolve([]);
  });
});

/**
 * Corre el script de la vista y devuelve con qué mirarla y manejarla.
 * `$.ajax` no sale a ningún lado: se anota el pedido y, si es el de las
 * cubiertas montadas en una unidad, se contesta en el momento con MONTADAS.
 */
function abrirPagina(html) {
  const elementos = {};
  const crear = (id) => {
    const el = { id, value: '', checked: false, style: {}, clases: new Set(), html: '' };
    el.classList = { add: (c) => el.clases.add(c), remove: (c) => el.clases.delete(c), contains: (c) => el.clases.has(c) };
    Object.defineProperty(el, 'innerHTML', {
      get: () => el.html,
      set: (valor) => {
        el.html = valor;
        // Como en el navegador: redibujar el diagrama descarta las ruedas que había.
        if (id === 'diagrama-wrap') {
          Object.keys(elementos).filter(k => /^(pos|fn)-/.test(k)).forEach(k => delete elementos[k]);
        }
      },
    });
    return el;
  };
  const porId = (id) => elementos[id] || (elementos[id] = crear(id));
  porId('unidad_id').value = String(OT.unidad_id);
  porId('fecha').value = '07/10/2026';

  const pedidos = [];
  const $ = (arg) => (typeof arg === 'function' ? arg() : { datepicker() {} });
  $.ajax = (opciones) => {
    pedidos.push(opciones);
    const unidad = (opciones.url.match(/cubiertas_unidad\?unidad_id=(\d+)/) || [])[1];
    if (unidad) opciones.success({ tipo_unidad: 3, cubiertas: MONTADAS[unidad] || [] });
  };
  const avisos = [];
  const pagina = vm.createContext({
    document: { getElementById: porId, addEventListener() {}, querySelector: () => null },
    $, alert: (mensaje) => avisos.push(mensaje), location: {},
  });

  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes('var cambios_ot'));
  vm.runInContext(script, pagina);

  const guardado = () => pedidos.filter(p => p.type === 'POST' && /actualizar_ot/.test(p.url)).pop();
  return {
    pagina, avisos,
    // Lo asignado: posición → id de cubierta. Pasa por JSON porque nace en otro contexto.
    asignadas: () => JSON.parse(JSON.stringify(pagina.cambios_ot)),
    texto: (id) => (elementos[id] ? elementos[id].innerHTML : undefined),
    marcada: (id, clase) => !!elementos[id] && elementos[id].clases.has(clase),
    abierto: (id) => !!elementos[id] && elementos[id].style.display === 'block',
    elegirUnidad: (unidad) => { porId('unidad_id').value = unidad; pagina.cargar_tires(unidad); },
    guardado,
    cubiertasEnviadas: () => JSON.parse(guardado().data.cambios_ot_json),
  };
}

const traer = async (url) => {
  const res = await request(app).get(url).set('Cookie', `token=${token}`);
  if (res.status !== 200) throw new Error(`${url} → ${res.status}: ${res.text.slice(0, 300)}`);
  return abrirPagina(res.text);
};

// ─── Editar OT ────────────────────────────────────────────────
describe('Editar OT — cubiertas asignadas', () => {
  const abrir = () => traer('/OTs/editar?ot=592');

  test('al abrir muestra las cubiertas que la OT ya tenía', async () => {
    const p = await abrir();
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
    expect(p.texto('fn-ddi')).toBe('14291');
    expect(p.marcada('pos-ddi', 'seleccionada')).toBe(true);
  });

  test('cambiar la unidad vacía las asignaciones', async () => {
    // OT 80: se armó para la unidad 153, se la pasó a la 267 y, como las
    // cubiertas elegidas seguían ahí, el cierre las montó en la 267.
    const p = await abrir();
    p.elegirUnidad('140');

    expect(p.asignadas()).toEqual({});
    expect(p.texto('fn-ddi')).toBe('MONTADA-140');
    expect(p.marcada('pos-ddi', 'seleccionada')).toBe(false);
    expect(p.marcada('pos-ddd', 'seleccionada')).toBe(false);
  });

  test('y lo que se guarda después no arrastra nada de la unidad anterior', async () => {
    const p = await abrir();
    p.elegirUnidad('140');
    p.pagina.guardar_ot();

    expect(p.guardado().data.unidad_id).toBe('140');
    expect(p.cubiertasEnviadas()).toEqual({});
  });

  test('volver a la unidad original no las resucita', async () => {
    const p = await abrir();
    p.elegirUnidad('140');
    p.elegirUnidad('399');

    expect(p.asignadas()).toEqual({});
    expect(p.texto('fn-ddi')).toBe('MONTADA-399');
    expect(p.marcada('pos-ddi', 'seleccionada')).toBe(false);
  });

  test('mientras llega la respuesta de la otra unidad no queda a la vista el diagrama anterior', async () => {
    // La prueba en un navegador real lo mostró: las asignaciones ya estaban
    // vacías, pero el dibujo de la unidad anterior seguía en pantalla, marcado.
    const p = await abrir();
    p.pagina.$.ajax = () => {};                // el servidor todavía no contestó
    p.elegirUnidad('140');

    expect(p.asignadas()).toEqual({});
    expect(p.texto('diagrama-wrap')).toContain('Cargando');
    expect(p.texto('fn-ddi')).toBeUndefined();
  });

  test('si el diagrama de la otra unidad no se puede cargar, lo dice', async () => {
    const p = await abrir();
    p.pagina.$.ajax = (opciones) => opciones.error({ status: 0 });
    p.elegirUnidad('140');

    expect(p.asignadas()).toEqual({});
    expect(p.texto('diagrama-wrap')).toContain('No se pudo cargar');
  });

  test('una respuesta que llega tarde, de una unidad que ya no es la elegida, se descarta', async () => {
    const p = await abrir();
    const pendientes = [];
    p.pagina.$.ajax = (opciones) => pendientes.push(opciones);
    p.elegirUnidad('140');
    p.elegirUnidad('399');
    // Contestan en orden inverso: primero la 399, después la 140 que quedó vieja
    pendientes[1].success({ tipo_unidad: 3, cubiertas: MONTADAS[399] });
    pendientes[0].success({ tipo_unidad: 3, cubiertas: MONTADAS[140] });

    expect(p.texto('fn-ddi')).toBe('MONTADA-399');
  });

  test('quedarse sin unidad también las vacía', async () => {
    const p = await abrir();
    p.elegirUnidad('');
    expect(p.asignadas()).toEqual({});
  });

  test('recargar la misma unidad no toca lo asignado', async () => {
    const p = await abrir();
    p.elegirUnidad('399');
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
    expect(p.texto('fn-ddi')).toBe('14291');
  });

  test('clic en una asignada la deshace y vuelve a mostrar la que está montada', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddi');

    expect(p.asignadas()).toEqual({ ddd: 13219 });
    expect(p.texto('fn-ddi')).toBe('MONTADA-399');
    expect(p.marcada('pos-ddi', 'seleccionada')).toBe(false);
    expect(p.abierto('filter_list')).toBe(false);
  });

  test('deshacer donde no hay nada montado deja la posición vacía', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddd');

    expect(p.asignadas()).toEqual({ ddi: 13220 });
    expect(p.texto('fn-ddd')).toBe('+');
    expect(p.marcada('fn-ddd', 'vacia')).toBe(true);
  });

  test('clic en una posición sin asignar abre el selector', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('tie');
    expect(p.abierto('filter_list')).toBe(true);
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
  });

  test('reemplazar pide dos clics y deja una sola cubierta en la posición', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddi');               // primero deshace
    p.pagina.abrir_modal('ddi');               // después abre el selector
    p.pagina.seleccionar_ot(777, '7777');

    expect(p.asignadas()).toEqual({ ddd: 13219, ddi: 777 });
    expect(p.texto('fn-ddi')).toBe('7777');
    expect(p.marcada('pos-ddi', 'seleccionada')).toBe(true);
  });

  test('no deja poner la misma cubierta en dos posiciones', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('tie');
    p.pagina.seleccionar_ot(13219, '14290');   // ya está en la delantera derecha

    expect(p.avisos).toHaveLength(1);
    expect(p.avisos[0]).toContain('Del. Der.');
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
  });

  test('guardar manda exactamente lo que quedó en pantalla', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddd');               // deshace la delantera derecha
    p.pagina.abrir_modal('tie');
    p.pagina.seleccionar_ot(555, '5555');
    p.pagina.guardar_ot();

    expect(p.cubiertasEnviadas()).toEqual({ ddi: 13220, tie: 555 });
  });
});

// ─── Cargar ───────────────────────────────────────────────────
describe('Cargar — cubiertas asignadas', () => {
  const abrir = () => traer('/OTs/cargar?ot=592');

  test('al abrir muestra como entrantes las cubiertas que la OT ya tenía', async () => {
    const p = await abrir();
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
    expect(p.texto('fn-in-ddi')).toBe('14291');
    expect(p.marcada('pos-ddi', 'con-entrante')).toBe(true);
  });

  test('clic en una asignada la deshace, sin abrir el selector', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddd');

    expect(p.asignadas()).toEqual({ ddi: 13220 });
    expect(p.texto('fn-in-ddd')).toBe('+');
    expect(p.marcada('pos-ddd', 'con-entrante')).toBe(false);
    expect(p.abierto('filter_list')).toBe(false);
  });

  test('clic en una posición sin asignar abre el selector', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('tie');
    expect(p.abierto('filter_list')).toBe(true);
  });

  test('reemplazar pide dos clics y deja una sola cubierta en la posición', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddi');
    p.pagina.abrir_modal('ddi');
    p.pagina.seleccionar_ot(777, '7777');

    expect(p.asignadas()).toEqual({ ddd: 13219, ddi: 777 });
    expect(p.texto('fn-in-ddi')).toBe('7777');
  });

  test('no deja poner la misma cubierta en dos posiciones', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('tie');
    p.pagina.seleccionar_ot(13219, '14290');

    expect(p.avisos).toHaveLength(1);
    expect(p.asignadas()).toEqual({ ddi: 13220, ddd: 13219 });
  });

  test('finalizar manda exactamente lo que quedó en pantalla', async () => {
    const p = await abrir();
    p.pagina.abrir_modal('ddd');
    p.pagina.finalizar();

    expect(p.guardado().data.ot_id).toBe(592);
    expect(p.cubiertasEnviadas()).toEqual({ ddi: 13220 });
  });

  test('si el guardado se rechaza, muestra el motivo que manda el servidor', async () => {
    const p = await abrir();
    p.pagina.finalizar();
    p.guardado().error({ status: 400, responseText: 'La cubierta 7074 figura montada en la unidad 153.' });
    expect(p.avisos).toEqual(['La cubierta 7074 figura montada en la unidad 153.']);
  });
});
