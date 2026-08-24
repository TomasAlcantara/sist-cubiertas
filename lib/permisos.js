/**
 * Catálogo de permisos del sistema — única fuente de verdad.
 *
 * Los permisos reemplazan al viejo corte por `usuarios.tipo` (0=Gomería,
 * 1=MasterBus), que se conserva solo como etiqueta. La autorización real pasa
 * por los slugs de acá.
 */

const PERMISOS = [
  {
    grupo: 'Órdenes de Trabajo',
    items: [
      ['ot_ver',               'Ver órdenes de trabajo'],
      ['ot_crear',             'Crear OT'],
      ['ot_editar',            'Editar / cargar cubiertas en OT abierta'],
      ['ot_cerrar_preventivo', 'Cerrar OT de solo Preventivo (con descripción)'],
      ['ot_cerrar',            'Cerrar cualquier OT'],
      ['ot_anular',            'Anular OT'],
    ],
  },
  {
    grupo: 'Cubiertas',
    items: [
      ['cubiertas_ver',    'Ver cubiertas'],
      ['cubiertas_crear',  'Crear cubiertas nuevas'],
      ['cubiertas_editar', 'Editar cubiertas'],
      ['cubiertas_mover',  'Mover cubiertas entre almacenes / colocar'],
    ],
  },
  {
    grupo: 'Otros',
    items: [
      ['km_cargar',         'Cargar kilómetros'],
      ['mantenimiento_ver', 'Ver mantenimiento / preventivos'],
      ['reportes_ver',      'Ver reportes'],
      ['almacen_ver',       'Ver almacenes'],
      ['gomerias_ver',      'Ver gomerías y recapadoras'],
      ['admin',             'Administración (usuarios, config, ABMs)'],
    ],
  },
];

// Todos los slugs, en orden de catálogo
const TODOS = PERMISOS.flatMap(g => g.items.map(([slug]) => slug));

const VALIDOS = new Set(TODOS);

const PRESETS = {
  admin: TODOS,
  gomero: [
    'ot_ver', 'ot_crear', 'ot_editar', 'ot_cerrar_preventivo',
    'cubiertas_ver', 'mantenimiento_ver', 'reportes_ver', 'almacen_ver',
  ],
  consulta: ['ot_ver', 'cubiertas_ver', 'mantenimiento_ver', 'reportes_ver'],
};

const ETIQUETAS = Object.fromEntries(
  PERMISOS.flatMap(g => g.items.map(([slug, label]) => [slug, label]))
);

/**
 * Descarta lo que no esté en el catálogo y deduplica, conservando el orden del
 * catálogo. Acepta array o CSV.
 */
function sanitizarPermisos(entrada) {
  const lista = Array.isArray(entrada)
    ? entrada
    : String(entrada == null ? '' : entrada).split(',');
  const pedidos = new Set(lista.map(p => String(p).trim()).filter(p => VALIDOS.has(p)));
  return TODOS.filter(p => pedidos.has(p));
}

/**
 * Permisos efectivos de un usuario (fila de `usuarios` o payload del JWT).
 *
 * Compatibilidad hacia atrás: los usuarios que ya existían no tienen la columna
 * `permisos` cargada, así que se deducen de `tipo`. Sin esto, al deployar
 * quedarían todos sin acceso.
 */
function permisosDe(user) {
  if (!user) return [];
  if (user.permisos != null && String(user.permisos).trim() !== '') {
    return sanitizarPermisos(user.permisos);
  }
  return parseInt(user.tipo) === 1 ? [...PRESETS.admin] : [...PRESETS.gomero];
}

/** ¿El usuario tiene alguno de estos permisos? */
function tienePermiso(user, ...slugs) {
  const míos = new Set(permisosDe(user));
  return slugs.flat().some(s => míos.has(s));
}

/**
 * ¿El usuario está atado a una gomería puntual? Reemplaza al viejo chequeo
 * `tipo === 0`: lo que restringe la vista no es la etiqueta del usuario sino
 * tener una gomería asignada sin ser administrador.
 */
function estaAtadoAGomeria(user) {
  if (!user || !user.gomeria_id) return false;
  return !tienePermiso(user, 'admin');
}

/** Nombre del preset que coincide exactamente con la lista, o null. */
function nombrePreset(permisos) {
  const lista = sanitizarPermisos(permisos);
  for (const [nombre, preset] of Object.entries(PRESETS)) {
    if (preset.length === lista.length && preset.every(p => lista.includes(p))) return nombre;
  }
  return null;
}

module.exports = {
  PERMISOS, PRESETS, TODOS, ETIQUETAS,
  sanitizarPermisos, permisosDe, tienePermiso, nombrePreset, estaAtadoAGomeria,
};

/**
 * Grilla de checkboxes de permisos para el ABM de usuarios, con botones de
 * preset. Se genera acá y no en la vista para que `nuevo.ejs` y `editar.ejs`
 * no se desincronicen cuando se agregue un permiso al catálogo.
 *
 * El HTML sale de datos estáticos de este módulo (nada viene del usuario),
 * así que no hay nada que escapar.
 */
function gridPermisosHtml(seleccionados) {
  const sel = new Set(sanitizarPermisos(seleccionados));

  const secciones = PERMISOS.map(g => `
    <div class="perm-grupo">
      <div class="perm-grupo-titulo">${g.grupo}</div>
      ${g.items.map(([slug, label]) => `
        <label class="perm-item">
          <input type="checkbox" class="perm-cb" value="${slug}" id="perm_${slug}" ${sel.has(slug) ? 'checked' : ''} />
          <span>${label}</span>
        </label>`).join('')}
    </div>`).join('');

  return `
<style>
.perm-box { border:1px solid var(--border-strong); border-radius:var(--radius); padding:14px; margin-top:6px; }
.perm-presets { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--border); }
.perm-presets button {
  background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border-strong);
  font-family:var(--font-mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase;
  padding:6px 12px; border-radius:var(--radius); cursor:pointer;
}
.perm-presets button:hover { background:var(--bg-hover); border-color:var(--red); }
.perm-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:16px; }
.perm-grupo-titulo {
  font-family:var(--font-mono); font-size:10px; letter-spacing:0.12em; text-transform:uppercase;
  color:var(--text-muted); margin-bottom:7px;
}
.perm-item { display:flex; align-items:flex-start; gap:7px; margin:5px 0; font-size:12.5px; line-height:1.4; cursor:pointer; }
.perm-item input { margin-top:2px; flex:0 0 auto; }
</style>
<div class="perm-box">
  <div class="perm-presets">
    <button type="button" onclick="aplicar_preset('gomero')">Preset Gomero</button>
    <button type="button" onclick="aplicar_preset('consulta')">Preset Consulta</button>
    <button type="button" onclick="aplicar_preset('admin')">Preset Admin</button>
    <button type="button" onclick="aplicar_preset(null)">Destildar todo</button>
  </div>
  <div class="perm-grid">${secciones}</div>
</div>
<script>
var PRESETS_PERM = ${JSON.stringify(PRESETS)};
function aplicar_preset(nombre) {
  var lista = nombre ? (PRESETS_PERM[nombre] || []) : [];
  document.querySelectorAll('.perm-cb').forEach(function(cb) {
    cb.checked = lista.indexOf(cb.value) !== -1;
  });
}
function permisos_marcados() {
  return Array.prototype.filter.call(document.querySelectorAll('.perm-cb'), function(cb) {
    return cb.checked;
  }).map(function(cb) { return cb.value; }).join(',');
}
</script>`;
}

module.exports.gridPermisosHtml = gridPermisosHtml;
