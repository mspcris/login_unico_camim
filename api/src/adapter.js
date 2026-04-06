'use strict';

const { getPool } = require('./database');

/**
 * PostgresAdapter for oidc-provider v7.
 *
 * This adapter persists all OIDC model instances (tokens, codes, sessions, etc.)
 * to a PostgreSQL database. The special 'Client' model type is handled by
 * querying the 'clients' table directly, while all other types use the
 * 'oidc_payloads' table.
 */
class PostgresAdapter {
  /**
   * @param {string} name - The model type name (e.g., 'Session', 'AccessToken', 'Client')
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * oidc-provider v7 requires the adapter constructor to be callable
   * as a class (new Adapter(name)).
   */

  // ─── Client model (served from the clients table) ───────────────────────────

  /**
   * Maps a row from the clients table to the format expected by oidc-provider.
   * @param {object} row
   * @returns {object}
   */
  static _ensureArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  static _clientRowToOidc(row) {
    if (!row) return undefined;

    const mapped = {
      client_id: row.client_id,
      client_secret: row.client_secret || undefined,
      client_name: row.client_name,
      redirect_uris: PostgresAdapter._ensureArray(row.redirect_uris),
      post_logout_redirect_uris: PostgresAdapter._ensureArray(row.post_logout_redirect_uris),
      grant_types: PostgresAdapter._ensureArray(row.grant_types) || ['authorization_code'],
      response_types: PostgresAdapter._ensureArray(row.response_types) || ['code'],
      scope: row.scope || 'openid profile email',
      token_endpoint_auth_method: row.token_endpoint_auth_method || 'client_secret_basic',
      id_token_signed_response_alg: 'ES256',
      logo_uri: row.logo_uri || undefined,
      client_uri: row.client_uri || undefined,
    };

    console.log(`[Adapter] Client mapped: ${mapped.client_id} redirect_uris=${JSON.stringify(mapped.redirect_uris)}`);
    return mapped;
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  /**
   * Calculates an expiry TIMESTAMPTZ given expiresIn seconds from now.
   * @param {number|undefined} expiresIn
   * @returns {Date|null}
   */
  static _expiresAt(expiresIn) {
    if (!expiresIn) return null;
    return new Date(Date.now() + expiresIn * 1000);
  }

  // ─── oidc-provider adapter interface ────────────────────────────────────────

  /**
   * Upserts a payload into the store.
   * @param {string} id
   * @param {object} payload
   * @param {number} expiresIn - seconds until expiry
   */
  async upsert(id, payload, expiresIn) {
    if (this.name === 'Client') {
      // Clients are managed via the admin API, not by oidc-provider itself
      return;
    }

    const db = getPool();
    const expiresAt = PostgresAdapter._expiresAt(expiresIn);

    try {
      await db.query(
        `INSERT INTO oidc_payloads (id, type, payload, grant_id, user_code, uid, expires_at, consumed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (type, id) DO UPDATE
           SET payload     = EXCLUDED.payload,
               grant_id    = EXCLUDED.grant_id,
               user_code   = EXCLUDED.user_code,
               uid         = EXCLUDED.uid,
               expires_at  = EXCLUDED.expires_at,
               consumed_at = EXCLUDED.consumed_at`,
        [
          id,
          this.name,
          JSON.stringify(payload),
          payload.grantId || null,
          payload.userCode || null,
          payload.uid || null,
          expiresAt,
          payload.consumed ? new Date() : null,
        ]
      );
      console.log(`[Adapter] upsert OK type=${this.name} id=${id}`);
    } catch (err) {
      console.error(`[Adapter] upsert FAILED type=${this.name} id=${id}:`, err.message);
      throw err;
    }
  }

  /**
   * Finds a payload by its id.
   * @param {string} id
   * @returns {Promise<object|undefined>}
   */
  async find(id) {
    const db = getPool();

    if (this.name === 'Client') {
      const result = await db.query(
        'SELECT * FROM clients WHERE client_id = $1 AND active = TRUE',
        [id]
      );
      return PostgresAdapter._clientRowToOidc(result.rows[0]);
    }

    let result;
    try {
      result = await db.query(
        `SELECT payload, consumed_at, expires_at
         FROM oidc_payloads
         WHERE type = $1 AND id = $2`,
        [this.name, id]
      );
    } catch (err) {
      console.error(`[Adapter] find DB error type=${this.name} id=${id}:`, err.message);
      throw err;
    }

    if (result.rows.length === 0) {
      console.warn(`[Adapter] find NOT FOUND type=${this.name} id=${id}`);
      return undefined;
    }

    const row = result.rows[0];

    // Check if expired
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      console.warn(`[Adapter] find EXPIRED type=${this.name} id=${id} expires_at=${row.expires_at}`);
      return undefined;
    }

    // Ensure payload is a plain object (pg returns jsonb as object, but be defensive)
    const payload = typeof row.payload === 'string'
      ? JSON.parse(row.payload)
      : { ...row.payload };

    if (row.consumed_at) {
      payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1000);
    }

    console.log(`[Adapter] find OK type=${this.name} id=${id}`);
    return payload;
  }

  /**
   * Finds a payload by its uid (used for sessions).
   * @param {string} uid
   * @returns {Promise<object|undefined>}
   */
  async findByUid(uid) {
    const db = getPool();

    const result = await db.query(
      `SELECT payload, consumed_at, expires_at
       FROM oidc_payloads
       WHERE type = $1 AND uid = $2`,
      [this.name, uid]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return undefined;
    }

    const payload = row.payload;

    if (row.consumed_at) {
      payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1000);
    }

    return payload;
  }

  /**
   * Finds a Device Authorization payload by its user_code.
   * @param {string} userCode
   * @returns {Promise<object|undefined>}
   */
  async findByUserCode(userCode) {
    const db = getPool();

    const result = await db.query(
      `SELECT payload, consumed_at, expires_at
       FROM oidc_payloads
       WHERE type = $1 AND user_code = $2`,
      [this.name, userCode]
    );

    if (result.rows.length === 0) return undefined;

    const row = result.rows[0];

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return undefined;
    }

    const payload = row.payload;

    if (row.consumed_at) {
      payload.consumed = Math.floor(new Date(row.consumed_at).getTime() / 1000);
    }

    return payload;
  }

  /**
   * Marks a payload as consumed (used for authorization codes, etc.).
   * @param {string} id
   */
  async consume(id) {
    if (this.name === 'Client') return;

    const db = getPool();
    await db.query(
      `UPDATE oidc_payloads SET consumed_at = NOW()
       WHERE type = $1 AND id = $2`,
      [this.name, id]
    );
  }

  /**
   * Destroys a payload by id.
   * @param {string} id
   */
  async destroy(id) {
    if (this.name === 'Client') return;

    const db = getPool();
    await db.query(
      'DELETE FROM oidc_payloads WHERE type = $1 AND id = $2',
      [this.name, id]
    );
  }

  /**
   * Revokes all payloads associated with a grant_id.
   * Called when a grant is revoked (e.g., user revokes app access).
   * @param {string} grantId
   */
  async revokeByGrantId(grantId) {
    if (this.name === 'Client') return;

    const db = getPool();
    await db.query(
      'DELETE FROM oidc_payloads WHERE grant_id = $1',
      [grantId]
    );
  }
}

module.exports = PostgresAdapter;
