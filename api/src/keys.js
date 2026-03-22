'use strict';

const crypto = require('crypto');
const { getPool } = require('./database');

/**
 * Retrieves the JWKS from the database settings, or generates a new EC P-256
 * key pair if none exists, persists it, and returns it.
 *
 * @returns {Promise<{keys: object[]}>} JWKS object with private key(s)
 */
async function getOrGenerateJwks() {
  const db = getPool();

  // Check if JWKS is already stored
  const result = await db.query("SELECT value FROM settings WHERE key = 'jwks'");

  if (result.rows.length > 0) {
    try {
      const jwks = JSON.parse(result.rows[0].value);
      console.log('[Keys] Loaded existing JWKS from database.');
      return jwks;
    } catch (err) {
      console.warn('[Keys] Failed to parse stored JWKS, regenerating...', err.message);
    }
  }

  // Generate a new EC P-256 key pair
  console.log('[Keys] Generating new EC P-256 key pair...');
  const { privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  // Export the private key as JWK
  const privateJwk = privateKey.export({ format: 'jwk' });

  // Add required OIDC metadata to the JWK
  privateJwk.kid = crypto.randomUUID();
  privateJwk.use = 'sig';
  privateJwk.alg = 'ES256';

  const jwks = { keys: [privateJwk] };
  const jwksJson = JSON.stringify(jwks);

  // Persist to database
  await db.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('jwks', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [jwksJson]
  );

  console.log(`[Keys] New JWKS generated and stored. kid=${privateJwk.kid}`);
  return jwks;
}

module.exports = { getOrGenerateJwks };
