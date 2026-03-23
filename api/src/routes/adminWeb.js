'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../database');
const { sendActivationEmail } = require('../services/email');

const router = express.Router();
const parseForm = express.urlencoded({ extended: false });

const ADMIN_COOKIE = 'camim_admin';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 8 * 60 * 60 * 1000, // 8h
  signed: true,
};

// ─── Auth helpers ────────────────────────────────────────────────────────────

function getAdmin(req) {
  const val = req.signedCookies && req.signedCookies[ADMIN_COOKIE];
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function requireAdmin(req, res, next) {
  if (getAdmin(req)) return next();
  return res.redirect('/painel/login');
}

// Flash via query string
function redirectFlash(res, path, type, msg) {
  const u = new URL(path, 'http://x');
  u.searchParams.set(type, msg);
  return res.redirect(u.pathname + u.search);
}

// ─── Auth routes ─────────────────────────────────────────────────────────────

router.get('/painel', (req, res) => {
  return getAdmin(req) ? res.redirect('/painel/usuarios') : res.redirect('/painel/login');
});

router.get('/painel/login', (req, res) => {
  if (getAdmin(req)) return res.redirect('/painel/usuarios');
  return res.render('admin/login', { error: req.query.error || null });
});

router.post('/painel/login', parseForm, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.render('admin/login', { error: 'E-mail e senha são obrigatórios.' });

  try {
    const db = getPool();
    const result = await db.query(
      'SELECT id, email, name, password_hash, is_admin, active FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0)
      return res.render('admin/login', { error: 'Credenciais inválidas.' });

    const user = result.rows[0];

    if (!user.is_admin || !user.active)
      return res.render('admin/login', { error: 'Acesso não autorizado.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.render('admin/login', { error: 'Credenciais inválidas.' });

    res.cookie(ADMIN_COOKIE, JSON.stringify({ id: user.id, email: user.email, name: user.name }), COOKIE_OPTS);
    return res.redirect('/painel/usuarios');
  } catch (err) {
    console.error('[AdminWeb] login error:', err.message);
    return res.render('admin/login', { error: 'Erro interno. Tente novamente.' });
  }
});

router.get('/painel/logout', (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  return res.redirect('/painel/login');
});

// ─── Users ───────────────────────────────────────────────────────────────────

router.get('/painel/usuarios', requireAdmin, async (req, res) => {
  try {
    const db = getPool();
    const result = await db.query(
      `SELECT id, email, name, active, is_admin, created_at,
              (SELECT COUNT(*) FROM activation_tokens WHERE user_id = users.id) > 0 AS has_pending_token
       FROM users ORDER BY created_at DESC`
    );
    return res.render('admin/users', {
      users: result.rows,
      admin: getAdmin(req),
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[AdminWeb] GET /painel/usuarios error:', err.message);
    return res.status(500).send('Erro interno.');
  }
});

router.post('/painel/usuarios/convidar', requireAdmin, parseForm, async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string')
    return redirectFlash(res, '/painel/usuarios', 'error', 'E-mail é obrigatório.');

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    return redirectFlash(res, '/painel/usuarios', 'error', 'Formato de e-mail inválido.');

  const emailDomain = normalizedEmail.split('@')[1];

  try {
    const db = getPool();
    const domainCheck = await db.query('SELECT domain FROM allowed_domains WHERE domain = $1', [emailDomain]);
    if (domainCheck.rows.length === 0)
      return redirectFlash(res, '/painel/usuarios', 'error', `O domínio @${emailDomain} não está autorizado.`);

    let userId;
    try {
      const userResult = await db.query(
        `INSERT INTO users (email, password_hash, active, email_verified)
         VALUES ($1, $2, FALSE, FALSE) RETURNING id`,
        [normalizedEmail, await bcrypt.hash(uuidv4(), 12)]
      );
      userId = userResult.rows[0].id;
    } catch (dbErr) {
      if (dbErr.code === '23505')
        return redirectFlash(res, '/painel/usuarios', 'error', 'Já existe um usuário com este e-mail.');
      throw dbErr;
    }

    const token = uuidv4();
    await db.query(
      'INSERT INTO activation_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, userId, new Date(Date.now() + 72 * 60 * 60 * 1000)]
    );

    const activationUrl = `${process.env.ISSUER || 'http://localhost:3000'}/ativar/${token}`;
    await sendActivationEmail(normalizedEmail, null, activationUrl);

    return redirectFlash(res, '/painel/usuarios', 'success', `Convite enviado para ${normalizedEmail}.`);
  } catch (err) {
    console.error('[AdminWeb] convidar error:', err.message);
    return redirectFlash(res, '/painel/usuarios', 'error', 'Erro interno ao enviar convite.');
  }
});

router.post('/painel/usuarios/:id/desativar', requireAdmin, parseForm, async (req, res) => {
  try {
    await getPool().query('UPDATE users SET active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
    return redirectFlash(res, '/painel/usuarios', 'success', 'Usuário desativado.');
  } catch (err) {
    return redirectFlash(res, '/painel/usuarios', 'error', 'Erro ao desativar usuário.');
  }
});

router.post('/painel/usuarios/:id/ativar', requireAdmin, parseForm, async (req, res) => {
  try {
    await getPool().query('UPDATE users SET active = TRUE, updated_at = NOW() WHERE id = $1', [req.params.id]);
    return redirectFlash(res, '/painel/usuarios', 'success', 'Usuário ativado.');
  } catch (err) {
    return redirectFlash(res, '/painel/usuarios', 'error', 'Erro ao ativar usuário.');
  }
});

router.post('/painel/usuarios/:id/reenviar', requireAdmin, parseForm, async (req, res) => {
  try {
    const db = getPool();
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return redirectFlash(res, '/painel/usuarios', 'error', 'Usuário não encontrado.');

    const user = rows[0];
    await db.query('DELETE FROM activation_tokens WHERE user_id = $1', [user.id]);

    const token = uuidv4();
    await db.query(
      'INSERT INTO activation_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, user.id, new Date(Date.now() + 72 * 60 * 60 * 1000)]
    );

    const activationUrl = `${process.env.ISSUER || 'http://localhost:3000'}/ativar/${token}`;
    await sendActivationEmail(user.email, user.name, activationUrl);

    return redirectFlash(res, '/painel/usuarios', 'success', `Convite reenviado para ${user.email}.`);
  } catch (err) {
    console.error('[AdminWeb] reenviar error:', err.message);
    return redirectFlash(res, '/painel/usuarios', 'error', 'Erro ao reenviar convite.');
  }
});

// ─── Systems (OAuth2 Clients) ────────────────────────────────────────────────

router.get('/painel/sistemas', requireAdmin, async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT client_id, client_name, redirect_uris, active, description, created_at
       FROM clients ORDER BY created_at DESC`
    );
    return res.render('admin/sistemas', {
      clients: rows,
      admin: getAdmin(req),
      newClient: null,
      error: req.query.error || null,
      issuer: process.env.ISSUER || 'https://auth.camim.com.br',
    });
  } catch (err) {
    console.error('[AdminWeb] GET /painel/sistemas error:', err.message);
    return res.status(500).send('Erro interno.');
  }
});

router.post('/painel/sistemas', requireAdmin, parseForm, async (req, res) => {
  const { client_name, redirect_uri, post_logout_uri, description } = req.body;

  const renderError = async (msg) => {
    const { rows } = await getPool().query(`SELECT client_id, client_name, redirect_uris, active, description, created_at FROM clients ORDER BY created_at DESC`);
    return res.render('admin/sistemas', { clients: rows, admin: getAdmin(req), newClient: null, error: msg, issuer: process.env.ISSUER || 'https://auth.camim.com.br' });
  };

  if (!client_name || !redirect_uri) return renderError('Nome e URL de callback são obrigatórios.');

  try { new URL(redirect_uri); } catch { return renderError('URL de callback inválida.'); }

  try {
    const crypto = require('crypto');
    const clientId = 'camim_' + crypto.randomBytes(8).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('hex');

    const db = getPool();
    await db.query(
      `INSERT INTO clients (client_id, client_secret, client_name, redirect_uris, post_logout_redirect_uris, scope, description)
       VALUES ($1, $2, $3, $4, $5, 'openid profile email', $6)`,
      [clientId, clientSecret, client_name.trim(), [redirect_uri], post_logout_uri ? [post_logout_uri] : [], description || null]
    );

    const { rows } = await db.query(`SELECT client_id, client_name, redirect_uris, active, description, created_at FROM clients ORDER BY created_at DESC`);
    return res.render('admin/sistemas', {
      clients: rows,
      admin: getAdmin(req),
      newClient: { client_id: clientId, client_secret: clientSecret },
      error: null,
      issuer: process.env.ISSUER || 'https://auth.camim.com.br',
    });
  } catch (err) {
    console.error('[AdminWeb] POST /painel/sistemas error:', err.message);
    return renderError('Erro interno ao registrar sistema.');
  }
});

router.post('/painel/sistemas/:clientId/desativar', requireAdmin, parseForm, async (req, res) => {
  try {
    await getPool().query('UPDATE clients SET active = FALSE WHERE client_id = $1', [req.params.clientId]);
    return redirectFlash(res, '/painel/sistemas', 'success', 'Sistema desativado.');
  } catch (err) {
    return redirectFlash(res, '/painel/sistemas', 'error', 'Erro ao desativar sistema.');
  }
});

router.post('/painel/sistemas/:clientId/ativar', requireAdmin, parseForm, async (req, res) => {
  try {
    await getPool().query('UPDATE clients SET active = TRUE WHERE client_id = $1', [req.params.clientId]);
    return redirectFlash(res, '/painel/sistemas', 'success', 'Sistema ativado.');
  } catch (err) {
    return redirectFlash(res, '/painel/sistemas', 'error', 'Erro ao ativar sistema.');
  }
});

// ─── Domains ─────────────────────────────────────────────────────────────────

router.get('/painel/dominios', requireAdmin, async (req, res) => {
  try {
    const { rows } = await getPool().query('SELECT domain, created_at FROM allowed_domains ORDER BY domain ASC');
    return res.render('admin/domains', {
      domains: rows,
      admin: getAdmin(req),
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    return res.status(500).send('Erro interno.');
  }
});

router.post('/painel/dominios', requireAdmin, parseForm, async (req, res) => {
  const { domain } = req.body;
  if (!domain || !domain.trim())
    return redirectFlash(res, '/painel/dominios', 'error', 'Domínio é obrigatório.');

  const normalized = domain.trim().toLowerCase();
  try {
    await getPool().query('INSERT INTO allowed_domains (domain) VALUES ($1) ON CONFLICT DO NOTHING', [normalized]);
    return redirectFlash(res, '/painel/dominios', 'success', `Domínio ${normalized} adicionado.`);
  } catch (err) {
    return redirectFlash(res, '/painel/dominios', 'error', 'Erro ao adicionar domínio.');
  }
});

router.post('/painel/dominios/:domain/remover', requireAdmin, parseForm, async (req, res) => {
  try {
    await getPool().query('DELETE FROM allowed_domains WHERE domain = $1', [req.params.domain]);
    return redirectFlash(res, '/painel/dominios', 'success', `Domínio ${req.params.domain} removido.`);
  } catch (err) {
    return redirectFlash(res, '/painel/dominios', 'error', 'Erro ao remover domínio.');
  }
});

module.exports = router;
