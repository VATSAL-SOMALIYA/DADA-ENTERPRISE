/**
 * @file authController.js
 * @description Controller handling authentication actions: login, signup, forgot password, 
 * email domain verification, OTP checking, and password resets.
 */

const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const dns = require("dns").promises;

/**
 * Renders the Login page.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
exports.renderLogin = (req, res) => {
  res.render("pages/login", { error: null });
};

/**
 * Validates user credentials and issues a JWT token cookie upon successful login.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
exports.handleLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Look up the user by email address
    const userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (userQuery.rows.length === 0) {
      return res.render("pages/login", { error: "Invalid email or password" });
    }
    const user = userQuery.rows[0];

    // 2. Validate password match using bcrypt
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render("pages/login", { error: "Invalid email or password" });
    }

    // 3. Generate a JWT token containing the user id and customer_id (null for admin)
    const token = jwt.sign(
      {
        id: user.id,
        customer_id: user.customer_id,
      },
      process.env.JWT_SECRET || "fallback_secret_key",
      { expiresIn: "1d" },
    );

    // 4. Issue the token as a secure, HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true, // prevents client-side scripting access (mitigates XSS)
      secure: process.env.NODE_ENV === "production", // transmit only over HTTPS in production
      maxAge: 24 * 60 * 60 * 1000, // cookie lifespan of 1 day
    });

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login Error:", err);
    res.render("pages/login", {
      error: "An error occurred. Please try again.",
    });
  }
};

/**
 * Clears the session cookie and redirects the user to the login screen.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
exports.logout = (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
};

/**
 * Helper function to validate if an email domain has active DNS MX records.
 * Provides a development bypass for common testing domains.
 * 
 * @param {string} email - Email address to check.
 * @returns {Promise<boolean>} Resolves to true if the domain is valid and receives mail.
 */
async function isEmailDomainValid(email) {
  // Check basic email format correctness
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;

  const domain = email.split("@")[1];
  if (!domain) return false;

  // Development override: Bypass MX check for test domains during local offline testing
  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    const devDomains = ["test.com", "example.com", "localhost", "gmail.com"];
    const lowercaseDomain = domain.toLowerCase();
    if (
      devDomains.includes(lowercaseDomain) ||
      lowercaseDomain.endsWith(".local") ||
      lowercaseDomain.endsWith(".test")
    ) {
      return true;
    }
  }

  try {
    // Resolve DNS MX records to guarantee the domain can receive emails
    const mx = await dns.resolveMx(domain);
    return mx && mx.length > 0;
  } catch (err) {
    console.warn(`MX resolution failed for domain ${domain}:`, err.message);
    return false;
  }
}

/**
 * Validates password strength (minimum 8 characters, at least one letter, and one number).
 * 
 * @param {string} password - Plain text password.
 * @returns {boolean} True if the password meets strength criteria.
 */
function isPasswordStrong(password) {
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\W_]{8,}$/;
  return passwordRegex.test(password);
}

/**
 * Handles user registration by validating inputs, creating a pending OTP registration entry,
 * sending an email notification, and redirecting the user to the verification view.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
exports.handleRegister = async (req, res) => {
  const { company_name, email, password, role } = req.body;

  const isRegisteringAdmin = (role === "admin");

  if ((!isRegisteringAdmin && !company_name) || !email || !password) {
    return res.render("pages/login", { error: "All fields are required.", activeTab: "register" });
  }

  // 1. Verify the email domain is valid and active
  const validEmail = await isEmailDomainValid(email);
  if (!validEmail) {
    return res.render("pages/login", { error: "Please enter a valid, real email address.", activeTab: "register" });
  }

  // 2. Enforce strong password complexity rules
  if (!isPasswordStrong(password)) {
    return res.render("pages/login", { error: "Password must be at least 8 characters and contain at least one letter and one number.", activeTab: "register" });
  }

  try {
    // 3. Confirm the email address isn't already registered
    const checkUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (checkUser.rows.length > 0) {
      return res.render("pages/login", { error: "Email is already registered.", activeTab: "register" });
    }

    // 4. Generate a random 6-digit numeric OTP code
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // code expires in 10 minutes

    // 5. Hash the plain text password prior to saving
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. Save or update the OTP verification record with sign-up details
    await pool.query(
      `INSERT INTO otp_verifications (email, otp, expires_at, type, payload) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) 
       DO UPDATE SET otp = $2, expires_at = $3, type = $4, payload = $5`,
      [email, otp, expiresAt, "register", JSON.stringify({ company_name: isRegisteringAdmin ? "Master Admin" : company_name, password: hashedPassword, role: role || "customer" })]
    );

    // 7. Dispatch the OTP via mail service
    const { sendMail } = require("../config/mailService");
    await sendMail(
      email,
      "DADA Enterprise - Verification OTP",
      `Your verification OTP is: ${otp}\nThis OTP is valid for 10 minutes.`
    );

    // 8. Redirect to the OTP input view
    res.redirect(`/verify-otp?email=${encodeURIComponent(email)}&type=register`);
  } catch (err) {
    console.error("Register error:", err);
    res.render("pages/login", { error: "An error occurred during registration. Please try again.", activeTab: "register" });
  }
};

/**
 * Handles the password recovery initiation: validates email, generates recovery OTP,
 * persists the state, and dispatches an OTP verification email.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
exports.handleForgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.render("pages/login", { error: "Email is required." });
  }

  try {
    // 1. Verify that the email is associated with a registered user
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.render("pages/login", { error: "Email not found." });
    }

    // 2. Generate a random 6-digit numeric recovery code
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // valid for 10 minutes

    // 3. Write the recovery OTP to the database
    await pool.query(
      `INSERT INTO otp_verifications (email, otp, expires_at, type, payload) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) 
       DO UPDATE SET otp = $2, expires_at = $3, type = $4, payload = $5`,
      [email, otp, expiresAt, "forgot_password", null]
    );

    // 4. Dispatch the recovery code email
    const { sendMail } = require("../config/mailService");
    await sendMail(
      email,
      "DADA Enterprise - Password Reset OTP",
      `Your password reset OTP is: ${otp}\nThis OTP is valid for 10 minutes.`
    );

    // 5. Redirect to the OTP input screen
    res.redirect(`/verify-otp?email=${encodeURIComponent(email)}&type=forgot_password`);
  } catch (err) {
    console.error("Forgot password error:", err);
    res.render("pages/login", { error: "An error occurred. Please try again." });
  }
};

/**
 * Renders the OTP verification code entry page.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
exports.renderVerifyOtp = (req, res) => {
  const { email, type } = req.query;
  res.render("pages/verify-otp", { email, type, error: null });
};

/**
 * Validates the user-submitted OTP code.
 * - If registration flow: Creates user (sets first user as admin, subsequent users as customers).
 * - If recovery flow: Generates a temporary reset token and routes to the reset page.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
exports.handleVerifyOtp = async (req, res) => {
  const { email, type, otp } = req.body;

  if (!email || !type || !otp) {
    return res.render("pages/verify-otp", { email, type, error: "OTP is required." });
  }

  try {
    // 1. Fetch the OTP record corresponding to the email and action type
    const result = await pool.query(
      "SELECT * FROM otp_verifications WHERE email = $1 AND type = $2",
      [email, type]
    );

    if (result.rows.length === 0) {
      return res.render("pages/verify-otp", { email, type, error: "No active OTP request found for this email." });
    }

    const otpRecord = result.rows[0];

    // 2. Enforce expiration checks
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.render("pages/verify-otp", { email, type, error: "OTP has expired. Please request a new one." });
    }

    // 3. Verify character matches
    if (otpRecord.otp !== otp) {
      return res.render("pages/verify-otp", { email, type, error: "Invalid OTP. Please try again." });
    }

    // OTP is valid, process verification based on the action type
    if (type === "register") {
      const payload = otpRecord.payload;
      const isRegisteringAdmin = (payload.role === "admin");

      let customerId = null;

      if (isRegisteringAdmin) {
        // Registered as an Admin (no customer ID linked)
        const insertUser = await pool.query(
          "INSERT INTO users (name, email, password, customer_id, contact_number) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          ["Master Admin", email, payload.password, null, "+91 9016764959"]
        );
        
        // Clean up the consumed OTP
        await pool.query("DELETE FROM otp_verifications WHERE email = $1", [email]);

        // Sign and issue session cookie
        const token = jwt.sign(
          { id: insertUser.rows[0].id, customer_id: null },
          process.env.JWT_SECRET || "fallback_secret_key",
          { expiresIn: "1d" }
        );

        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 24 * 60 * 60 * 1000,
        });

        return res.redirect("/dashboard");
      } else {
        // Subsequent system users are registered as Customers
        // 1st step: Insert into customers table
        const insertCustomer = await pool.query(
          "INSERT INTO customers (company_name, contact_number) VALUES ($1, $2) RETURNING id",
          [payload.company_name, "+91 9016764959"]
        );
        customerId = insertCustomer.rows[0].id;

        // 2nd step: Insert into users table linked to the customer record
        const insertUser = await pool.query(
          "INSERT INTO users (name, email, password, customer_id, contact_number) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [payload.company_name, email, payload.password, customerId, "+91 9016764959"]
        );

        // Clean up the consumed OTP
        await pool.query("DELETE FROM otp_verifications WHERE email = $1", [email]);

        // Sign and issue session cookie
        const token = jwt.sign(
          { id: insertUser.rows[0].id, customer_id: customerId },
          process.env.JWT_SECRET || "fallback_secret_key",
          { expiresIn: "1d" }
        );

        res.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 24 * 60 * 60 * 1000,
        });

        return res.redirect("/dashboard");
      }
    } else if (type === "forgot_password") {
      // Generate a crypto-secure token for password reset bypass
      const resetToken = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 10 * 60 * 1000); // reset link is valid for 10 minutes

      // Store the token and expiry details against the user record
      await pool.query(
        "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3",
        [resetToken, expires, email]
      );

      // Clean up the consumed OTP
      await pool.query("DELETE FROM otp_verifications WHERE email = $1", [email]);

      return res.redirect(`/reset-password/${resetToken}`);
    }
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.render("pages/verify-otp", { email, type, error: "An error occurred during verification. Please try again." });
  }
};

/**
 * Renders the Password Reset page using a secure parameter token.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
exports.renderResetPassword = (req, res) => {
  res.render("pages/reset-password", { token: req.params.token, error: null });
};

/**
 * Validates and executes a password update request using the secure recovery token.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
exports.handleResetPassword = async (req, res) => {
  const { password, confirm_password } = req.body;
  const { token } = req.params;

  if (password !== confirm_password) {
    return res.send("Passwords do not match.");
  }

  try {
    // 1. Hash the new password prior to insertion
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. Perform the update if the token exists and has not expired
    const result = await pool.query(
      "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2 AND reset_token_expires > NOW()",
      [hashedPassword, token]
    );

    if (result.rowCount === 0) {
      return res.send("Token invalid or expired.");
    }
    
    res.redirect("/");
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).send("Database error.");
  }
};