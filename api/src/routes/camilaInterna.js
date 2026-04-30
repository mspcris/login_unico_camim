'use strict';

/*
 * Rotas /camila_interna/*
 *
 * Joint venture com o projeto meuchatbot (mesma VM, pasta /opt/meuchatbot).
 * Lê DIRETO o Postgres do meuchatbot via MEUCHATBOT_DATABASE_URL.
 *
 * SEGURANÇA:
 *  - Auth: header x-admin-api-key (mesmo padrão das demais /admin/*).
 *  - Read-only: apenas SELECT, nunca escreve.
 *  - statement_timeout=5s no pool pra evitar bloqueio.
 *  - Recomendado configurar MEUCHATBOT_DATABASE_URL com um usuário Postgres
 *    com privilégio SELECT-ONLY (ex.: chatbot_ro), nunca o usuário owner.
 *  - Localhost-only por convenção (containers na mesma VM).
 */

const express = require('express');
const { getMeuchatbotPool } = require('../db/meuchatbot');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const apiKey = req.headers['x-admin-api-key'];
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_API_KEY não configurada no servidor.' });
  }
  if (!apiKey || apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized: header x-admin-api-key inválido ou ausente.' });
  }
  return next();
}

router.use(requireAdminKey);

// ─────────────────────────────────────────────────────────────────────────────
// GET /camila_interna/clinicas
//
// Retorna o catálogo de clínicas mantido no meuchatbot (cadastro manual).
//
// Query params opcionais:
//   ?ativa=true|false  — filtra por status
//   ?q=texto           — busca por nome/bairro/cidade (ILIKE)
//
// Resposta:
//   {
//     source: { ... },            // metadados da origem (igual ao /admin/clinicas/source-info)
//     fetched_at: "ISO-8601",
//     count: <int>,
//     data: [ { id, nome, ..., telefone, telefone_interno, ... } ]
//   }
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clinicas', async (req, res) => {
  let pool;
  try {
    pool = getMeuchatbotPool();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const { ativa, q } = req.query;
  const where = [];
  const params = [];

  if (ativa === 'true' || ativa === 'false') {
    params.push(ativa === 'true');
    where.push(`ativa = $${params.length}`);
  }
  if (typeof q === 'string' && q.trim().length > 0) {
    params.push(`%${q.trim()}%`);
    where.push(`(nome ILIKE $${params.length} OR bairro ILIKE $${params.length} OR cidade ILIKE $${params.length})`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      id, nome, razao_social, endereco, numero, complemento,
      bairro, cidade, uf, cep,
      telefone, telefone_interno, email, cnpj,
      horario_funcionamento, url_avaliacao_google,
      codigo_posto, id_endereco, ativa,
      created_at, updated_at
    FROM clinicas
    ${whereSql}
    ORDER BY nome
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const lastUpdated = rows.reduce((acc, r) => {
      const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      return t > acc ? t : acc;
    }, 0);

    return res.json({
      source: {
        type: 'meuchatbot.postgres',
        table: 'clinicas',
        update_method: 'Cadastro manual em meuchatbot/admin/clinicas',
        last_updated_at: lastUpdated > 0 ? new Date(lastUpdated).toISOString() : null,
      },
      fetched_at: new Date().toISOString(),
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('[camila_interna/clinicas] erro:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar clínicas no meuchatbot.', detail: err.message });
  }
});

module.exports = router;
