# Integração com o Login Único Camim (idCamim)

O idCamim é um servidor **OAuth2 / OpenID Connect (OIDC)**. Qualquer sistema pode autenticar usuários `@camim` sem gerenciar senhas próprias — o Camim cuida disso.

---

## Índice

1. [Como funciona o fluxo](#1-como-funciona-o-fluxo)
2. [Endpoints](#2-endpoints)
3. [Registrar seu sistema](#3-registrar-seu-sistema)
4. [Passo a passo de integração](#4-passo-a-passo-de-integração)
5. [Scopes e campos disponíveis](#5-scopes-e-campos-disponíveis)
6. [Exemplos completos por linguagem](#6-exemplos-completos-por-linguagem)
7. [Usando uma biblioteca OIDC (recomendado)](#7-usando-uma-biblioteca-oidc-recomendado)
8. [Logout](#8-logout)
9. [Refresh Token](#9-refresh-token)
10. [Verificar token (introspecção)](#10-verificar-token-introspecção)
11. [Dúvidas frequentes](#11-dúvidas-frequentes)

---

## 1. Como funciona o fluxo

```
Usuário clica "Entrar com Camim" no seu sistema
         │
         ▼
Seu sistema redireciona o navegador para o idCamim
  (https://auth.camim.com.br/auth?client_id=...&...)
         │
         ▼
Usuário digita e-mail e senha na página do Camim
         │
         ▼
idCamim redireciona de volta ao seu sistema com um código
  (https://seusistema.com.br/auth/callback?code=XYZ&state=ABC)
         │
         ▼
Seu backend troca o código por tokens (server-to-server)
  POST https://auth.camim.com.br/token
         │
         ▼
Seu backend busca os dados do usuário com o access_token
  GET https://auth.camim.com.br/me
         │
         ▼
Usuário autenticado — crie a sessão no seu sistema
```

O protocolo usado é **Authorization Code Flow**, o mais seguro para aplicações web com backend.

---

## 2. Endpoints

Todos os endpoints são obtidos automaticamente via Discovery:

```
https://auth.camim.com.br/.well-known/openid-configuration
```

Para referência, os principais são:

| Finalidade | Endpoint |
|---|---|
| Discovery (auto-configuração) | `https://auth.camim.com.br/.well-known/openid-configuration` |
| Autorização (redirecionar usuário) | `https://auth.camim.com.br/auth` |
| Token (trocar código) | `https://auth.camim.com.br/token` |
| Dados do usuário | `https://auth.camim.com.br/me` |
| Logout | `https://auth.camim.com.br/session/end` |
| Chaves públicas (verificar JWT) | `https://auth.camim.com.br/jwks` |
| Introspecção de token | `https://auth.camim.com.br/token/introspection` |
| Revogação de token | `https://auth.camim.com.br/token/revocation` |

> **Atenção:** O endpoint de autorização é `/auth`, não `/authorize`.

---

## 3. Registrar seu sistema

Antes de integrar, seu sistema precisa estar registrado no idCamim como um **cliente OAuth2**. Isso gera um `client_id` e um `client_secret`.

### Opção A — Via Painel Admin (recomendado)

Acesse [https://auth.camim.com.br/painel](https://auth.camim.com.br/painel), vá em **Sistemas** e clique em **Registrar novo sistema**. Preencha:

- **Nome do sistema:** nome legível (ex: `Portal RH`)
- **URL de callback (redirect_uri):** URL do seu sistema que receberá o código após o login (ex: `https://seusistema.com.br/auth/callback`)
- **URL pós-logout** *(opcional)*: para onde redirecionar após o logout
- **Descrição** *(opcional)*

O painel exibirá o `client_id` e o `client_secret` **uma única vez**. Copie e guarde com segurança — o secret não pode ser recuperado depois.

### Opção B — Via cURL (para o admin)

Envie as informações abaixo para o administrador do Camim e ele devolve as credenciais:

```
Sistema: Nome do sistema
redirect_uri: https://seusistema.com.br/auth/callback
post_logout_uri: https://seusistema.com.br (opcional)
Descrição: Breve descrição (opcional)
```

Ou, se você tiver acesso à chave de API administrativa:

```bash
curl -X POST https://auth.camim.com.br/admin/clients \
  -H "x-admin-api-key: SUA_CHAVE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Nome do Sistema",
    "redirect_uris": ["https://seusistema.com.br/auth/callback"],
    "post_logout_redirect_uris": ["https://seusistema.com.br"],
    "description": "Descrição do sistema"
  }'
```

Resposta:

```json
{
  "client_id": "camim_a1b2c3d4e5f6g7h8",
  "client_secret": "abc123def456...",
  "client_name": "Nome do Sistema",
  "redirect_uris": ["https://seusistema.com.br/auth/callback"]
}
```

> O `client_secret` **não é armazenado em texto puro** — guarde imediatamente, pois não será possível recuperá-lo.

---

## 4. Passo a passo de integração

Com `client_id` e `client_secret` em mãos, siga os passos abaixo.

### Passo 4.1 — Redirecionar o usuário para o login

Monte a URL de autorização e redirecione o navegador do usuário para ela:

```
https://auth.camim.com.br/auth
  ?client_id=camim_SEU_CLIENT_ID
  &redirect_uri=https://seusistema.com.br/auth/callback
  &response_type=code
  &scope=openid profile email
  &state=VALOR_ALEATORIO_GERADO_POR_VOCE
```

**Parâmetros obrigatórios:**

| Parâmetro | Valor | Descrição |
|---|---|---|
| `client_id` | `camim_...` | ID do seu sistema |
| `redirect_uri` | URL cadastrada | Deve ser exatamente igual à cadastrada no registro |
| `response_type` | `code` | Sempre `code` para Authorization Code Flow |
| `scope` | `openid profile email` | Dados que você quer acessar (veja seção 5) |
| `state` | string aleatória | Gerado por você; salve na sessão para verificar depois (proteção CSRF) |

**Parâmetros opcionais:**

| Parâmetro | Valor | Descrição |
|---|---|---|
| `code_challenge` | string | Para PKCE (S256 ou plain); recomendado em SPAs |
| `code_challenge_method` | `S256` | Algoritmo do PKCE |

Via curl (apenas para teste — nunca faça isso pelo navegador):

```bash
# Apenas para visualizar — em produção é um redirect do navegador
curl -v "https://auth.camim.com.br/auth?client_id=camim_SEU_CLIENT_ID&redirect_uri=https://seusistema.com.br/auth/callback&response_type=code&scope=openid%20profile%20email&state=abc123"
```

---

### Passo 4.2 — Receber o código de autorização

Após o login bem-sucedido, o idCamim redireciona o navegador para sua `redirect_uri`:

```
https://seusistema.com.br/auth/callback?code=CODIGO_AQUI&state=VALOR_ALEATORIO&iss=https://auth.camim.com.br
```

No seu handler de callback:

1. **Verifique o `state`** — compare com o valor salvo na sessão. Se não bater, rejeite a requisição (ataque CSRF).
2. **Capture o `code`** — use no próximo passo. O código expira em **10 minutos** e só pode ser usado **uma vez**.

Em caso de erro (usuário recusou, cliente inválido, etc.), o idCamim redireciona com:

```
https://seusistema.com.br/auth/callback?error=access_denied&error_description=...
```

Sempre trate o parâmetro `error` no callback.

---

### Passo 4.3 — Trocar o código por tokens

Faça esta requisição **do seu backend** (nunca exponha o `client_secret` no frontend):

```bash
curl -X POST https://auth.camim.com.br/token \
  -u "camim_SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=CODIGO_RECEBIDO" \
  -d "redirect_uri=https://seusistema.com.br/auth/callback"
```

A autenticação é via **HTTP Basic Auth** (`-u client_id:client_secret`), que o curl codifica automaticamente em Base64 no header `Authorization`.

Resposta de sucesso:

```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

| Campo | Descrição |
|---|---|
| `access_token` | Token opaco para acessar `/me`. Dura **1 hora**. |
| `id_token` | JWT assinado (ES256) com dados básicos do usuário. |
| `token_type` | Sempre `Bearer` |
| `expires_in` | Segundos até o `access_token` expirar (3600 = 1h) |
| `refresh_token` | Só presente se o scope `offline_access` foi solicitado (veja seção 9) |

---

### Passo 4.4 — Buscar os dados do usuário

```bash
curl https://auth.camim.com.br/me \
  -H "Authorization: Bearer SEU_ACCESS_TOKEN"
```

Resposta (com scopes `openid profile email`):

```json
{
  "sub": "52664cd8-6976-4c76-ae81-a7c2ae9adee5",
  "email": "cristiano@camim.com.br",
  "email_verified": true,
  "name": "Cristiano Camim",
  "given_name": "Cristiano",
  "family_name": "Camim",
  "picture": null,
  "updated_at": 1742598000
}
```

> **Use sempre o `sub` como identificador do usuário no seu banco de dados.** O `sub` é um UUID único e imutável por usuário. O e-mail pode mudar; o `sub` nunca muda.

---

## 5. Scopes e campos disponíveis

Informe os scopes no parâmetro `scope` da URL de autorização, separados por espaço.

| Scope | Campos retornados | Obrigatório? |
|---|---|---|
| `openid` | `sub` (UUID do usuário), `iss`, `aud`, `exp`, `iat` | **Sim** — sempre inclua |
| `email` | `email`, `email_verified` | Não |
| `profile` | `name`, `given_name`, `family_name`, `picture`, `updated_at` | Não |
| `phone` | `phone_number` | Não |
| `offline_access` | Gera `refresh_token` junto com o `access_token` | Não |

Exemplo com todos os scopes:

```
scope=openid profile email phone offline_access
```

---

## 6. Exemplos completos por linguagem

### Python (Flask + Requests)

```python
import secrets
import urllib.parse
import requests
from flask import Flask, redirect, request, session

app = Flask(__name__)
app.secret_key = "sua-secret-key-aqui"

CLIENT_ID     = "camim_SEU_CLIENT_ID"
CLIENT_SECRET = "SEU_CLIENT_SECRET"
REDIRECT_URI  = "https://seusistema.com.br/auth/callback"
CAMIM_BASE    = "https://auth.camim.com.br"


@app.route("/login")
def login():
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state

    params = urllib.parse.urlencode({
        "client_id":     CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid profile email",
        "state":         state,
    })
    return redirect(f"{CAMIM_BASE}/auth?{params}")


@app.route("/auth/callback")
def callback():
    # 1. Verificar erro retornado pelo idCamim
    if "error" in request.args:
        return f"Erro de autenticação: {request.args['error_description']}", 400

    # 2. Verificar state (proteção CSRF)
    if request.args.get("state") != session.pop("oauth_state", None):
        return "State inválido", 400

    code = request.args["code"]

    # 3. Trocar código por tokens
    token_resp = requests.post(
        f"{CAMIM_BASE}/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": REDIRECT_URI,
        },
    )
    token_resp.raise_for_status()
    tokens = token_resp.json()

    # 4. Buscar dados do usuário
    user_resp = requests.get(
        f"{CAMIM_BASE}/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    user_resp.raise_for_status()
    user = user_resp.json()

    # 5. Salvar na sessão e redirecionar
    session["user"] = {
        "id":    user["sub"],       # UUID imutável — use como FK no seu banco
        "email": user["email"],
        "name":  user.get("name"),
    }
    return redirect("/dashboard")


@app.route("/logout")
def logout():
    id_token = session.get("id_token", "")
    session.clear()
    params = urllib.parse.urlencode({
        "post_logout_redirect_uri": "https://seusistema.com.br",
        "id_token_hint": id_token,
    })
    return redirect(f"{CAMIM_BASE}/session/end?{params}")
```

---

### Node.js (Express)

```javascript
const express  = require('express');
const axios    = require('axios');
const crypto   = require('crypto');
const session  = require('express-session');

const app = express();
app.use(session({ secret: 'sua-secret-key', resave: false, saveUninitialized: false }));

const CLIENT_ID     = 'camim_SEU_CLIENT_ID';
const CLIENT_SECRET = 'SEU_CLIENT_SECRET';
const REDIRECT_URI  = 'https://seusistema.com.br/auth/callback';
const CAMIM_BASE    = 'https://auth.camim.com.br';


app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'openid profile email',
    state,
  });
  res.redirect(`${CAMIM_BASE}/auth?${params}`);
});


app.get('/auth/callback', async (req, res) => {
  // 1. Verificar erro
  if (req.query.error) {
    return res.status(400).send(`Erro: ${req.query.error_description}`);
  }

  // 2. Verificar state
  if (req.query.state !== req.session.oauthState) {
    return res.status(400).send('State inválido');
  }
  delete req.session.oauthState;

  try {
    // 3. Trocar código por tokens
    const tokenResp = await axios.post(
      `${CAMIM_BASE}/token`,
      new URLSearchParams({
        grant_type:   'authorization_code',
        code:         req.query.code,
        redirect_uri: REDIRECT_URI,
      }),
      {
        auth: { username: CLIENT_ID, password: CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    const tokens = tokenResp.data;

    // 4. Buscar dados do usuário
    const userResp = await axios.get(`${CAMIM_BASE}/me`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = userResp.data;

    // 5. Salvar na sessão
    req.session.user = {
      id:    user.sub,
      email: user.email,
      name:  user.name,
    };
    req.session.idToken = tokens.id_token; // guarde para o logout

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Erro no callback:', err.response?.data || err.message);
    res.status(500).send('Erro na autenticação');
  }
});


app.get('/logout', (req, res) => {
  const idToken = req.session.idToken || '';
  req.session.destroy();
  const params = new URLSearchParams({
    post_logout_redirect_uri: 'https://seusistema.com.br',
    id_token_hint: idToken,
  });
  res.redirect(`${CAMIM_BASE}/session/end?${params}`);
});
```

---

### PHP

```php
<?php
// config.php
define('CLIENT_ID',     'camim_SEU_CLIENT_ID');
define('CLIENT_SECRET', 'SEU_CLIENT_SECRET');
define('REDIRECT_URI',  'https://seusistema.com.br/auth/callback.php');
define('CAMIM_BASE',    'https://auth.camim.com.br');
```

```php
<?php
// login.php
require 'config.php';
session_start();

$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;

$params = http_build_query([
    'client_id'     => CLIENT_ID,
    'redirect_uri'  => REDIRECT_URI,
    'response_type' => 'code',
    'scope'         => 'openid profile email',
    'state'         => $state,
]);
header('Location: ' . CAMIM_BASE . '/auth?' . $params);
exit;
```

```php
<?php
// callback.php
require 'config.php';
session_start();

// 1. Verificar erro
if (isset($_GET['error'])) {
    die('Erro de autenticação: ' . htmlspecialchars($_GET['error_description']));
}

// 2. Verificar state
if (!isset($_GET['state']) || $_GET['state'] !== $_SESSION['oauth_state']) {
    die('State inválido');
}
unset($_SESSION['oauth_state']);

$code = $_GET['code'];

// 3. Trocar código por tokens
$ch = curl_init(CAMIM_BASE . '/token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_USERPWD        => CLIENT_ID . ':' . CLIENT_SECRET,
    CURLOPT_POSTFIELDS     => http_build_query([
        'grant_type'   => 'authorization_code',
        'code'         => $code,
        'redirect_uri' => REDIRECT_URI,
    ]),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
]);
$tokens = json_decode(curl_exec($ch), true);
curl_close($ch);

if (!isset($tokens['access_token'])) {
    die('Falha ao obter token: ' . json_encode($tokens));
}

// 4. Buscar dados do usuário
$ch = curl_init(CAMIM_BASE . '/me');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $tokens['access_token']],
]);
$user = json_decode(curl_exec($ch), true);
curl_close($ch);

// 5. Salvar na sessão
$_SESSION['user'] = [
    'id'    => $user['sub'],
    'email' => $user['email'],
    'name'  => $user['name'] ?? null,
];
$_SESSION['id_token'] = $tokens['id_token'];

header('Location: /dashboard.php');
exit;
```

```php
<?php
// logout.php
require 'config.php';
session_start();
$idToken = $_SESSION['id_token'] ?? '';
session_destroy();
$params = http_build_query([
    'post_logout_redirect_uri' => 'https://seusistema.com.br',
    'id_token_hint'            => $idToken,
]);
header('Location: ' . CAMIM_BASE . '/session/end?' . $params);
exit;
```

---

### Django (Python — usando `authlib`)

```bash
pip install authlib requests django
```

```python
# settings.py
IDCAMIM = {
    "CLIENT_ID":     "camim_SEU_CLIENT_ID",
    "CLIENT_SECRET": "SEU_CLIENT_SECRET",
    "REDIRECT_URI":  "https://seusistema.com.br/auth/callback",
    "DISCOVERY_URL": "https://auth.camim.com.br/.well-known/openid-configuration",
    "SCOPES":        "openid profile email",
}
```

```python
# views.py
import secrets
from django.conf import settings
from django.shortcuts import redirect
from django.http import HttpResponse
from authlib.integrations.requests_client import OAuth2Session

conf = settings.IDCAMIM


def login(request):
    state = secrets.token_urlsafe(16)
    request.session["oauth_state"] = state

    client = OAuth2Session(conf["CLIENT_ID"], redirect_uri=conf["REDIRECT_URI"], scope=conf["SCOPES"])
    # Descobre os endpoints via discovery
    server_meta = client.get(conf["DISCOVERY_URL"]).json()

    auth_url, _ = client.create_authorization_url(
        server_meta["authorization_endpoint"], state=state
    )
    return redirect(auth_url)


def callback(request):
    if "error" in request.GET:
        return HttpResponse(f"Erro: {request.GET['error_description']}", status=400)

    if request.GET.get("state") != request.session.pop("oauth_state", None):
        return HttpResponse("State inválido", status=400)

    client = OAuth2Session(conf["CLIENT_ID"], redirect_uri=conf["REDIRECT_URI"])
    server_meta = client.get(conf["DISCOVERY_URL"]).json()

    tokens = client.fetch_token(
        server_meta["token_endpoint"],
        code=request.GET["code"],
        client_secret=conf["CLIENT_SECRET"],
    )
    user = client.get(server_meta["userinfo_endpoint"]).json()

    request.session["user"] = {
        "id":    user["sub"],
        "email": user["email"],
        "name":  user.get("name"),
    }
    return redirect("/dashboard/")
```

---

## 7. Usando uma biblioteca OIDC (recomendado)

Se sua linguagem ou framework tem suporte a OIDC, use a **Discovery URL** — a biblioteca configura todos os endpoints automaticamente:

```
https://auth.camim.com.br/.well-known/openid-configuration
```

| Linguagem / Framework | Biblioteca recomendada |
|---|---|
| Python / Django | `authlib`, `mozilla-django-oidc` |
| Python / Flask | `authlib`, `flask-oidc` |
| Node.js / Express | `openid-client`, `passport-openidconnect` |
| Node.js / Next.js | `next-auth` (provider: Custom OIDC) |
| PHP / Laravel | `league/oauth2-client`, `socialite` |
| PHP / Symfony | `knpuniversity/oauth2-client-bundle` |
| Java / Spring | `spring-security-oauth2-client` |
| .NET | `Microsoft.AspNetCore.Authentication.OpenIdConnect` |

### Exemplo — Next.js com NextAuth

```javascript
// pages/api/auth/[...nextauth].js
import NextAuth from "next-auth";

export default NextAuth({
  providers: [
    {
      id: "idcamim",
      name: "Camim",
      type: "oauth",
      wellKnown: "https://auth.camim.com.br/.well-known/openid-configuration",
      clientId: process.env.IDCAMIM_CLIENT_ID,
      clientSecret: process.env.IDCAMIM_CLIENT_SECRET,
      authorization: { params: { scope: "openid profile email" } },
      idToken: true,
      checks: ["state"],
      profile(profile) {
        return {
          id:    profile.sub,
          name:  profile.name,
          email: profile.email,
        };
      },
    },
  ],
});
```

```env
# .env.local
IDCAMIM_CLIENT_ID=camim_SEU_CLIENT_ID
IDCAMIM_CLIENT_SECRET=SEU_CLIENT_SECRET
NEXTAUTH_SECRET=outra-chave-aleatoria
NEXTAUTH_URL=https://seusistema.com.br
```

---

## 8. Logout

Para encerrar tanto a sessão no seu sistema quanto no idCamim, redirecione para:

```
https://auth.camim.com.br/session/end
  ?id_token_hint=ID_TOKEN_DO_USUARIO
  &post_logout_redirect_uri=https://seusistema.com.br
```

| Parâmetro | Descrição |
|---|---|
| `id_token_hint` | O `id_token` recebido no passo 4.3. Identifica a sessão a encerrar. |
| `post_logout_redirect_uri` | Para onde redirecionar após o logout. Deve ser a URL pós-logout cadastrada. |

Destrua a sessão local **antes** de redirecionar para o idCamim.

---

## 9. Refresh Token

Se você precisar de sessões longas (> 1 hora), solicite o scope `offline_access`:

```
scope=openid profile email offline_access
```

O idCamim retornará um `refresh_token` junto com o `access_token`. Use-o para renovar sem exigir novo login:

```bash
curl -X POST https://auth.camim.com.br/token \
  -u "camim_SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=SEU_REFRESH_TOKEN"
```

Resposta: novo `access_token` e `refresh_token`.

| Token | Validade |
|---|---|
| `access_token` | 1 hora |
| `refresh_token` | 30 dias |
| Sessão do usuário no idCamim | 14 dias |

---

## 10. Verificar token (introspecção)

Para validar se um `access_token` ainda é válido (útil em microsserviços):

```bash
curl -X POST https://auth.camim.com.br/token/introspection \
  -u "camim_SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=ACCESS_TOKEN_A_VERIFICAR"
```

Resposta (token válido):

```json
{
  "active": true,
  "sub": "52664cd8-6976-4c76-ae81-a7c2ae9adee5",
  "client_id": "camim_SEU_CLIENT_ID",
  "scope": "openid profile email",
  "exp": 1742601600
}
```

Resposta (token inválido ou expirado):

```json
{ "active": false }
```

Para revogar um token manualmente:

```bash
curl -X POST https://auth.camim.com.br/token/revocation \
  -u "camim_SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=ACCESS_TOKEN"
```

---

## 11. Dúvidas frequentes

**O usuário precisa ter conta no meu sistema?**
Não necessariamente. No primeiro login, use o `sub` retornado pelo `/me` para criar o registro automaticamente no seu banco. Associe sempre pelo `sub`, não pelo e-mail.

**O que é o `sub`?**
Um UUID único e imutável por usuário. Use-o como chave estrangeira no seu banco de dados. Exemplo: `52664cd8-6976-4c76-ae81-a7c2ae9adee5`.

**Posso confiar no e-mail retornado?**
Sim — `email_verified: true` indica que o e-mail foi verificado pelo Camim. Mas use o `sub` como identificador principal, pois e-mails podem mudar.

**Por que a troca de código deve ser feita no backend?**
Porque exige o `client_secret`. Se feita no frontend (JavaScript no navegador), o secret ficaria exposto a qualquer pessoa. Nunca envie o `client_secret` ao navegador.

**O token expirou — o que fazer?**
Se você solicitou `offline_access`, use o `refresh_token` (veja seção 9). Se não, redirecione o usuário para o login novamente. Como o idCamim mantém sessão por 14 dias, na maioria dos casos o re-login é transparente (sem digitar senha).

**Posso usar PKCE?**
Sim. O idCamim suporta `S256` e `plain`. PKCE é recomendado especialmente para SPAs (Single Page Applications) e apps mobile, onde não é possível guardar um `client_secret` com segurança.

**Meu sistema não tem backend — como faço?**
Use PKCE sem `client_secret` (`token_endpoint_auth_method: none`). Registre o sistema informando que não há secret. Mas atenção: SPAs devem usar bibliotecas como `oidc-client-ts` que gerenciam o PKCE automaticamente.

**Qual `Content-Type` usar no endpoint `/token`?**
`application/x-www-form-urlencoded` — não JSON. O curl faz isso automaticamente com `-d`.

**O idCamim só aceita usuários `@camim`?**
Somente usuários cujos e-mails pertencem a domínios autorizados pelo administrador. O cadastro de novos domínios é feito em [https://auth.camim.com.br/painel/dominios](https://auth.camim.com.br/painel/dominios).
