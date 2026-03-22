'use strict';

const { getPool } = require('./database');

/**
 * findAccount is called by oidc-provider to load a user account.
 * It must return an object with accountId and a claims() method,
 * or undefined/null if the account is not found.
 *
 * @param {object} ctx - Koa context (oidc-provider uses Koa internally)
 * @param {string} id - The user's UUID (accountId)
 * @returns {Promise<object|undefined>}
 */
async function findAccount(ctx, id) {
  const db = getPool();

  const result = await db.query(
    'SELECT * FROM users WHERE id = $1 AND active = TRUE',
    [id]
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  const user = result.rows[0];

  return {
    accountId: user.id,

    /**
     * Returns claims based on the requested use and scope.
     * oidc-provider calls this with use='userinfo' or use='id_token'.
     *
     * @param {string} use - 'userinfo' or 'id_token'
     * @param {string} scope - Space-separated list of granted scopes
     * @param {object} claims - Requested claims object
     * @param {string[]} rejected - Rejected claims
     * @returns {Promise<object>}
     */
    async claims(use, scope) {
      const result = {
        // 'sub' is always required in OIDC
        sub: user.id,
      };

      const scopeList = typeof scope === 'string' ? scope.split(' ') : (scope || []);

      if (scopeList.includes('email')) {
        result.email = user.email;
        result.email_verified = user.email_verified;
      }

      if (scopeList.includes('profile')) {
        result.name = user.name || null;
        result.given_name = user.given_name || null;
        result.family_name = user.family_name || null;
        result.picture = user.picture || null;
        result.updated_at = user.updated_at
          ? Math.floor(new Date(user.updated_at).getTime() / 1000)
          : null;
      }

      if (scopeList.includes('phone')) {
        result.phone_number = user.phone_number || null;
      }

      return result;
    },
  };
}

module.exports = { findAccount };
