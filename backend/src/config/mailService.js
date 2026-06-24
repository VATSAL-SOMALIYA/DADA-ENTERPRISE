/**
 * @file mailService.js
 * @description Centralized module for sending transactional emails (e.g. OTP codes, account verification).
 * Supports SMTP transport via Nodemailer or falls back to console logging in development modes.
 */

const nodemailer = require("nodemailer");

/**
 * Sends a transactional email.
 * If SMTP credentials exist in environment variables, runs real SMTP delivery.
 * If not, falls back to logging email content to the console (useful for dev/test).
 * 
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject line.
 * @param {string} text - Email plain-text content.
 * @returns {Promise<void>}
 */
async function sendMail(to, subject, text) {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"DADA Enterprise" <noreply@dadaenterprise.com>',
        to,
        subject,
        text,
      });
      console.log(`✅ Email sent successfully to ${to}`);
    } catch (err) {
      console.error(`❌ SMTP send failed: ${err.message}`);
      console.log("\n================ [SMTP FALLBACK] ================");
      console.log(`✉️  EMAIL TO: ${to}`);
      console.log(`📋 SUBJECT: ${subject}`);
      console.log(`📝 CONTENT:\n${text}`);
      console.log("==================================================\n");
    }
  } else {
    // Console fallback for local offline testing
    console.log("\n==================================================");
    console.log(`✉️  EMAIL TO: ${to}`);
    console.log(`📋 SUBJECT: ${subject}`);
    console.log(`📝 CONTENT:\n${text}`);
    console.log("==================================================\n");
  }
}

module.exports = { sendMail };
