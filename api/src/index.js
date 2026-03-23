'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { waitForDb, runMigrations, createAdminUser, seedDefaultDomains } = require('./database');
const { getOrGenerateJwks } = require('./keys');
const { createProvider } = require('./provider');
const interactionsRouter = require('./routes/interactions');
const adminRouter = require('./routes/admin');
const activateRouter = require('./routes/activate');
const adminWebRouter = require('./routes/adminWeb');

const PORT = parseInt(process.env.PORT || '3000', 10);

async function main() {
  try {
    // ── 1. Wait for database and run migrations ──────────────────────────────
    console.log('[Boot] Connecting to database...');
    await waitForDb();

    console.log('[Boot] Running database migrations...');
    await runMigrations();

    console.log('[Boot] Creating admin user if needed...');
    await createAdminUser();

    console.log('[Boot] Seeding default allowed domains...');
    await seedDefaultDomains();

    // ── 2. Load or generate signing keys ─────────────────────────────────────
    console.log('[Boot] Loading JWKS...');
    const jwks = await getOrGenerateJwks();

    // ── 3. Create OIDC provider ───────────────────────────────────────────────
    console.log('[Boot] Initializing OIDC provider...');
    const provider = createProvider(jwks);

    // ── 4. Configure Express application ─────────────────────────────────────
    const app = express();

    // View engine (EJS templates)
    app.set('views', path.join(__dirname, '..', 'views'));
    app.set('view engine', 'ejs');

    // Trust nginx reverse proxy (required for HTTPS detection)
    app.set('trust proxy', 1);

    // Static files (CSS, images, etc.)
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Session middleware (before routes)
    // secure: false because SSL is terminated at nginx — cookie is safe in transit
    app.use(session({
      name: 'camim_admin_sid',
      secret: process.env.SESSION_SECRET || 'camim-session-secret-fallback-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
      },
    }));

    // JSON body parser for API routes
    app.use(express.json());

    // ── 5. Health check endpoint ──────────────────────────────────────────────
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
      });
    });

    // ── 6. Admin API routes ───────────────────────────────────────────────────
    app.use('/admin', adminRouter);

    // ── 6b. Activation routes (public) ────────────────────────────────────────
    app.use('/', activateRouter);

    // ── 6c. Admin web panel routes ────────────────────────────────────────────
    app.use('/', adminWebRouter);

    // ── 7. OIDC interaction routes (login/consent pages) ─────────────────────
    app.use('/interaction', interactionsRouter(provider));

    // ── 8. /me alias for /userinfo (developer convenience) ───────────────────
    app.get('/me', (req, res, next) => {
      req.url = '/userinfo';
      next();
    });

    // ── 9. Mount the oidc-provider (handles all OIDC endpoints) ──────────────
    app.use(provider.callback());

    // ── 10. Start listening ───────────────────────────────────────────────────
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Boot] Login Único Camim running on port ${PORT}`);
      console.log(`[Boot] Issuer: ${process.env.ISSUER || 'http://localhost'}`);
      console.log(`[Boot] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Boot] Discovery: ${process.env.ISSUER || 'http://localhost'}/.well-known/openid-configuration`);
    });
  } catch (err) {
    console.error('[Boot] Fatal error during startup:', err);
    process.exit(1);
  }
}

main();
