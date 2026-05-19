const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const router = express.Router();

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

// GET /registry
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM mini_apps WHERE enabled = true ORDER BY created_at ASC'
    );
    res.json({ apps: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Registry error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /registry/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM mini_apps WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mini-app no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/admin/all', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    const result = await pool.query(
      'SELECT * FROM mini_apps ORDER BY created_at ASC'
    );
    res.json({ apps: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /registry
router.post('/', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    const {
      id, name, description, icon_url,
      color, permissions, bundle_url, version, category
    } = req.body;

    const result = await pool.query(
      `INSERT INTO mini_apps 
        (id, name, description, icon_url, color, permissions, bundle_url, version, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [id, name, description, icon_url || '',
       color || 7103231, permissions || [],
       bundle_url || '', version || '1.0.0', category || 'other']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create app error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /registry/:id/toggle
router.put('/:id/toggle', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    const result = await pool.query(
      `UPDATE mini_apps SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1 RETURNING id, enabled`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mini-app no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /registry/:id
router.put('/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    const { version, bundle_url, name, enabled, permissions } = req.body;

    // Desactivar versión anterior en el historial
    if (bundle_url) {
      await pool.query(
        'UPDATE mini_app_versions SET is_active = false WHERE app_id = $1',
        [req.params.id]
      );

      // Guardar nueva versión en historial
      await pool.query(
        `INSERT INTO mini_app_versions 
          (app_id, version, bundle_url, deployed_by, commit_sha, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          req.params.id,
          version || '1.0.0',
          bundle_url,
          req.user.email,
          version?.substring(0, 7) || 'manual',
          true,
        ]
      );
    }

    const result = await pool.query(
      `UPDATE mini_apps SET
        version    = COALESCE($1, version),
        bundle_url = COALESCE($2, bundle_url),
        name       = COALESCE($3, name),
        enabled    = COALESCE($4, enabled),
        permissions = COALESCE($5, permissions),
        updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [version, bundle_url, name, enabled, permissions, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mini-app no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /registry/:id/versions — historial de versiones
router.get('/:id/versions', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM mini_app_versions 
       WHERE app_id = $1 
       ORDER BY deployed_at DESC 
       LIMIT 10`,
      [req.params.id]
    );
    res.json({ versions: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /registry/:id/rollback/:versionId — revertir versión
router.post('/:id/rollback/:versionId', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  try {
    // Obtener la versión a restaurar
    const versionResult = await pool.query(
      'SELECT * FROM mini_app_versions WHERE id = $1 AND app_id = $2',
      [req.params.versionId, req.params.id]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Versión no encontrada' });
    }

    const oldVersion = versionResult.rows[0];

    // Desactivar todas las versiones
    await pool.query(
      'UPDATE mini_app_versions SET is_active = false WHERE app_id = $1',
      [req.params.id]
    );

    // Activar la versión seleccionada
    await pool.query(
      'UPDATE mini_app_versions SET is_active = true WHERE id = $1',
      [req.params.versionId]
    );

    // Actualizar la mini-app con la versión anterior
    const result = await pool.query(
      `UPDATE mini_apps SET 
        bundle_url = $1, version = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [oldVersion.bundle_url, oldVersion.version, req.params.id]
    );

    console.log(`[Rollback] ${req.params.id} → v${oldVersion.version}`);
    res.json({ success: true, app: result.rows[0], restored_version: oldVersion });
  } catch (err) {
    console.error('Rollback error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;