/**
 * @file authMiddleware.js
 * @description Middleware functions for validating user sessions and enforcing route protection.
 */

const jwt = require("jsonwebtoken");

/**
 * Route protection middleware that checks for a valid JSON Web Token (JWT) in client cookies.
 * - Decodes and verifies the token using the system secret.
 * - Attaches decoded user payload (id, customer_id) to `req.user` if valid.
 * - Clears session cookies and redirects back to the login portal if invalid or expired.
 * 
 * @param {import("express").Request} req - The Express request object.
 * @param {import("express").Response} res - The Express response object.
 * @param {import("express").NextFunction} next - The Express next middleware callback.
 * @returns {void}
 */
exports.requireAuth = (req, res, next) => {
  // 1. Grab the HTTP-only session token cookie
  const token = req.cookies.token;

  // 2. If no token is provided, redirect to the login screen
  if (!token) {
    return res.redirect("/");
  }

  try {
    // 3. Verify the token using the secret signature key
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret_key");
    
    // 4. Attach session information to the request context to make it accessible to downstream controllers
    req.user = decoded;
    next();
  } catch (err) {
    // If the token verification fails (expired or tampered), clear the cookie and redirect to login
    res.clearCookie("token");
    res.redirect("/");
  }
};

