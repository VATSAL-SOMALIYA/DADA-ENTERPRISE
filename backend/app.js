/**
 * @file app.js
 * @description Entry point for the DADA Enterprise website backend application.
 * Configures the Express server, global middleware, static asset routing, 
 * database table verification, and mounts route controllers.
 */

require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

// Import routing modules
const authRoutes = require("./src/routes/authRoutes");
const customerRoutes = require("./src/routes/customerRoutes");
const dashboardRoutes = require("./src/routes/dashboardRoutes");

const pool = require("./src/config/db");

// Verify and initialize database tables on startup.
// Creates the `otp_verifications` table if it does not already exist,
// supporting one-time passcode checks for secure registration and password recovery.
pool.query(`
  CREATE TABLE IF NOT EXISTS otp_verifications (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    otp VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    type VARCHAR(50) NOT NULL,
    payload JSONB
  );
`).catch(err => console.error("❌ Error creating otp_verifications table:", err));

const app = express();

// --- VIEW ENGINE CONFIGURATION ---
// Set EJS as the template engine and configure the directory for page views
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));

// --- GLOBAL MIDDLEWARE ---
// Serve static client-side resources (CSS, JS, images) from the public folder
app.use(express.static(path.join(__dirname, "public")));

// Parse urlencoded request bodies (submitted via HTML form actions)
app.use(express.urlencoded({ extended: true }));

// Read cookies from client requests, facilitating secure JWT session management
app.use(cookieParser());

// --- ROUTE MOUNTING ---
// Mount public authentication paths (login, logout, signup, OTPs) at root
app.use("/", authRoutes);

// Mount main application view routing (admin/customer portals, invoices, reports)
app.use("/dashboard", dashboardRoutes);

// Mount customer operations (adding branches, order placements, branch removals)
app.use("/customer", customerRoutes);

// =========================================================================
// CUSTOM ROOT/ADMIN ROUTE INTERCEPTOR
// Explicitly handles the order fulfillment endpoint submitted by admin forms.
// Resolves to dashboardController.fulfillOrder, protected by JWT middleware.
// =========================================================================
const dashboardController = require("./src/controllers/dashboardController");
const { requireAuth } = require("./src/middleware/authMiddleware");
app.post(
  "/admin/order/fulfill/:id",
  requireAuth,
  dashboardController.fulfillOrder,
);

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

