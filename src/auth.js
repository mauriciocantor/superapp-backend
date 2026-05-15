const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Base de datos simulada — en producción será PostgreSQL
const users = [
  {
    id: 'usr_001',
    name: 'Mauricio Cantor',
    email: 'mauricio@superapp.com',
    // contraseña: 1234
    password: '$2b$10$mOdp3W5RWrCYthCdohtuzO7DCSI1Y19zSAV5RYm9WAzdlvrXt2BzS',
    avatar_url: 'https://i.pravatar.cc/150?img=8',
    role: 'admin',
  },
  {
    id: 'usr_002',
    name: 'Ana García',
    email: 'ana@superapp.com',
    // contraseña: 1234
    password: '$2b$10$mOdp3W5RWrCYthCdohtuzO7DCSI1Y19zSAV5RYm9WAzdlvrXt2BzS',
    avatar_url: 'https://i.pravatar.cc/150?img=5',
    role: 'user',
  },
];

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Buscar usuario
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Verificar contraseña
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar_url: user.avatar_url,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /auth/me — verifica el token y devuelve el usuario
router.get('/me', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = users.find(u => u.id === decoded.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
      role: user.role,
    });
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

module.exports = router;