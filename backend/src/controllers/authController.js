const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');

exports.renderLogin = (req, res) => {
  res.render("pages/login", { error: null });
};

// logic for handling login
exports.handleLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const userQuery = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (userQuery.rows.length === 0) {
      return res.render("pages/login", { error: "Invalid email or password" });
    }
    const user = userQuery.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.render("pages/login", { error: "Invalid email or password" });
    }
    // correct password
    // THE CORRECTED CODE:
    const token = jwt.sign(
      {
        id: user.id,
        customer_id: user.customer_id, // Add this line!
      },
      process.env.JWT_SECRET || "fallback_secret_key",
      { expiresIn: "1d" },
    );
    res.cookie("token", token, {
      httpOnly: true, // prevent client-side JS from reading the cookie
      secure: process.env.NODE_ENV === "production", // only send cookie over HTTPS in production
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    });

    res.redirect("/dashboard"); // redirect to dashboard or any other page
  } catch (err) {
    console.log("Login Error", err);
    res.render("pages/login", {
      error: "An error occurred. Please try again.",
    });
  }
};

// Logs the user out by destroying the secure cookie
exports.logout = (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
};
exports.handleRegister = async (req, res) => {
    // This is a placeholder so the server starts. 
    // We will fill in your database logic next.
    res.send("Registration endpoint is working!");
};

exports.requestPasswordReset = async (req, res) => {
    const { email } = req.body;
    
    // 1. Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    try {
        // 2. Save to DB
        const result = await pool.query(
            "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3 RETURNING id",
            [token, expires, email]
        );

        if (result.rows.length === 0) {
            return res.render("pages/login", { error: "Email not found." });
        }

        // 3. Send Email (Use nodemailer here)
        // const resetUrl = `http://yourdomain.com/reset-password/${token}`;
        // await sendEmail(email, "Reset your password", `Click here: ${resetUrl}`);

        res.send("Check your email for the reset link.");
    } catch (err) {
        res.status(500).send("Server Error");
    }
};

exports.handleForgotPassword = async (req, res) => {
    const { email } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    try {
        // Update user in DB
        const result = await pool.query(
            "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE email = $3", 
            [token, expires, email]
        );
        
        if (result.rowCount === 0) {
            return res.send("Email not found.");
        }

        // Output to terminal for testing
        // In authController.js, change your log to this:
console.log(`--- TEST RESET LINK: http://localhost:${process.env.PORT || 5000}/reset-password/${token} ---`);
        res.send("Check your terminal for the test reset link.");
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error.");
    }
};

exports.renderResetPassword = (req, res) => {
    res.render("pages/reset-password", { token: req.params.token, error: null });
};

exports.handleResetPassword = async (req, res) => {
    const { password, confirm_password } = req.body;
    const { token } = req.params;

    // Check if passwords match
    if (password !== confirm_password) {
        return res.send("Passwords do not match.");
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            "UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2 AND reset_token_expires > NOW()",
            [hashedPassword, token]
        );

        if (result.rowCount === 0) return res.send("Token invalid or expired.");
        res.redirect("/"); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error.");
    }
};