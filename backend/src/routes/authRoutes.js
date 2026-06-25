/**
 * @file authRoutes.js
 * @description Defines the router and endpoints for handling client authentication.
 * Includes user login, logout, registration, OTP checks, and forgot-password flows.
 */

const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// --- PUBLIC AUTHENTICATION ENDPOINTS ---

// GET / - Renders the unified Login & Registration interface
router.get("/", authController.renderLogin);

// POST /login - Authenticates existing users via credentials, issuing a JWT cookie
router.post("/login", authController.handleLogin);

// GET /logout - Clears JWT token cookie and redirects back to login root
router.get("/logout", authController.logout);

// POST /register - Performs email/password validation, generates/sends sign-up OTP, and redirects to verification
router.post("/register", authController.handleRegister);

// POST /forgot-password - Dispatches password recovery OTP if email exists in database
router.post("/forgot-password", authController.handleForgotPassword);

// SECURITY NOTE: While useful for quick password recovery without external email services,
// using security questions is not a secure standard for public-facing production apps.
// Ideally, multi-factor authentication (MFA) or email/SMS OTP should be used.

// GET /verify-security-question - Renders the security question challenge form
router.get("/verify-security-question", authController.renderVerifySecurityQuestion);

// POST /verify-security-question - Validates the answer and generates a password reset token
router.post("/verify-security-question", authController.handleVerifySecurityQuestion);

// GET /reset-password/:token - Renders the password reset view for verified recovery tokens
router.get("/reset-password/:token", authController.renderResetPassword);

// POST /reset-password/:token - Updates user password in database after validating the recovery token
router.post("/reset-password/:token", authController.handleResetPassword);

// GET /verify-otp - Renders the OTP submission form (expects email & flow type in query params)
router.get("/verify-otp", authController.renderVerifyOtp);

// POST /verify-otp - Validates the user-submitted 6-digit OTP and completes the registration or forgot-password process
router.post("/verify-otp", authController.handleVerifyOtp);

module.exports = router;