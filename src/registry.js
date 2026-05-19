const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Base de datos simulada de mini-apps
// En producción esto viene de PostgreSQL
const miniApps = [
  {
    id: 'com.superapp.delivery',
    name: 'Delivery',
    description: 'Pide comida',
    icon_url: '',
    color: 0xFF5722,
    enabled: true,
    permissions: ['location'],
    bundle_url: '',
    version: '1.0.0',
    category: 'food',
  },
  {
    id: 'com.superapp.pagos',
    name: 'Pagos',
    description: 'Sin comisión',
    icon_url: '',
    color: 0x4CAF50,
    enabled: true,
    permissions: ['payments'],
    bundle_url: '',
    version: '1.0.0',
    category: 'finance',
  },
  {
    id: 'com.superapp.tienda',
    name: 'Tienda',
    description: 'Catálogo',
    icon_url: '',
    color: 0x2196F3,
    enabled: true,
    permissions: [],
    bundle_url: '',
    version: '1.0.0',
    category: 'shopping',
  },
  {
    id: 'com.superapp.salud',
    name: 'Salud',
    description: 'Citas médicas',
    icon_url: '',
    color: 0xE91E63,
    enabled: true,
    permissions: [],
    bundle_url: '',
    version: '1.0.0',
    category: 'health',
  },
  {
    id: 'com.superapp.wallet',
    name: 'Wallet',
    description: 'Tu saldo',
    icon_url: '',
    color: 0x9C27B0,
    enabled: true,
    permissions: ['payments'],
    bundle_url: '',
    version: '1.0.0',
    category: 'finance',
  },
  {
    id: 'com.superapp.viajes',
    name: 'Viajes',
    description: 'Pide un carro',
    icon_url: '',
    color: 0x009688,
    enabled: true,
    permissions: ['location'],
    bundle_url: '',
    version: '1.0.0',
    category: 'transport',
  },
  {
    id: 'com.superapp.delivery.real',
    name: 'Delivery Real',
    description: 'Pide comida a domicilio',
    icon_url: '',
    color: 0x009688,
    enabled: true,
    permissions: ['location', 'payments'],
    bundle_url: 'http://192.168.20.163:3000/miniapps/miniapp-delivery/index.html',
    version: '1.0.0',
    category: 'food',
  }
];

// Middleware para verificar token
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// GET /registry — devuelve todas las mini-apps activas
router.get('/', authMiddleware, (req, res) => {
  const apps = miniApps.filter(app => app.enabled);
  res.json({ apps, total: apps.length });
});

// GET /registry/:id — detalle de una mini-app
router.get('/:id', authMiddleware, (req, res) => {
  const app = miniApps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'Mini-app no encontrada' });
  res.json(app);
});

// POST /registry — agregar nueva mini-app (solo admin)
router.post('/', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  const newApp = { ...req.body, enabled: true };
  miniApps.push(newApp);
  res.status(201).json(newApp);
});

// PUT /registry/:id/toggle — activar o desactivar
router.put('/:id/toggle', authMiddleware, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  const app = miniApps.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'Mini-app no encontrada' });
  app.enabled = !app.enabled;
  res.json({ id: app.id, enabled: app.enabled });
});

module.exports = router;