import nodemailer from 'nodemailer';

export interface EmailSendResult {
  deliveredViaSmtp: boolean;
  devOtpPreview?: string;
}

function getSmtpTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

export async function sendVerificationOtpEmail(
  recipientEmail: string,
  otpCode: string,
  purpose: 'register' | 'reset'
): Promise<EmailSendResult> {
  const subject =
    purpose === 'register'
      ? 'NEXORA — Verify your email address'
      : 'NEXORA — Password reset verification code';

  const heading =
    purpose === 'register'
      ? 'Welcome to NEXORA'
      : 'Reset your NEXORA password';

  const transporter = getSmtpTransporter();
  if (transporter) {
    const from = process.env.SMTP_FROM || 'NEXORA Security <no-reply@nexora.app>';
    await transporter.sendMail({
      from,
      to: recipientEmail,
      subject,
      text: `${heading}\n\nYour 6-digit NEXORA verification code is: ${otpCode}\n\nThis code expires in 10 minutes. Never share it with anyone.`,
      html: `
        <div style="font-family: 'DM Sans', Arial, sans-serif; background:#070913; color:#f1f5f9; padding:32px; border-radius:16px; max-width:480px; margin:0 auto;">
          <h2 style="margin:0 0 12px; color:#a78bfa;">NEXORA</h2>
          <p style="margin:0 0 20px; color:#cbd5e1;">${heading}. Enter this 6-digit verification code to continue:</p>
          <div style="font-size:32px; font-weight:700; letter-spacing:8px; color:#22d3ee; background:#11162b; padding:16px 24px; border-radius:12px; text-align:center; border:1px solid rgba(139,92,246,0.35);">
            ${otpCode}
          </div>
          <p style="margin:20px 0 0; font-size:12px; color:#94a3b8;">This code expires in 10 minutes. If you did not request this code, you can ignore this email.</p>
        </div>
      `,
    });
    return { deliveredViaSmtp: true };
  }

  // Development / Sandbox fallback when SMTP credentials are not configured
  console.info(`[NEXORA Email OTP][${purpose}] To=${recipientEmail} Code=${otpCode}`);
  const isProd = process.env.NODE_ENV === 'production';
  return {
    deliveredViaSmtp: false,
    ...(isProd ? {} : { devOtpPreview: otpCode }),
  };
}
