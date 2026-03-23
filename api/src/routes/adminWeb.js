'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../database');
const { sendActivationEmail } = require('../services/email');

const router = express.Router();

// Body parser for form submissions
const parseForm = express.urlencoded({ extended: false });

// ─── Auth Middleware ─────────────────────────────────────────────────────────

function requireAdminSession(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }
  return res.redirect('/painel/login');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flashSet(req, key, value) {
  req.session.flash = req.session.flash || {};
  req.session.flash[key] = value;
}

function flashGet(req) {
  const flash = req.session.flash || {};
  delete req.session.flash;
  return flash;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /painel
 * Redirect to login or users page.
 */
router.get('/painel', (req, res) => {
  if (req.session && req.session.adminUser) {
    return res.redirect('/painel/usuarios');
  }
  return res.redirect('/painel/login');
});

/**
 * GET /painel/login
 */
router.get('/painel/login', (req, res) => {
  if (req.session && req.session.adminUser) {
    return res.redirect('/painel/usuarios');
  }
  const flash = flashGet(req);
  return res.render('admin/login', { error: flash.error || null });
});

/**
 * POST /painel/login
 */
router.post('/painel/login', parseForm, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('admin/login', { error: 'E-mail e senha são obrigatórios.' });
  }

  try {
    const db = getPool();
    const result = await db.query(
      'SELECT id, email, name, password_hash, is_admin, active FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.render('admin/login', { error: 'Credenciais inválidas.' });
    }

    const user = result.rows[0];

    if (!user.is_admin || !user.active) {
      return res.render('admin/login', { error: 'Acesso não autorizado.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.render('admin/login', { error: 'Credenciais inválidas.' });
    }

    req.session.adminUser = { id: user.id, email: user.email, name: user.name };
    return req.session.save((err) => {
      if (err) console.error('[AdminWeb] Session save error:', err);
      return res.redirect('/painel/usuarios');
    });
  } catch (err) {
    console.error('[AdminWeb] POST /painel/login error:', err.message);
    return res.render('admin/login', { error: 'Erro interno. Tente novamente.' });
  }
});

/**
 * GET /painel/logout
 */
router.get('/painel/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/painel/login');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /painel/usuarios
 */
router.get('/painel/usuarios', requireAdminSession, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, email, name, active, is_admin, created_at, updated_at,
              (SELECT COUNT(*) FROM activation_tokens WHERE user_id = users.id) > 0 AS has_pending_token
       FROM users
       ORDER BY created_at DESC`
    );
    const flash = flashGet(req);
    return res.render('admin/users', {
      users: result.rows,
      admin: req.session.adminUser,
      success: flash.success || null,
      error: flash.error || null,
    });
  } catch (err) {
    console.error('[AdminWeb] GET /painel/usuarios error:', err.message);
    return res.status(500).send('Erro interno.');
  }
});

/**
 * POST /painel/usuarios/convidar
 * Invite a user via form submission.
 */
router.post('/painel/usuarios/convidar', requireAdminSession, parseForm, async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    flashSet(req, 'error', 'E-mail é obrigatório.');
    return res.redirect('/painel/usuarios');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    flashSet(req, 'error', 'Formato de e-mail inválido.');
    return res.redirect('/painel/usuarios');
  }

  const emailDomain = normalizedEmail.split('@')[1];

  try {
    const db = getPool();

    const domainCheck = await db.query('SELECT domain FROM allowed_domains WHERE domain = $1', [emailDomain]);
    if (domainCheck.rows.length === 0) {
      flashSet(req, 'error', `O domínio @${emailDomain} não está autorizado.`);
      return res.redirect('/painel/usuarios');
    }

    const { v4: uuidv4local } = require('uuid');
    const placeholderHash = await bcrypt.hash(uuidv4local(), 12);
    let userId;
    try {
      const userResult = await db.query(
        `INSERT INTO users (email, password_hash, active, email_verified)
         VALUES ($1, $2, FALSE, FALSE)
         RETURNING id`,
        [normalizedEmail, placeholderHash]
      );
      userId = userResult.rows[0].id;
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        flashSet(req, 'error', 'Já existe um usuário com este e-mail.');
        return res.redirect('/painel/usuarios');
      }
      throw dbErr;
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO activation_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, userId, expiresAt]
    );

    const issuer = process.env.ISSUER || 'http://localhost:3000';
    const activationUrl = `${issuer}/ativar/${token}`;
    await sendActivationEmail(normalizedEmail, null, activationUrl);

    flashSet(req, 'success', `Convite enviado para ${normalizedEmail}.`);
    return res.redirect('/painel/usuarios');
  } catch (err) {
    console.error('[AdminWeb] POST /painel/usuarios/convidar error:', err.message);
    flashSet(req, 'error', 'Erro interno ao enviar convite.');
    return res.redirect('/painel/usuarios');
  }
});

/**
 * POST /painel/usuarios/:id/desativar
 */
router.post('/painel/usuarios/:id/desativar', requireAdminSession, parseForm, async (req, res) => {
  try {
    const db = getPool();
    await db.query(
      'UPDATE users SET active = FALSE, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    flashSet(req, 'success', 'Usuário desativado.');
  } catch (err) {
    console.error('[AdminWeb] desativar error:', err.message);
    flashSet(req, 'error', 'Erro ao desativar usuário.');
  }
  return res.redirect('/painel/usuarios');
});

/**
 * POST /painel/usuarios/:id/ativar
 */
router.post('/painel/usuarios/:id/ativar', requireAdminSession, parseForm, async (req, res) => {
  try {
    const db = getPool();
    await db.query(
      'UPDATE users SET active = TRUE, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    flashSet(req, 'success', 'Usuário ativado.');
  } catch (err) {
    console.error('[AdminWeb] ativar error:', err.message);
    flashSet(req, 'error', 'Erro ao ativar usuário.');
  }
  return res.redirect('/painel/usuarios');
});

/**
 * POST /painel/usuarios/:id/reenviar
 * Resend activation email (generate a new token).
 */
router.post('/painel/usuarios/:id/reenviar', requireAdminSession, parseForm, async (req, res) => {
  try {
    const db = getPool();
    const userResult = await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.params.id]);

    if (userResult.rows.length === 0) {
      flashSet(req, 'error', 'Usuário não encontrado.');
      return res.redirect('/painel/usuarios');
    }

    const user = userResult.rows[0];

    // Delete existing tokens
    await db.query('DELETE FROM activation_tokens WHERE user_id = $1', [user.id]);

    // Create new token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO activation_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, expiresAt]
    );

    const issuer = process.env.ISSUER || 'http://localhost:3000';
    const activationUrl = `${issuer}/ativar/${token}`;
    await sendActivationEmail(user.email, user.name, activationUrl);

    flashSet(req, 'success', `Convite reenviado para ${user.email}.`);
  } catch (err) {
    console.error('[AdminWeb] reenviar error:', err.message);
    flashSet(req, 'error', 'Erro ao reenviar convite.');
  }
  return res.redirect('/painel/usuarios');
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOMAIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /painel/dominios
 */
router.get('/painel/dominios', requireAdminSession, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query('SELECT domain, created_at FROM allowed_domains ORDER BY domain ASC');
    const flash = flashGet(req);
    return res.render('admin/domains', {
      domains: result.rows,
      admin: req.session.adminUser,
      success: flash.success || null,
      error: flash.error || null,
    });
  } catch (err) {
    console.error('[AdminWeb] GET /painel/dominios error:', err.message);
    return res.status(500).send('Erro interno.');
  }
});

/**
 * POST /painel/dominios
 */
router.post('/painel/dominios', requireAdminSession, parseForm, async (req, res) => {
  const { domain } = req.body;

  if (!domain || domain.trim().length === 0) {
    flashSet(req, 'error', 'Domínio é obrigatório.');
    return res.redirect('/painel/dominios');
  }

  const normalized = domain.trim().toLowerCase();

  try {
    const db = getPool();
    await db.query('INSERT INTO allowed_domains (domain) VALUES ($1) ON CONFLICT DO NOTHING', [normalized]);
    flashSet(req, 'success', `Domínio ${normalized} adicionado.`);
  } catch (err) {
    console.error('[AdminWeb] POST /painel/dominios error:', err.message);
    flashSet(req, 'error', 'Erro ao adicionar domínio.');
  }
  return res.redirect('/painel/dominios');
});

/**
 * POST /painel/dominios/:domain/remover
 */
router.post('/painel/dominios/:domain/remover', requireAdminSession, parseForm, async (req, res) => {
  try {
    const db = getPool();
    await db.query('DELETE FROM allowed_domains WHERE domain = $1', [req.params.domain]);
    flashSet(req, 'success', `Domínio ${req.params.domain} removido.`);
  } catch (err) {
    console.error('[AdminWeb] remover domínio error:', err.message);
    flashSet(req, 'error', 'Erro ao remover domínio.');
  }
  return res.redirect('/painel/dominios');
});

module.exports = router;
