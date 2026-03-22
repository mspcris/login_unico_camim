'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { getPool } = require('../database');

/**
 * Factory function that creates the interactions router.
 * The provider instance is injected so we can call provider.interactionDetails
 * and provider.interactionFinished.
 *
 * @param {import('oidc-provider').Provider} provider
 * @returns {express.Router}
 */
module.exports = function createInteractionsRouter(provider) {
  const router = express.Router();

  // Body parser for form submissions (login/consent forms)
  const parseForm = express.urlencoded({ extended: false });

  /**
   * Helper: Get client details from database for display in views.
   * @param {string} clientId
   * @returns {Promise<object>}
   */
  async function getClientForView(clientId) {
    if (!clientId) return { client_name: 'Aplicação Desconhecida' };

    const db = getPool();
    const result = await db.query(
      'SELECT client_id, client_name, logo_uri, client_uri FROM clients WHERE client_id = $1',
      [clientId]
    );

    return result.rows[0] || { client_name: clientId };
  }

  // ─── GET /:uid ─────────────────────────────────────────────────────────────
  // Entry point for interactions: shows login or consent page based on prompt
  router.get('/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res);
      const { uid, prompt, params } = details;

      const client = await getClientForView(params.client_id);

      if (prompt.name === 'login') {
        return res.render('login', {
          uid,
          client,
          params,
          error: null,
          flash: req.query.flash || null,
        });
      }

      if (prompt.name === 'consent') {
        // Build list of scopes for display
        const requestedScopes = (params.scope || '').split(' ').filter(Boolean);

        return res.render('consent', {
          uid,
          client,
          params,
          details: prompt.details,
          scopes: requestedScopes,
        });
      }

      // Unknown prompt — pass to provider
      return next();
    } catch (err) {
      console.error('[Interaction GET] Error:', err.message);
      return next(err);
    }
  });

  // ─── POST /:uid/login ──────────────────────────────────────────────────────
  // Handles login form submission
  router.post('/:uid/login', parseForm, async (req, res, next) => {
    const { uid } = req.params;
    const { email, password, remember } = req.body;

    try {
      const details = await provider.interactionDetails(req, res);
      const { params } = details;
      const client = await getClientForView(params.client_id);

      // ── Validate input ────────────────────────────────────────────────────
      if (!email || !password) {
        return res.render('login', {
          uid,
          client,
          params,
          error: 'Por favor, preencha o e-mail e a senha.',
          flash: null,
        });
      }

      // ── Look up user ──────────────────────────────────────────────────────
      const db = getPool();
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 AND active = TRUE',
        [email.toLowerCase().trim()]
      );

      if (result.rows.length === 0) {
        return res.render('login', {
          uid,
          client,
          params,
          error: 'E-mail ou senha incorretos.',
          flash: null,
        });
      }

      const user = result.rows[0];

      // ── Verify password ───────────────────────────────────────────────────
      const passwordValid = await bcrypt.compare(password, user.password_hash);

      if (!passwordValid) {
        return res.render('login', {
          uid,
          client,
          params,
          error: 'E-mail ou senha incorretos.',
          flash: null,
        });
      }

      // ── Login successful ──────────────────────────────────────────────────
      await provider.interactionFinished(
        req,
        res,
        {
          login: {
            accountId: user.id,
            remember: !!remember,
          },
        },
        { mergeWithLastSubmission: false }
      );
    } catch (err) {
      console.error('[Interaction Login] Error:', err.message);
      return next(err);
    }
  });

  // ─── POST /:uid/confirm ────────────────────────────────────────────────────
  // Handles consent form submission (user approves the permissions)
  router.post('/:uid/confirm', parseForm, async (req, res, next) => {
    try {
      const interactionDetails = await provider.interactionDetails(req, res);
      const {
        prompt: { name, details },
        params,
        session: { accountId },
      } = interactionDetails;

      if (name !== 'consent') {
        return next(new Error('Unexpected prompt: ' + name));
      }

      // Build or update the Grant for this client + account
      let { grantId } = interactionDetails;
      let grant;

      const { Grant } = provider;

      if (grantId) {
        // Modifying an existing grant
        grant = await Grant.find(grantId);
      } else {
        // Creating a new grant
        grant = new Grant({
          accountId,
          clientId: params.client_id,
        });
      }

      // Add missing scopes
      if (details.missingOIDCScope) {
        grant.addOIDCScope(details.missingOIDCScope.join(' '));
      }

      // Add missing claims
      if (details.missingOIDCClaims) {
        grant.addOIDCClaims(details.missingOIDCClaims);
      }

      // Add missing resource scopes
      if (details.missingResourceScopes) {
        for (const [indicator, scopes] of Object.entries(details.missingResourceScopes)) {
          grant.addResourceScope(indicator, scopes.join(' '));
        }
      }

      grantId = await grant.save();

      const consent = {};
      if (!interactionDetails.grantId) {
        // This is a new grant
        consent.grantId = grantId;
      }

      await provider.interactionFinished(
        req,
        res,
        { consent },
        { mergeWithLastSubmission: true }
      );
    } catch (err) {
      console.error('[Interaction Confirm] Error:', err.message);
      return next(err);
    }
  });

  // ─── POST /:uid/abort ──────────────────────────────────────────────────────
  // User cancels/denies the authorization request
  router.post('/:uid/abort', parseForm, async (req, res, next) => {
    try {
      await provider.interactionFinished(
        req,
        res,
        {
          error: 'access_denied',
          error_description: 'Acesso negado pelo usuário.',
        },
        { mergeWithLastSubmission: false }
      );
    } catch (err) {
      console.error('[Interaction Abort] Error:', err.message);
      return next(err);
    }
  });

  return router;
};
