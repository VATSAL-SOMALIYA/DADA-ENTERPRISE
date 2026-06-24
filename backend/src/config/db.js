/**
 * @file db.js
 * @description Database configuration file initializing the PostgreSQL Connection Pool.
 * Leverages variables from environment configuration (.env).
 */

require("dotenv").config();
const { Pool } = require("pg");

/**
 * PostgreSQL connection pool configuration.
 * Reuses connections across HTTP requests to improve performance and resource management.
 * @type {Pool}
 */
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// Immediately verify connection credentials when the application starts
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Database connection error - pool.connect() failed:", err.stack);
  } else {
    console.log("✅ Database connected successfully!");
  }
  if (release) release();
});

module.exports = pool;