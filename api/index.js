require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Error interno del servidor');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MasterBus corriendo en http://localhost:${PORT}`));

module.exports = app;
