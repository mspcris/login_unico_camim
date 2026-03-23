'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '465', 10),
  secure: true, // SSL
  auth: {
    user: process.env.EMAIL_HOST_USER || 'tarefas@camim.com.br',
    pass: process.env.EMAIL_HOST_PASSWORD || 'dakhchgbmkkczxve',
  },
});

const DEFAULT_FROM = process.env.DEFAULT_FROM_EMAIL || 'tarefas@camim.com.br';

/**
 * Sends an account activation email with a link to set the password.
 * @param {string} email - Recipient email address
 * @param {string} name - Recipient name (or email if name not set yet)
 * @param {string} activationUrl - Full URL to the activation page
 */
async function sendActivationEmail(email, name, activationUrl) {
  const displayName = name || email;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6; margin: 0; padding: 24px;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.07);">
    <div style="text-align: center; margin-bottom: 24px;">
      <span style="font-size: 28px; font-weight: 700; color: #1a56db;">Camim</span>
    </div>
    <h1 style="font-size: 20px; font-weight: 600; color: #111827; margin-bottom: 12px;">Bem-vindo ao Login Único Camim</h1>
    <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin-bottom: 8px;">Olá, <strong style="color: #111827;">${displayName}</strong>!</p>
    <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">
      Você foi convidado a criar seu <strong style="color: #111827;">idCamim</strong>, a identidade unificada de acesso aos sistemas Camim.
      Clique no botão abaixo para definir sua senha e ativar sua conta.
    </p>
    <div style="text-align: center; margin-bottom: 28px;">
      <a href="${activationUrl}"
         style="display: inline-block; background: #1a56db; color: #ffffff; text-decoration: none;
                padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
        Criar meu idCamim
      </a>
    </div>
    <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin-bottom: 8px;">
      Este link é válido por <strong>72 horas</strong>. Se você não solicitou este convite, ignore este e-mail.
    </p>
    <p style="color: #9ca3af; font-size: 12px;">
      Ou copie e cole este link no navegador:<br />
      <span style="color: #6b7280; word-break: break-all;">${activationUrl}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    <p style="color: #9ca3af; font-size: 12px; text-align: center;">Login Único Camim &mdash; Acesso seguro e centralizado</p>
  </div>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: `"Login Único Camim" <${DEFAULT_FROM}>`,
    to: email,
    subject: 'Crie seu idCamim — Convite de ativação',
    html,
    text: `Olá ${displayName}!\n\nVocê foi convidado a criar seu idCamim.\nAcesse o link abaixo para definir sua senha:\n\n${activationUrl}\n\nEste link é válido por 72 horas.\n\nLogin Único Camim`,
  });

  console.log(`[Email] Activation email sent to ${email}`);
}

module.exports = { sendActivationEmail };
