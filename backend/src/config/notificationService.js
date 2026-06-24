/**
 * @file notificationService.js
 * @description Notification service facilitating Text Message (SMS) and WhatsApp deliveries.
 * Connects with Twilio API if credentials are provided in .env, otherwise defaults to a rich console-drawn UI mockup.
 */

/**
 * Renders a visually formatted message container in the terminal stdout.
 * Simulates a mobile phone display frame for high-visibility debugging.
 * 
 * @param {string} title - Box header title (e.g. SMS vs WhatsApp).
 * @param {string} to - Destination phone number.
 * @param {string} message - Text body of the message.
 * @returns {void}
 */
function formatLogBox(title, to, message) {
  const lines = message.split("\n");
  const width = Math.max(title.length + 10, to.length + 6, ...lines.map((l) => l.length)) + 4;
  const border = "═".repeat(width);
  
  console.log(`\n╔${border}╗`);
  console.log(`║ ${title.padEnd(width - 2)} ║`);
  console.log(`╠${border}╣`);
  console.log(`║ TO: ${to.padEnd(width - 6)} ║`);
  console.log(`╠${border}╣`);
  lines.forEach((line) => {
    console.log(`║ ${line.padEnd(width - 2)} ║`);
  });
  console.log(`╚${border}╝\n`);
}

/**
 * Dispatches a Text Message (SMS).
 * Runs real Twilio SMS if keys are loaded, otherwise logs mockup box to the console.
 * 
 * @param {string} to - Recipient phone number (E.164 format).
 * @param {string} message - Message text body.
 * @returns {Promise<void>}
 */
async function sendSms(to, message) {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require("twilio");
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: to
      });
      console.log(`✅ Real SMS sent to ${to}`);
      return;
    } catch (err) {
      console.error(`❌ Twilio SMS failed: ${err.message}`);
    }
  }

  formatLogBox("📱 TEXT MESSAGE (SMS)", to, message);
}

/**
 * Dispatches a WhatsApp Message.
 * Runs real Twilio WhatsApp API if keys are loaded, otherwise logs mockup box to the console.
 * 
 * @param {string} to - Recipient phone number (E.164 format).
 * @param {string} message - Message text body.
 * @returns {Promise<void>}
 */
async function sendWhatsapp(to, message) {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require("twilio");
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER || "+14155238886"}`,
        to: `whatsapp:${to}`
      });
      console.log(`✅ Real WhatsApp sent to ${to}`);
      return;
    } catch (err) {
      console.error(`❌ Twilio WhatsApp failed: ${err.message}`);
    }
  }

  formatLogBox("💬 WHATSAPP MESSAGE", to, message);
}

module.exports = { sendSms, sendWhatsapp };
