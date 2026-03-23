'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool } = require('../database');

const router = express.Router();

// Body parser for form submissions
const parseForm = express.urlencoded({ extended: false });

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
