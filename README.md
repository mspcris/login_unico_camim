# Login Único Camim (SSO)

Servidor de autenticação centralizado baseado em **OAuth2/OIDC** (OpenID Connect), construído com Node.js e [`oidc-provider`](https://github.com/panva/node-oidc-provider).

## Stack

- **Node.js 20** + `oidc-provider` — servidor OIDC completo
- **PostgreSQL 16** — persistência de tokens, sessões, usuários e clientes
- **Redis 7** — cache de sessões
- **Nginx** — reverse proxy (suporte a HTTP e HTTPS/TLS)
- **Docker Compose** — orquestração de todos os serviços

## Funcionalidades

- OAuth2 Authorization Code Flow (com suporte a PKCE)
- Endpoints padrão OIDC: `/authorize`, `/token`, `/userinfo`, `/jwks`, `/.well-known/openid-configuration`
- Login e consent via interface web (EJS)
- Logout global (RP-Initiated Logout)
- Token introspection e revocation
- Admin API REST para gerenciar usuários e clientes OAuth2
- JWKS rotacionável (EC P-256, persistido no banco)

## Estrutura

```
.
├── api/
│   ├── src/
│   │   ├── index.js          # Entry point
│   │   ├── provider.js       # Configuração do oidc-provider
│   │   ├── adapter.js        # Adapter PostgreSQL para tokens/sessões
│   │   ├── account.js        # Carregamento de contas de usuário
│   │   ├── database.js       # Pool, migrations e admin user
│   │   ├── keys.js           # Geração/persistência de JWKS (EC P-256)
│   │   └── routes/
│   │       ├── admin.js      # Admin API (usuários e clientes)
│   │       └── interactions.js # Login, consent, abort
│   ├── views/                # Templates EJS (login, consent, logout, error)
│   ├── public/               # Arquivos estáticos (CSS)
│   └── Dockerfile
├── nginx/
│   └── nginx.conf            # Reverse proxy (HTTP + HTTPS comentado)
├── docker-compose.yml
└── .env.example
```

## Configuração

```bash
cp .env.example .env
# Edite .env e preencha os valores (POSTGRES_PASSWORD, COOKIE_SECRET, ADMIN_API_KEY, ADMIN_PASSWORD)
```

## Iniciar

```bash
docker compose up -d --build
```

Aguarde os serviços subirem (postgres e redis têm health checks). O servidor estará disponível em `http://localhost` (porta 80 via Nginx).

## Endpoints OIDC

| Endpoint | Descrição |
|---|---|
| `GET /.well-known/openid-configuration` | Discovery document |
| `GET /jwks` | Chaves públicas de assinatura |
| `GET /authorize` | Início do fluxo de autorização |
| `POST /token` | Troca de código por tokens |
| `GET /userinfo` ou `GET /me` | Dados do usuário autenticado |
| `POST /token/introspect` | Introspecção de token |
| `POST /token/revocation` | Revogação de token |
| `GET /session/end` | Logout global |
| `GET /health` | Health check |

## Admin API

Todas as rotas requerem o header `x-admin-api-key`.

### Clientes OAuth2

```bash
# Registrar novo cliente
POST /admin/clients

# Listar clientes
GET /admin/clients

# Atualizar cliente
PATCH /admin/clients/:clientId

# Desativar cliente
DELETE /admin/clients/:clientId
```

### Usuários

```bash
# Criar usuário
POST /admin/users

# Listar usuários
GET /admin/users

# Buscar usuário
GET /admin/users/:userId

# Atualizar usuário
PATCH /admin/users/:userId

# Desativar usuário
DELETE /admin/users/:userId
```

## Produção (HTTPS/SSL)

Veja os comentários em `nginx/nginx.conf` para habilitar TLS. Coloque os certificados em `nginx/ssl/` e descomente o bloco HTTPS.

## Variáveis de Ambiente

| Variável | Descrição |
|---|---|
| `NODE_ENV` | `production` ou `development` |
| `ISSUER` | URL base do servidor (ex: `https://auth.camim.com.br`) |
| `DATABASE_URL` | Gerada automaticamente pelo compose |
| `REDIS_URL` | Gerada automaticamente pelo compose |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL |
| `COOKIE_SECRET` | Segredo para assinar cookies (`openssl rand -hex 32`) |
| `ADMIN_API_KEY` | Chave da Admin API (`openssl rand -hex 32`) |
| `ADMIN_EMAIL` | E-mail do admin inicial |
| `ADMIN_PASSWORD` | Senha do admin inicial |
