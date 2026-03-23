'use strict';

const { Provider } = require('oidc-provider');
const PostgresAdapter = require('./adapter');
const { findAccount } = require('./account');

/**
 * Creates and configures the oidc-provider instance.
 *
 * @param {object} jwks - JWKS object containing private keys for signing tokens
 * @returns {Provider}
 */
function createProvider(jwks) {
  const issuer = process.env.ISSUER || 'http://localhost';
  const isProduction = process.env.NODE_ENV === 'production';

  const cookieConfig = {
    keys: [process.env.COOKIE_SECRET || 'fallback-secret-change-in-production'],
    short: {
      secure: isProduction,
      httpOnly: true,
      sameSite: 'lax',
    },
    long: {
      secure: isProduction,
      httpOnly: true,
      sameSite: 'lax',
    },
  };

  const config = {
    // Adapter for persisting model instances to PostgreSQL
    adapter: PostgresAdapter,

    // Function to load user accounts
    findAccount,

    // JSON Web Key Set for signing tokens (EC P-256)
    jwks,

    // Cookie configuration
    cookies: cookieConfig,

    // Claims mapping: which scopes unlock which user claims
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'given_name', 'family_name', 'picture', 'updated_at'],
      phone: ['phone_number'],
    },

    // Supported scopes
    scopes: ['openid', 'profile', 'email', 'phone', 'offline_access'],

    // Feature toggles
    features: {
      // Disable built-in dev interactions (we provide our own)
      devInteractions: { enabled: false },

      // Token introspection endpoint (POST /token/introspect)
      introspection: { enabled: true },

      // Token revocation endpoint (POST /token/revocation)
      revocation: { enabled: true },

      // RP-initiated logout (GET /session/end)
      rpInitiatedLogout: {
        enabled: true,
        // Custom success page — replaces the built-in white "Sign-out Success" page
        async postLogoutSuccessSource(ctx) {
          const ejs  = require('ejs');
          const path = require('path');
          const view = path.join(__dirname, '../views/logout.ejs');
          ctx.type = 'text/html';
          ctx.body  = await ejs.renderFile(view, { loggedOut: true, uid: null, xsrf: null, logout: null });
        },
      },

      // Userinfo endpoint (GET /me)
      userinfo: { enabled: true },
    },

    // Token Time-To-Live values (in seconds)
    ttl: {
      AccessToken: 3600,           // 1 hour
      AuthorizationCode: 600,      // 10 minutes
      IdToken: 3600,               // 1 hour
      RefreshToken: 2592000,       // 30 days
      Session: 1209600,            // 14 days
      Interaction: 3600,           // 1 hour
      Grant: 1209600,              // 14 days
      ClientCredentials: 600,      // 10 minutes
    },

    // URL for interaction pages (login, consent)
    interactions: {
      url(ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },

    // PKCE is optional (not required) — supports both plain and S256
    pkce: {
      required: () => false,
      methods: ['S256', 'plain'],
    },

    // Custom error rendering — returns JSON
    renderError(ctx, out, error) {
      ctx.type = 'application/json';
      ctx.body = {
        error: out.error || 'server_error',
        error_description: out.error_description || 'An unexpected error occurred',
      };
      if (process.env.NODE_ENV !== 'production') {
        console.error('[OIDC Error]', error);
      }
    },

    // Response types supported
    responseTypes: ['code'],

    // Grant types supported
    grantTypes: ['authorization_code', 'refresh_token'],

    // Signing algorithm for ID tokens
    whitelistedJWA: undefined,
  };

  const provider = new Provider(issuer, config);

  // Trust X-Forwarded-Proto from nginx reverse proxy so that discovery
  // document URLs are built with https:// instead of http://.
  // NOTE: proxy must be set as a property on the provider instance,
  // not in the config object — the config key is ignored in oidc-provider v7.
  provider.proxy = true;

  // Log provider errors in development
  if (process.env.NODE_ENV !== 'production') {
    provider.on('server_error', (ctx, err) => {
      console.error('[OIDC] server_error:', err);
    });
  }

  // Always log grant/token events for audit
  provider.on('authorization_code.saved', (code) => {
    console.log(`[OIDC] authorization_code saved: client=${code.clientId}`);
  });

  provider.on('access_token.saved', (token) => {
    console.log(`[OIDC] access_token saved: client=${token.clientId}`);
  });

  return provider;
}

module.exports = { createProvider };
