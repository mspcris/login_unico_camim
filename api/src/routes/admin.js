'use strict';

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getPool } = require('../database');

const router = express.Router();

// ─── Authentication Middleware ─────────────────────────────────────────────────

/**
 * Middleware that validates the x-admin-api-key header.
 * All admin routes require this key.
 */
function requireAdminKey(req, res, next) {
  const apiKey = req.headers['x-admin-api-key'];
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({ error: 'Admin API key not configured on server.' });
  }

  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing x-admin-api-key header.' });
  }

  return next();
}

router.use(requireAdminKey);

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /admin/clients
 * Register a new OAuth2 client application.
 */
router.post('/clients', async (req, res) => {
  try {
    const {
      client_name,
      redirect_uris,
      post_logout_redirect_uris = [],
      grant_types = ['authorization_code'],
      response_types = ['code'],
      scope = 'openid profile email',
      token_endpoint_auth_method = 'client_secret_basic',
      owner_email,
      description,
      logo_uri,
      client_uri,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!client_name || typeof client_name !== 'string' || client_name.trim().length === 0) {
      return res.status(400).json({ error: 'client_name é obrigatório.' });
    }

    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({ error: 'redirect_uris é obrigatório e deve ser um array com pelo menos uma URI.' });
    }

    // Validate each redirect URI is a valid URL
    for (const uri of redirect_uris) {
      try {
        new URL(uri);
      } catch {
        return res.status(400).json({ error: `redirect_uri inválida: ${uri}` });
      }
    }

    // ── Generate credentials ────────────────────────────────────────────────
    const clientId = 'camim_' + crypto.randomBytes(8).toString('hex');
    const clientSecret =
      token_endpoint_auth_method === 'none'
        ? null
        : crypto.randomBytes(32).toString('hex');

    // ── Persist to database ─────────────────────────────────────────────────
    const db = getPool();
    await db.query(
      `INSERT INTO clients (
        client_id, client_secret, client_name,
        redirect_uris, post_logout_redirect_uris,
        grant_types, response_types, scope,
        token_endpoint_auth_method, owner_email,
        description, logo_uri, client_uri
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        clientId,
        clientSecret,
        client_name.trim(),
        redirect_uris,
        post_logout_redirect_uris,
        grant_types,
        response_types,
        scope,
        token_endpoint_auth_method,
        owner_email || null,
        description || null,
        logo_uri || null,
        client_uri || null,
      ]
    );

    return res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name.trim(),
      redirect_uris,
      scope,
      token_endpoint_auth_method,
      message: clientSecret
        ? 'Guarde o client_secret - ele não será exibido novamente.'
        : 'Client público criado (sem client_secret).',
    });
  } catch (err) {
    console.error('[Admin] POST /clients error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao criar o cliente.' });
  }
});

/**
 * GET /admin/clients
 * List all registered clients (without client_secret).
 */
router.get('/clients', async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT
        client_id, client_name, redirect_uris, post_logout_redirect_uris,
        grant_types, response_types, scope, token_endpoint_auth_method,
        active, owner_email, description, logo_uri, client_uri, created_at
       FROM clients
       ORDER BY created_at DESC`
    );

    return res.json({ clients: result.rows });
  } catch (err) {
    console.error('[Admin] GET /clients error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao listar clientes.' });
  }
});

/**
 * DELETE /admin/clients/:clientId
 * Deactivate a client (soft delete — sets active = FALSE).
 */
router.delete('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const db = getPool();

    const result = await db.query(
      'UPDATE clients SET active = FALSE WHERE client_id = $1 RETURNING client_id',
      [clientId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    return res.json({ message: `Cliente ${clientId} desativado com sucesso.` });
  } catch (err) {
    console.error('[Admin] DELETE /clients error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao desativar o cliente.' });
  }
});

/**
 * PATCH /admin/clients/:clientId
 * Update client properties.
 */
router.patch('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { redirect_uris, post_logout_redirect_uris, scope, description, active, logo_uri, client_uri } = req.body;

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (redirect_uris !== undefined) {
      if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) {
        return res.status(400).json({ error: 'redirect_uris deve ser um array não vazio.' });
      }
      updates.push(`redirect_uris = $${paramIdx++}`);
      values.push(redirect_uris);
    }

    if (post_logout_redirect_uris !== undefined) {
      updates.push(`post_logout_redirect_uris = $${paramIdx++}`);
      values.push(post_logout_redirect_uris);
    }

    if (scope !== undefined) {
      updates.push(`scope = $${paramIdx++}`);
      values.push(scope);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIdx++}`);
      values.push(description);
    }

    if (active !== undefined) {
      updates.push(`active = $${paramIdx++}`);
      values.push(!!active);
    }

    if (logo_uri !== undefined) {
      updates.push(`logo_uri = $${paramIdx++}`);
      values.push(logo_uri);
    }

    if (client_uri !== undefined) {
      updates.push(`client_uri = $${paramIdx++}`);
      values.push(client_uri);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    values.push(clientId);
    const db = getPool();
    const result = await db.query(
      `UPDATE clients SET ${updates.join(', ')} WHERE client_id = $${paramIdx} RETURNING client_id`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    return res.json({ message: 'Cliente atualizado com sucesso.', client_id: clientId });
  } catch (err) {
    console.error('[Admin] PATCH /clients error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao atualizar o cliente.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /admin/users
 * Create a new user account.
 */
router.post('/users', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      given_name,
      family_name,
      picture,
      phone_number,
      email_verified = false,
      is_admin = false,
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios.' });
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Formato de e-mail inválido.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const db = getPool();
    let result;
    try {
      result = await db.query(
        `INSERT INTO users (
          email, password_hash, name, given_name, family_name,
          picture, phone_number, email_verified, is_admin
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, email, name, given_name, family_name, picture,
                  phone_number, email_verified, is_admin, active, created_at`,
        [
          email.toLowerCase().trim(),
          passwordHash,
          name || null,
          given_name || null,
          family_name || null,
          picture || null,
          phone_number || null,
          !!email_verified,
          !!is_admin,
        ]
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
      }
      throw dbErr;
    }

    return res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error('[Admin] POST /users error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao criar o usuário.' });
  }
});

/**
 * GET /admin/users
 * List all users (without password hash).
 */
router.get('/users', async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, email, name, given_name, family_name, picture,
              phone_number, email_verified, active, is_admin, created_at, updated_at
       FROM users
       ORDER BY created_at DESC`
    );

    return res.json({ users: result.rows });
  } catch (err) {
    console.error('[Admin] GET /users error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao listar usuários.' });
  }
});

/**
 * GET /admin/users/:userId
 * Get a specific user by ID (without password hash).
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getPool();

    const result = await db.query(
      `SELECT id, email, name, given_name, family_name, picture,
              phone_number, email_verified, active, is_admin, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[Admin] GET /users/:userId error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao buscar o usuário.' });
  }
});

/**
 * PATCH /admin/users/:userId
 * Update user data (can update password, name, active status, etc.).
 */
router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      email,
      password,
      name,
      given_name,
      family_name,
      picture,
      phone_number,
      email_verified,
      active,
      is_admin,
    } = req.body;

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Formato de e-mail inválido.' });
      }
      updates.push(`email = $${paramIdx++}`);
      values.push(email.toLowerCase().trim());
    }

    if (password !== undefined) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
      }
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${paramIdx++}`);
      values.push(hash);
    }

    if (name !== undefined) {
      updates.push(`name = $${paramIdx++}`);
      values.push(name);
    }

    if (given_name !== undefined) {
      updates.push(`given_name = $${paramIdx++}`);
      values.push(given_name);
    }

    if (family_name !== undefined) {
      updates.push(`family_name = $${paramIdx++}`);
      values.push(family_name);
    }

    if (picture !== undefined) {
      updates.push(`picture = $${paramIdx++}`);
      values.push(picture);
    }

    if (phone_number !== undefined) {
      updates.push(`phone_number = $${paramIdx++}`);
      values.push(phone_number);
    }

    if (email_verified !== undefined) {
      updates.push(`email_verified = $${paramIdx++}`);
      values.push(!!email_verified);
    }

    if (active !== undefined) {
      updates.push(`active = $${paramIdx++}`);
      values.push(!!active);
    }

    if (is_admin !== undefined) {
      updates.push(`is_admin = $${paramIdx++}`);
      values.push(!!is_admin);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar foi fornecido.' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const db = getPool();
    let result;
    try {
      result = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}
         RETURNING id, email, name, given_name, family_name, picture,
                   phone_number, email_verified, active, is_admin, updated_at`,
        values
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
      }
      throw dbErr;
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('[Admin] PATCH /users/:userId error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao atualizar o usuário.' });
  }
});

/**
 * DELETE /admin/users/:userId
 * Deactivate a user (soft delete — sets active = FALSE).
 */
router.delete('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getPool();

    const result = await db.query(
      `UPDATE users SET active = FALSE, updated_at = NOW()
       WHERE id = $1 RETURNING id, email`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    return res.json({
      message: `Usuário ${result.rows[0].email} desativado com sucesso.`,
    });
  } catch (err) {
    console.error('[Admin] DELETE /users/:userId error:', err.message);
    return res.status(500).json({ error: 'Erro interno ao desativar o usuário.' });
  }
});

module.exports = router;
