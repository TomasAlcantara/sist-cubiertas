require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],        // permite onclick= en toda la app (necesario por arquitectura actual)
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting global (protección básica ante flood)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiadas solicitudes, intentá de nuevo en 15 minutos.',
});
app.use(globalLimiter);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Helpers globales para escaping en templates EJS
// e(str)  → escapa HTML (para atributos y contenido HTML)
// ej(val) → JSON.stringify seguro (para embeber valores en contextos JS)
app.locals.e = (str) => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
app.locals.ej = (val) => JSON.stringify(val);

// Formato de fecha/hora argentino (el runtime de Vercel está en UTC)
const { fmtFecha, fmtFechaHora } = require('../lib/fechas');
app.locals.fmtFecha = fmtFecha;
app.locals.fmtFechaHora = fmtFechaHora;

/**
 * Paginador agrupado: primera, última y ±2 alrededor de la actual, con "…" en
 * los saltos. Con miles de cubiertas listar todas las hojas es ilegible.
 */
app.locals.paginacion = (pagina, totalPages, href) => {
  const total = parseInt(totalPages) || 0;
  if (total <= 1) return '';
  const actual = Math.min(Math.max(parseInt(pagina) || 1, 1), total);

  const mostrar = new Set([1, total]);
  for (let p = actual - 2; p <= actual + 2; p++) if (p >= 1 && p <= total) mostrar.add(p);

  const paginas = [...mostrar].sort((a, b) => a - b);
  let html = '<div class="list-pagination">';
  if (actual > 1) html += `<a href="${href(actual - 1)}" class="pg-nav">&laquo;</a>`;
  let previa = 0;
  for (const p of paginas) {
    if (previa && p - previa > 1) html += '<span class="pg-gap">…</span>';
    html += p === actual
      ? `<strong class="pg-current">${p}</strong>`
      : `<a href="${href(p)}">${p}</a>`;
    previa = p;
  }
  if (actual < total) html += `<a href="${href(actual + 1)}" class="pg-nav">&raquo;</a>`;
  return html + '</div>';
};

// `can(permiso)` para que las vistas escondan lo que el usuario no puede usar.
// Esconder el botón es cosmético: la autorización real vive en requirePerm().
const { tienePermiso, gridPermisosHtml, permisosDe, PRESETS } = require('../lib/permisos');
app.locals.gridPermisos = gridPermisosHtml;
app.locals.permisosDe = permisosDe;
app.locals.PRESETS_PERM = PRESETS;
app.locals.nombrePreset = require('../lib/permisos').nombrePreset;
app.use((req, res, next) => {
  res.locals.can = (...slugs) => tienePermiso(req.user, slugs);
  next();
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/health', require('../routes/health')); // chequeo publico para el dashboard de control
app.use('/', require('../routes/auth'));
app.use('/almacen', require('../routes/almacen'));
app.use('/gomerias', require('../routes/gomerias'));
app.use('/OTs', require('../routes/ots'));
app.use('/CargaKm', require('../routes/cargaKm'));
app.use('/cubiertas', require('../routes/cubiertas'));
app.use('/recapadoras', require('../routes/recapadoras'));
app.use('/reportes', require('../routes/reportes'));
app.use('/mantenimiento', require('../routes/mantenimiento'));
app.use('/presiones', require('../routes/presiones'));
app.use('/admin', require('../routes/admin'));
app.use('/ajax', require('../routes/ajax'));

// 404
app.use((req, res) => {
  res.status(404).send('Página no encontrada');
});

// Error handler global — no expone stack en producción
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (isProd) {
    console.error(`[ERROR] ${new Date().toISOString()} ${req.method} ${req.path} — ${err.message}`);
  } else {
    console.error(err.stack);
  }
  res.status(status).send(status === 500 ? 'Error interno del servidor' : err.message);
});

// Solo levanta el server cuando se ejecuta directamente (no en tests)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`MasterBus corriendo en http://localhost:${PORT}`));
}

module.exports = app;
