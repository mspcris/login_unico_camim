# Como integrar um sistema com o Login Único Camim

O Login Único Camim é um servidor **OAuth2/OIDC**. Qualquer sistema pode usar o login dos usuários `@camim` sem precisar gerenciar senhas próprias.

---

## Visão geral do fluxo

```
Usuário clica "Entrar com Camim"
        │
        ▼
Seu sistema redireciona → auth.camim.com.br/authorize
        │
        ▼
Usuário digita email e senha (na página do Camim)
        │
        ▼
Camim redireciona de volta → seu sistema com um código
        │
        ▼
Seu sistema troca o código por tokens
        │
        ▼
Seu sistema usa o token para buscar os dados do usuário
```

---

## Passo 1 — Registrar seu sistema como cliente

Peça ao administrador do Camim para registrar seu sistema. Ele rodará:

```bash
curl -X POST https://auth.camim.com.br/admin/clients \
  -H "x-admin-api-key: CHAVE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Nome do Seu Sistema",
    "redirect_uris": ["https://seusistema.com.br/auth/callback"]
  }'
```

A resposta retorna:

```json
{
  "client_id": "camim_abc123...",
  "client_secret": "def456...",
  "message": "Guarde o client_secret - ele não será exibido novamente."
}
```

Guarde o `client_id` e o `client_secret` — você vai usar nos próximos passos.

---

## Passo 2 — Redirecionar o usuário para o login

Quando o usuário clicar em "Entrar com Camim", redirecione para:

```
https://auth.camim.com.br/authorize
  ?client_id=SEU_CLIENT_ID
  &redirect_uri=https://seusistema.com.br/auth/callback
  &response_type=code
  &scope=openid profile email
  &state=VALOR_ALEATORIO
```

**Parâmetros:**

| Parâmetro | Descrição |
|---|---|
| `client_id` | ID recebido no Passo 1 |
| `redirect_uri` | URL do seu sistema que receberá o código (deve ser exatamente a cadastrada) |
| `response_type` | Sempre `code` |
| `scope` | Dados que você quer acessar: `openid` (obrigatório), `profile` (nome), `email` |
| `state` | Valor aleatório gerado por você para evitar CSRF — salve na sessão para verificar depois |

---

## Passo 3 — Receber o código de autorização

Após o login, o Camim redireciona para sua `redirect_uri`:

```
https://seusistema.com.br/auth/callback?code=CODIGO&state=VALOR_ALEATORIO
```

Verifique que o `state` bate com o que você salvou na sessão. Então troque o `code` por tokens.

---

## Passo 4 — Trocar o código por tokens

Faça uma requisição **POST** do seu backend (nunca do frontend):

```bash
curl -X POST https://auth.camim.com.br/token \
  -u "SEU_CLIENT_ID:SEU_CLIENT_SECRET" \
  -d "grant_type=authorization_code" \
  -d "code=CODIGO_RECEBIDO" \
  -d "redirect_uri=https://seusistema.com.br/auth/callback"
```

Resposta:

```json
{
  "access_token": "eyJ...",
  "id_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

## Passo 5 — Buscar os dados do usuário

```bash
curl https://auth.camim.com.br/me \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

Resposta:

```json
{
  "sub": "uuid-do-usuario",
  "email": "cristiano@camim.com.br",
  "name": "Cristiano",
  "email_verified": true
}
```

Use o campo `sub` (identificador único) para associar o usuário no seu banco de dados.

---

## Scopes disponíveis

| Scope | Campos retornados |
|---|---|
| `openid` | `sub` (obrigatório) |
| `email` | `email`, `email_verified` |
| `profile` | `name`, `given_name`, `family_name`, `picture` |
| `phone` | `phone_number` |

---

## Exemplos por linguagem

### Python (Flask)

```python
from flask import redirect, request, session
import requests, secrets, urllib.parse

CLIENT_ID = "camim_abc123"
CLIENT_SECRET = "def456"
REDIRECT_URI = "https://seusistema.com.br/auth/callback"
CAMIM_BASE = "https://auth.camim.com.br"

@app.route("/login")
def login():
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
    }
    url = f"{CAMIM_BASE}/authorize?" + urllib.parse.urlencode(params)
    return redirect(url)

@app.route("/auth/callback")
def callback():
    assert request.args["state"] == session["oauth_state"]
    code = request.args["code"]

    # Trocar código por tokens
    token_resp = requests.post(
        f"{CAMIM_BASE}/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data={"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT_URI},
    ).json()

    # Buscar dados do usuário
    user = requests.get(
        f"{CAMIM_BASE}/me",
        headers={"Authorization": f"Bearer {token_resp['access_token']}"},
    ).json()

    session["user"] = user
    return redirect("/dashboard")
```

### Node.js (Express)

```javascript
const axios = require('axios');
const crypto = require('crypto');

const CLIENT_ID = 'camim_abc123';
const CLIENT_SECRET = 'def456';
const REDIRECT_URI = 'https://seusistema.com.br/auth/callback';
const CAMIM_BASE = 'https://auth.camim.com.br';

app.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile email',
    state,
  });
  res.redirect(`${CAMIM_BASE}/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  if (req.query.state !== req.session.oauthState) return res.status(400).send('State mismatch');

  // Trocar código por tokens
  const { data: tokens } = await axios.post(
    `${CAMIM_BASE}/token`,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      redirect_uri: REDIRECT_URI,
    }),
    { auth: { username: CLIENT_ID, password: CLIENT_SECRET } }
  );

  // Buscar dados do usuário
  const { data: user } = await axios.get(`${CAMIM_BASE}/me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  req.session.user = user;
  res.redirect('/dashboard');
});
```

### PHP

```php
// login.php
$state = bin2hex(random_bytes(16));
$_SESSION['oauth_state'] = $state;
$params = http_build_query([
    'client_id'     => 'camim_abc123',
    'redirect_uri'  => 'https://seusistema.com.br/auth/callback.php',
    'response_type' => 'code',
    'scope'         => 'openid profile email',
    'state'         => $state,
]);
header("Location: https://auth.camim.com.br/authorize?$params");

// callback.php
if ($_GET['state'] !== $_SESSION['oauth_state']) die('State mismatch');

// Trocar código por tokens
$ch = curl_init('https://auth.camim.com.br/token');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_USERPWD => 'camim_abc123:def456',
    CURLOPT_POSTFIELDS => http_build_query([
        'grant_type'   => 'authorization_code',
        'code'         => $_GET['code'],
        'redirect_uri' => 'https://seusistema.com.br/auth/callback.php',
    ]),
]);
$tokens = json_decode(curl_exec($ch), true);

// Buscar dados do usuário
$ch = curl_init('https://auth.camim.com.br/me');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$tokens['access_token']}"],
]);
$user = json_decode(curl_exec($ch), true);

$_SESSION['user'] = $user;
header('Location: /dashboard');
```

---

## Discovery automático

Frameworks e bibliotecas OIDC podem configurar tudo automaticamente usando:

```
https://auth.camim.com.br/.well-known/openid-configuration
```

Se sua biblioteca suporta "OIDC Discovery", basta informar essa URL e ela descobre todos os endpoints sozinha.

---

## Dúvidas frequentes

**O usuário precisa ter conta no meu sistema?**
Não necessariamente. No primeiro login, use o `sub` (UUID) retornado pelo `/me` para criar o usuário automaticamente no seu banco.

**O token expira?**
Sim. O `access_token` dura 1 hora. Se quiser sessões mais longas, solicite o scope `offline_access` para receber também um `refresh_token` (válido por 30 dias).

**Como fazer logout?**
Redirecione para:
```
https://auth.camim.com.br/session/end
  ?post_logout_redirect_uri=https://seusistema.com.br
  &id_token_hint=ID_TOKEN_DO_USUARIO
```
