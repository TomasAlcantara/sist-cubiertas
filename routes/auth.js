const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

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
router.post('/login', async (req, res) => {
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
      { id: user.id, usuario: user.usuario, tipo: user.tipo, nombre: user.nombre },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('token', token, { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 });
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
