// Log de auditoría: quién hizo qué, cuándo, y qué cambió.
//
// Dos reglas que no se negocian:
//  1. Registrar nunca puede romper la operación que se está auditando. Si el
//     INSERT falla, se loguea por consola y la operación sigue.
//  2. Nunca guardar secretos. Los campos sensibles se enmascaran siempre, sin
//     depender de que cada llamador se acuerde de filtrarlos.

const { sql } = require('../db');

// Nombres que jamás se guardan con su valor real, mirados en minúscula.
const SENSIBLES = ['password', 'pass', 'contrasena', 'contraseña', 'token', 'secret', 'hash',
                   'gmail_app_password', 'gmail_user', 'valor_mail'];

const esSensible = (campo) => {
  const c = String(campo).toLowerCase();
  return SENSIBLES.some(s => c.includes(s));
};

const ACCIONES = {
  crear: 'Creó', editar: 'Editó', cerrar: 'Cerró', anular: 'Anuló',
  restaurar: 'Restauró', mover: 'Movió', colocar: 'Colocó', almacenar: 'Almacenó',
  baja: 'Dio de baja', alta: 'Dio de alta', login: 'Ingresó',
  login_fallido: 'Intento de acceso fallido',
};

const ENTIDADES = {
  ot: 'OT', cubierta: 'Cubierta', usuario: 'Usuario', config: 'Configuración',
  micro: 'Unidad', km: 'Kilometraje', gomeria: 'Gomería', almacen: 'Almacén',
  recapadora: 'Recapadora', medida: 'Medida', modelo: 'Modelo', proveedor: 'Proveedor',
  sesion: 'Sesión',
};

/** Normaliza a algo comparable y legible: null, número o string recortado. */
function normalizar(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'SI' : 'NO';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return v;
  const s = String(v);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

/**
 * Compara dos objetos y devuelve solo los campos que cambiaron.
 * `campos` acota qué mirar; sin él compara las claves de `despues`.
 */
function diff(antes, despues, campos) {
  const claves = campos || Object.keys(despues || {});
  const out = [];
  for (const campo of claves) {
    const a = normalizar(antes ? antes[campo] : null);
    const d = normalizar(despues ? despues[campo] : null);
    if (String(a) === String(d)) continue;
    out.push(esSensible(campo)
      ? { campo, antes: a === null ? null : '***', despues: d === null ? null : '***' }
      : { campo, antes: a, despues: d });
  }
  return out;
}

/** Snapshot legible de un objeto, para dejar copia de algo que se anula. */
function snapshot(obj, campos) {
  if (!obj) return null;
  const claves = campos || Object.keys(obj);
  const out = {};
  for (const c of claves) {
    if (obj[c] === undefined) continue;
    out[c] = esSensible(c) ? '***' : normalizar(obj[c]);
  }
  return out;
}

/**
 * Registra un movimiento. No lanza nunca.
 *
 * @param {object} req      para sacar usuario e IP (puede omitirse en scripts)
 * @param {object} usuario  atribución explícita, para casos donde `req.user`
 *                          todavía no existe (un login, exitoso o fallido)
 */
async function registrar({ req, usuario, accion, entidad, entidad_id, descripcion, cambios }) {
  try {
    if (!accion || !entidad) return;

    const user = usuario || (req && req.user) || null;

    // La IP real viene en x-forwarded-for detrás del proxy de Vercel.
    // `req.headers` es un getter del prototipo de IncomingMessage, así que no
    // sobrevive a un spread: hay que leerlo del req de verdad, con guarda.
    let ip = null;
    try {
      const raw = (req && req.headers && req.headers['x-forwarded-for']) || (req && req.ip) || '';
      ip = String(raw).split(',')[0].trim().slice(0, 45) || null;
    } catch (_) { ip = null; }

    const lista = Array.isArray(cambios) ? cambios.filter(Boolean) : (cambios || null);
    const payload = lista && (Array.isArray(lista) ? lista.length : true) ? JSON.stringify(lista) : null;

    await sql`
      INSERT INTO auditoria (usuario_id, usuario, accion, entidad, entidad_id, descripcion, cambios, ip)
      VALUES (
        ${user && user.id ? parseInt(user.id) : null},
        ${user && user.usuario ? String(user.usuario).slice(0, 50) : null},
        ${String(accion).slice(0, 40)},
        ${String(entidad).slice(0, 30)},
        ${entidad_id ? parseInt(entidad_id) || null : null},
        ${descripcion ? String(descripcion).slice(0, 1000) : null},
        ${payload},
        ${ip}
      )`;
  } catch (e) {
    // El log es un observador: si falla, se queja pero no tumba la operación.
    console.error(`[auditoria] ${accion}/${entidad}: ${e.message}`);
  }
}

const etiquetaAccion = (a) => ACCIONES[a] || a;
const etiquetaEntidad = (e) => ENTIDADES[e] || e;

module.exports = { registrar, diff, snapshot, etiquetaAccion, etiquetaEntidad, ACCIONES, ENTIDADES };
