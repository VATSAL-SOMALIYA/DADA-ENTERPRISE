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
const poolConfig = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  // Render PostgreSQL requires SSL connection in production
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
} else {
  poolConfig.user = process.env.DB_USER;
  poolConfig.password = process.env.DB_PASSWORD;
  poolConfig.host = process.env.DB_HOST;
  poolConfig.port = process.env.DB_PORT;
  poolConfig.database = process.env.DB_NAME;
  
  if (process.env.DB_SSL === "true" || process.env.NODE_ENV === "production") {
    poolConfig.ssl = {
      rejectUnauthorized: false
    };
  }
}

const pool = new Pool(poolConfig);

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