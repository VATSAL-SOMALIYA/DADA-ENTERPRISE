/**
 * @file mailService.js
 * @description Centralized module for sending transactional emails (e.g. OTP codes, account verification).
 * Supports Resend API (HTTP-based, works on Render free tier), SMTP, or falls back to console logging.
 */

const nodemailer = require("nodemailer");

/**
 * Sends a transactional email.
 * 1. Checks if RESEND_API_KEY exists (highly recommended for Render Free tier as standard SMTP is blocked).
 * 2. Checks if SMTP credentials exist in environment variables (uses 5s connection timeout).
 * 3. Falls back to logging email content to the console (useful for local dev/test).
 * 
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject line.
 * @param {string} text - Email plain-text content.
 * @returns {Promise<void>}
 */
async function sendMail(to, subject, text) {
  // Option 1: Resend HTTP API (Outbound HTTP port 443 is NOT blocked by Render Free tier)
  if (process.env.RESEND_API_KEY) {
    try {
      console.log(`✉️ Sending email via Resend API to ${to}...`);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.SMTP_FROM || 'onboarding@resend.dev',
          to: to,
          subject: subject,
          text: text,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Resend API returned status ${response.status}: ${errText}`);
      }

      console.log(`✅ Email sent successfully via Resend to ${to}`);
      return;
    } catch (err) {
      console.error(`❌ Resend send failed: ${err.message}`);
      // Fall through to SMTP or console log
    }
  }

  // Option 2: SMTP Mailer (Requires SMTP ports 587/465 to be open; will time out in 5s if blocked)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      console.log(`✉️ Sending email via SMTP to ${to}...`);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 5000, // 5 seconds timeout to prevent hanging on blocked ports
        socketTimeout: 5000,
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"DADA Enterprise" <noreply@dadaenterprise.com>',
        to,
        subject,
        text,
      });
      console.log(`✅ Email sent successfully via SMTP to ${to}`);
      return;
    } catch (err) {
      console.error(`❌ SMTP send failed (timeout or error): ${err.message}`);
      // Fall through to console fallback
    }
  }

  // Option 3: Console fallback
  console.log("\n================ [EMAIL FALLBACK LOG] ================");
  console.log(`✉️  EMAIL TO: ${to}`);
  console.log(`📋 SUBJECT: ${subject}`);
  console.log(`📝 CONTENT:\n${text}`);
  console.log("======================================================\n");
}

module.exports = { sendMail };
