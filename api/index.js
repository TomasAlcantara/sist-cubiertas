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

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/', require('../routes/auth'));
app.use('/almacen', require('../routes/almacen'));
app.use('/gomerias', require('../routes/gomerias'));
app.use('/OTs', require('../routes/ots'));
app.use('/CargaKm', require('../routes/cargaKm'));
app.use('/cubiertas', require('../routes/cubiertas'));
app.use('/recapadoras', require('../routes/recapadoras'));
app.use('/reportes', require('../routes/reportes'));
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
