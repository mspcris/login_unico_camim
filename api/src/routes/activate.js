'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getPool } = require('../database');
const { sendActivationEmail } = require('../services/email');

const router = express.Router();

// Body parser for form submissions
const parseForm = express.urlencoded({ extended: false });

/**
 * GET /
 * Home page — self-registration form.
 */
router.get('/', (req, res) => {
  res.render('home', { error: null, success: null, email: null });
});

/**
 * POST /registrar
 * Self-registration: user enters email, receives activation link.
 */
router.post('/registrar', parseForm, async (req, res) => {
  const renderHome = (error, success, email) =>
    res.render('home', { error, success, email });

  const email = (req.body.email || '').toLowerCase().trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderHome('Informe um endereço de e-mail válido.', null, email);
  }

  const domain = email.split('@')[1];
  const db = getPool();

  try {
    // Check if domain is allowed
    const domainCheck = await db.query(
      'SELECT domain FROM allowed_domains WHERE domain = $1',
      [domain]
    );
    if (domainCheck.rows.length === 0) {
      return renderHome(
        `O domínio @${domain} não está autorizado a criar um idCamim. Entre em contato com o administrador.`,
        null,
        email
      );
    }

    // Check if user already exists and is active
    const existing = await db.query('SELECT id, active FROM users WHERE email = $1', [email]);
    let userId;

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.active) {
        return renderHome(
          'Este e-mail já possui um idCamim ativo. Acesse normalmente pelos sistemas Camim.',
          null,
          email
        );
      }
      // User exists but inactive — resend activation
      userId = user.id;
      await db.query('DELETE FROM activation_tokens WHERE user_id = $1', [userId]);
    } else {
      // Create new inactive user
      const result = await db.query(
        `INSERT INTO users (email, password_hash, active, email_verified)
         VALUES ($1, $2, FALSE, FALSE) RETURNING id`,
        [email, await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)]
      );
      userId = result.rows[0].id;
    }

    // Generate activation token (72h)
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO activation_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, userId, expiresAt]
    );

    const activationUrl = `${process.env.ISSUER}/ativar/${token}`;
    await sendActivationEmail(email, null, activationUrl);

    return renderHome(null, email, null);
  } catch (err) {
    console.error('[Registrar] Error:', err.message);
    return renderHome('Erro interno. Tente novamente mais tarde.', null, email);
  }
});

/**
 * GET /ativar/sucesso
 * Success page after account activation.
 * Must be declared before /ativar/:token to avoid "sucesso" being treated as a token.
 */
router.get('/ativar/sucesso', (req, res) => {
  res.render('activate_success');
});

/**
 * GET /ativar/:token
 * Render the activation form (set name + password).
 */
router.get('/ativar/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const db = getPool();

    const result = await db.query(
      `SELECT at.token, at.expires_at, u.email
       FROM activation_tokens at
       JOIN users u ON u.id = at.user_id
       WHERE at.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.render('activate', {
        token,
        email: null,
        error: 'Link de ativação inválido ou não encontrado.',
        expired: true,
      });
    }

    const row = result.rows[0];

    if (new Date(row.expires_at) < new Date()) {
      return res.render('activate', {
        token,
        email: row.email,
        error: 'Este link de ativação expirou. Solicite um novo convite ao administrador.',
        expired: true,
      });
    }

    return res.render('activate', { token, email: row.email, error: null, expired: false });
  } catch (err) {
    console.error('[Activate] GET /ativar/:token error:', err.message);
    return res.status(500).render('activate', {
      token: req.params.token,
      email: null,
      error: 'Erro interno. Tente novamente mais tarde.',
      expired: false,
    });
  }
});

/**
 * POST /ativar/:token
 * Handle activation form: set name, password, activate user.
 */
router.post('/ativar/:token', parseForm, async (req, res) => {
  const { token } = req.params;
  const { name, password, password_confirm } = req.body;

  const renderError = (email, msg) =>
    res.render('activate', { token, email, error: msg, expired: false });

  try {
    const db = getPool();

    const result = await db.query(
      `SELECT at.token, at.expires_at, at.user_id, u.email
       FROM activation_tokens at
       JOIN users u ON u.id = at.user_id
       WHERE at.token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return renderError(null, 'Link de ativação inválido ou não encontrado.');
    }

    const row = result.rows[0];

    if (new Date(row.expires_at) < new Date()) {
      return renderError(row.email, 'Este link de ativação expirou. Solicite um novo convite ao administrador.');
    }

    // Validate inputs
    if (!name || name.trim().length === 0) {
      return renderError(row.email, 'O nome completo é obrigatório.');
    }

    if (!password || password.length < 8) {
      return renderError(row.email, 'A senha deve ter pelo menos 8 caracteres.');
    }

    if (password !== password_confirm) {
      return renderError(row.email, 'As senhas não conferem.');
    }

    // Update user
    const passwordHash = await bcrypt.hash(password, 12);
    const nameTrimmed = name.trim();
    const nameParts = nameTrimmed.split(' ');
    const givenName = nameParts[0];
    const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

    await db.query(
      `UPDATE users
       SET name = $1, given_name = $2, family_name = $3,
           password_hash = $4, active = TRUE, email_verified = TRUE, updated_at = NOW()
       WHERE id = $5`,
      [nameTrimmed, givenName, familyName, passwordHash, row.user_id]
    );

    // Delete activation token
    await db.query('DELETE FROM activation_tokens WHERE token = $1', [token]);

    return res.redirect('/ativar/sucesso');
  } catch (err) {
    console.error('[Activate] POST /ativar/:token error:', err.message);
    return res.status(500).render('activate', {
      token,
      email: null,
      error: 'Erro interno. Tente novamente mais tarde.',
      expired: false,
    });
  }
});

module.exports = router;
