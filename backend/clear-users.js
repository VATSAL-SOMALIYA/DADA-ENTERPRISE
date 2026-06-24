const pool = require("./src/config/db");
const initDb = require("./src/config/initDb");

async function clear() {
  await initDb();
  console.log("Purging all users from database...");
  try {
    await pool.query("TRUNCATE TABLE users CASCADE");
    console.log("✅ Users table cleared successfully!");
  } catch (err) {
    console.error("❌ Database Error:", err.message);
  } finally {
    process.exit();
  }
}

clear();
