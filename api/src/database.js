'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool = null;

/**
 * Returns a singleton pg Pool instance.
 * @returns {Pool}
 */
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle client:', err.message);
    });
  }
  return pool;
}

/**
 * Waits for the database to become available.
 * @param {number} retries - Number of retry attempts
 * @param {number} delay - Delay in milliseconds between retries
 */
async function waitForDb(retries = 30, delay = 2000) {
  const db = getPool();
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await db.connect();
      client.release();
      console.log('[DB] Connection established successfully.');
      return;
    } catch (err) {
      console.log(`[DB] Waiting for database... attempt ${i}/${retries} (${err.message})`);
      if (i === retries) {
        throw new Error(`[DB] Could not connect to database after ${retries} attempts: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Runs all database migrations to create required tables and indexes.
 */
async function runMigrations() {
  const db = getPool();
  const client = await db.connect();
  try {
    console.log('[DB] Running migrations...');

    await client.query('BEGIN');

    // oidc_payloads: stores all OIDC tokens, codes, sessions, etc.
    await client.query(`
      CREATE TABLE IF NOT EXISTS oidc_payloads (
        id          VARCHAR(255)  NOT NULL,
        type        VARCHAR(100)  NOT NULL,
        payload     JSONB         NOT NULL DEFAULT '{}',
        grant_id    VARCHAR(255),
        user_code   VARCHAR(255),
        uid         VARCHAR(255),
        expires_at  TIMESTAMPTZ,
        consumed_at TIMESTAMPTZ,
        PRIMARY KEY (type, id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oidc_payloads_uid
        ON oidc_payloads (uid)
        WHERE uid IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oidc_payloads_grant_id
        ON oidc_payloads (grant_id)
        WHERE grant_id IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oidc_payloads_user_code
        ON oidc_payloads (user_code)
        WHERE user_code IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_oidc_payloads_expires_at
        ON oidc_payloads (expires_at)
        WHERE expires_at IS NOT NULL
    `);

    // users: application user accounts
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        email           VARCHAR(255)  UNIQUE NOT NULL,
        password_hash   VARCHAR(255)  NOT NULL,
        name            VARCHAR(255),
        given_name      VARCHAR(255),
        family_name     VARCHAR(255),
        picture         TEXT,
        phone_number    VARCHAR(50),
        email_verified  BOOLEAN       NOT NULL DEFAULT FALSE,
        active          BOOLEAN       NOT NULL DEFAULT TRUE,
        is_admin        BOOLEAN       NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)
    `);

    // clients: registered OAuth2 client applications
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        client_id                   VARCHAR(255)  PRIMARY KEY,
        client_secret               VARCHAR(255),
        client_name                 VARCHAR(255)  NOT NULL,
        redirect_uris               TEXT[]        NOT NULL DEFAULT '{}',
        post_logout_redirect_uris   TEXT[]        NOT NULL DEFAULT '{}',
        grant_types                 TEXT[]        NOT NULL DEFAULT '{authorization_code}',
        response_types              TEXT[]        NOT NULL DEFAULT '{code}',
        scope                       VARCHAR(1000) NOT NULL DEFAULT 'openid profile email',
        token_endpoint_auth_method  VARCHAR(50)   NOT NULL DEFAULT 'client_secret_basic',
        active                      BOOLEAN       NOT NULL DEFAULT TRUE,
        owner_email                 VARCHAR(255),
        description                 TEXT,
        logo_uri                    TEXT,
        client_uri                  TEXT,
        created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    // settings: key-value store for system configuration (e.g., JWKS)
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key         VARCHAR(255)  PRIMARY KEY,
        value       TEXT          NOT NULL,
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('[DB] Migrations completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`[DB] Migration failed: ${err.message}`);
  } finally {
    client.release();
  }
}

/**
 * Creates the initial admin user from environment variables if one does not exist.
 */
async function createAdminUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@camim.com.br';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.warn('[DB] ADMIN_PASSWORD not set — skipping admin user creation.');
    return;
  }

  const db = getPool();

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`[DB] Admin user ${email} already exists — skipping creation.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (email, password_hash, name, given_name, family_name, email_verified, is_admin)
     VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)`,
    [email, passwordHash, 'Administrador Camim', 'Administrador', 'Camim']
  );

  console.log(`[DB] Admin user created: ${email}`);
}

module.exports = { getPool, waitForDb, runMigrations, createAdminUser };
