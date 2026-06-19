const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// Test the connection when the app starts
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Error acquiring client from database", err.stack);
  } else {
    console.log("✅ Database connected successfully!");
  }
  if (release) release();
});

// We export the pool directly so seed.js and your controllers can use pool.query()
module.exports = pool;