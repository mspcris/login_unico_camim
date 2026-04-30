'use strict';

/*
 * Swagger UI para os endpoints /camila_interna/*
 *
 * Servido via CDN (sem dependência npm extra). Acesso:
 *   GET /camila_interna/docs           → Swagger UI HTML
 *   GET /camila_interna/openapi.json   → OpenAPI spec (JSON)
 *
 * NÃO requer auth — só lista os endpoints. Para CHAMÁ-los pelo "Try it out"
 * o usuário precisa inserir o header x-admin-api-key.
 */

const express = require('express');
const router = express.Router();

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Camila Interna — Joint venture com meuchatbot',
    version: '1.0.0',
    description:
      'Endpoints internos que leem o Postgres do meuchatbot direto. ' +
      'Read-only. Auth via header `x-admin-api-key`.',
  },
  servers: [
    { url: '/', description: 'Atual' },
  ],
  components: {
    securitySchemes: {
      AdminKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-admin-api-key',
      },
    },
    schemas: {
      Clinica: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          nome: { type: 'string', example: 'Realengo' },
          razao_social: { type: 'string', nullable: true },
          endereco: { type: 'string', nullable: true },
          numero: { type: 'string', nullable: true },
          complemento: { type: 'string', nullable: true },
          bairro: { type: 'string', example: 'Realengo' },
          cidade: { type: 'string', example: 'Rio de Janeiro' },
          uf: { type: 'string', example: 'RJ' },
          cep: { type: 'string', nullable: true },
          telefone: { type: 'string', example: '2455-9600', description: 'Público — divulgado ao cliente.' },
          telefone_interno: { type: 'string', nullable: true, description: 'Privado — não divulgar.' },
          email: { type: 'string', nullable: true },
          cnpj: { type: 'string', nullable: true },
          horario_funcionamento: { type: 'string', nullable: true },
          url_avaliacao_google: { type: 'string', nullable: true },
          codigo_posto: { type: 'string', example: 'R' },
          id_endereco: { type: 'integer', example: 1 },
          ativa: { type: 'boolean', example: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ClinicasResponse: {
        type: 'object',
        properties: {
          source: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'meuchatbot.postgres' },
              table: { type: 'string', example: 'clinicas' },
              update_method: { type: 'string' },
              last_updated_at: { type: 'string', format: 'date-time', nullable: true },
            },
          },
          fetched_at: { type: 'string', format: 'date-time' },
          count: { type: 'integer', example: 13 },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Clinica' },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          detail: { type: 'string', nullable: true },
        },
      },
    },
  },
  security: [{ AdminKey: [] }],
  paths: {
    '/camila_interna/clinicas': {
      get: {
        tags: ['Clínicas'],
        summary: 'Lista clínicas (catálogo manual do meuchatbot)',
        description:
          'Lê direto a tabela `clinicas` do Postgres do meuchatbot. ' +
          'Inclui telefone público e telefone interno separados.',
        parameters: [
          {
            name: 'ativa',
            in: 'query',
            description: 'Filtrar por status (true/false). Omitir = todas.',
            required: false,
            schema: { type: 'string', enum: ['true', 'false'] },
          },
          {
            name: 'q',
            in: 'query',
            description: 'Busca em nome / bairro / cidade (ILIKE).',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Lista de clínicas com metadados de origem.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ClinicasResponse' },
              },
            },
          },
          401: { description: 'Header x-admin-api-key inválido ou ausente.' },
          500: {
            description: 'Erro ao consultar o Postgres do meuchatbot.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          503: {
            description: 'MEUCHATBOT_DATABASE_URL não configurada.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
};

router.get('/openapi.json', (_req, res) => {
  res.json(openapi);
});

const swaggerHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Camila Interna — API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/camila_interna/openapi.json',
      dom_id: '#swagger',
      deepLinking: true,
      persistAuthorization: true,
    });
  </script>
</body>
</html>`;

router.get('/docs', (_req, res) => {
  res.type('html').send(swaggerHtml);
});

module.exports = router;
