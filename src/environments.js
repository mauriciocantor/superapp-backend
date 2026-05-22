const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

// GET /environments/:appId — obtener todos los ambientes de una mini-app
router.get('/:appId', authMiddleware, async (req, res) => {
  try {
    const envs = await pool.query(
      `SELECT e.*, q.qr_token
       FROM mini_app_environments e
       LEFT JOIN mini_app_qr_codes q
         ON q.app_id = e.app_id AND q.environment = e.environment
       WHERE e.app_id = $1
       ORDER BY CASE e.environment
         WHEN 'development' THEN 1
         WHEN 'sandbox' THEN 2
         WHEN 'production' THEN 3
       END`,
      [req.params.appId]
    );

    // Si no existen, crearlos
    if (envs.rows.length === 0) {
      await _createDefaultEnvironments(req.params.appId);
      return res.json({ environments: await _getEnvironments(req.params.appId) });
    }

    res.json({ environments: envs.rows });
  } catch (err) {
    console.error('Environments error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /environments/:appId/deploy — disparar deploy a un ambiente
router.post('/:appId/deploy', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  const { environment, commit_sha, branch } = req.body;

  if (!['development', 'sandbox', 'production'].includes(environment)) {
    return res.status(400).json({ error: 'Ambiente inválido' });
  }

  try {
    // Marcar como building
    await pool.query(
      `UPDATE mini_app_environments
       SET status = 'building', updated_at = NOW(), deployed_by = $1
       WHERE app_id = $2 AND environment = $3`,
      [req.user.email, req.params.appId, environment]
    );

    // Disparar GitHub Actions si hay token configurado
    if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
      await triggerGitHubAction(
        req.params.appId,
        environment,
        branch || 'main',
        commit_sha
      );
    }

    res.json({
      success: true,
      message: `Deploy a ${environment} iniciado`,
      app_id: req.params.appId,
      environment,
    });
  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /environments/:appId/:environment — actualizar bundle_url (llamado por CI/CD)
router.put('/:appId/:environment', authMiddleware, async (req, res) => {
  const { bundle_url, version, commit_sha, status, build_log } = req.body;

  try {
    const result = await pool.query(
      `UPDATE mini_app_environments SET
        bundle_url  = COALESCE($1, bundle_url),
        version     = COALESCE($2, version),
        commit_sha  = COALESCE($3, commit_sha),
        status      = COALESCE($4, status),
        build_log   = COALESCE($5, build_log),
        deployed_at = NOW(),
        updated_at  = NOW()
       WHERE app_id = $6 AND environment = $7
       RETURNING *`,
      [
        bundle_url, version, commit_sha,
        status || 'ready', build_log,
        req.params.appId, req.params.environment,
      ]
    );

    // Si se actualiza production, actualizar también bundle_url en mini_apps
    if (req.params.environment === 'production' && bundle_url) {
      await pool.query(
        `UPDATE mini_apps SET bundle_url = $1, version = $2, updated_at = NOW()
         WHERE id = $3`,
        [bundle_url, version, req.params.appId]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update env error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /environments/:appId/promote — promover de un ambiente a otro
router.post('/:appId/promote', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  const { from, to } = req.body;
  const validPromotions = {
    'development': 'sandbox',
    'sandbox': 'production',
  };

  if (validPromotions[from] !== to) {
    return res.status(400).json({
      error: `Solo se puede promover: development→sandbox o sandbox→production`,
    });
  }

  try {
    // Obtener el ambiente origen
    const source = await pool.query(
      `SELECT * FROM mini_app_environments
       WHERE app_id = $1 AND environment = $2`,
      [req.params.appId, from]
    );

    if (source.rows.length === 0 || source.rows[0].status !== 'ready') {
      return res.status(400).json({
        error: `El ambiente ${from} no está listo para promover`,
      });
    }

    const src = source.rows[0];

    // Copiar al ambiente destino
    const result = await pool.query(
      `UPDATE mini_app_environments SET
        bundle_url  = $1,
        version     = $2,
        commit_sha  = $3,
        status      = 'ready',
        deployed_at = NOW(),
        deployed_by = $4,
        updated_at  = NOW()
       WHERE app_id = $5 AND environment = $6
       RETURNING *`,
      [
        src.bundle_url, src.version, src.commit_sha,
        req.user.email, req.params.appId, to,
      ]
    );

    // Registrar en historial
    await pool.query(
      `INSERT INTO mini_app_versions
        (app_id, version, bundle_url, deployed_by, commit_sha, is_active)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [
        req.params.appId, src.version, src.bundle_url,
        req.user.email, src.commit_sha,
      ]
    );

    // Si se promovió a production, actualizar mini_apps
    if (to === 'production') {
      await pool.query(
        `UPDATE mini_apps SET
          bundle_url = $1, version = $2, updated_at = NOW()
         WHERE id = $3`,
        [src.bundle_url, src.version, req.params.appId]
      );
    }

    res.json({
      success: true,
      message: `Promovido de ${from} a ${to}`,
      environment: result.rows[0],
    });
  } catch (err) {
    console.error('Promote error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /environments/qr/:token — resolver QR → mini-app + ambiente
router.get('/qr/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.*, e.bundle_url, e.status, m.name
       FROM mini_app_qr_codes q
       JOIN mini_app_environments e
         ON e.app_id = q.app_id AND e.environment = q.environment
       JOIN mini_apps m ON m.id = q.app_id
       WHERE q.qr_token = $1`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QR no encontrado' });
    }

    const qr = result.rows[0];
    res.json({
      app_id: qr.app_id,
      app_name: qr.name,
      environment: qr.environment,
      bundle_url: qr.bundle_url,
      status: qr.status,
      deep_link: `superapp://miniapp/${qr.app_id}?env=${qr.environment}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /environments/:appId/qr — generar QR para un ambiente
router.post('/:appId/qr', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }

  const { environment } = req.body;

  try {
    // Generar token único
    const token = crypto.randomBytes(16).toString('hex');

    const result = await pool.query(
      `INSERT INTO mini_app_qr_codes (app_id, environment, qr_token)
       VALUES ($1, $2, $3)
       ON CONFLICT (app_id, environment)
       DO UPDATE SET qr_token = EXCLUDED.qr_token
       RETURNING *`,
      [req.params.appId, environment, token]
    );

    res.json({
      qr_token: result.rows[0].qr_token,
      qr_url: `${process.env.API_URL || 'https://superapp-backend-grtx.onrender.com'}/environments/qr/${token}`,
      deep_link: `superapp://miniapp/${req.params.appId}?env=${environment}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Helpers ──────────────────────────────────────────────────
async function triggerGitHubAction(appId, environment, branch, commitSha) {
  const [owner, repo] = process.env.GITHUB_REPO.split('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/deploy.yml/dispatches`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: branch || 'main',
      inputs: {
        environment,
        app_id: appId,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitHub Actions error: ${err}`);
  }
}

async function _createDefaultEnvironments(appId) {
  const envs = ['development', 'sandbox', 'production'];
  for (const env of envs) {
    await pool.query(
      `INSERT INTO mini_app_environments (app_id, environment)
       VALUES ($1, $2)
       ON CONFLICT (app_id, environment) DO NOTHING`,
      [appId, env]
    );
  }
}

async function _getEnvironments(appId) {
  const result = await pool.query(
    `SELECT e.*, q.qr_token
     FROM mini_app_environments e
     LEFT JOIN mini_app_qr_codes q
       ON q.app_id = e.app_id AND q.environment = e.environment
     WHERE e.app_id = $1
     ORDER BY CASE e.environment
       WHEN 'development' THEN 1
       WHEN 'sandbox' THEN 2
       WHEN 'production' THEN 3
     END`,
    [appId]
  );
  return result.rows;
}

module.exports = router;