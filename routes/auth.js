const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Máximo 10 intentos de login por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Demasiados intentos de acceso. Intentá de nuevo en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /manual
router.get('/manual', requireAuth, (req, res) => {
  res.render('manual', { user: req.user, currentPage: 'manual' });
});

// GET /
router.get('/', requireAuth, async (req, res) => {
  res.render('index', { user: req.user });
});

// GET /login
router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// POST /login
router.post('/login', loginLimiter, async (req, res) => {
  const { usr, pass } = req.body;
  try {
    const rows = await sql`
      SELECT * FROM usuarios WHERE usuario = ${usr} AND activo = 1
    `;
    if (!rows.length) {
      return res.render('login', { error: 'Usuario o contraseña incorrectos' });
    }
    const user = rows[0];
    const valid = await bcrypt.compare(pass, user.password);
    if (!valid) {
      return res.render('login', { error: 'Usuario o contraseña incorrectos' });
    }
    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, tipo: user.tipo, nombre: user.nombre, gomeria_id: user.gomeria_id || null },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'Strict' : 'Lax',
      maxAge: 2 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.render('login', { error: 'Error del servidor' });
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

module.exports = router;
