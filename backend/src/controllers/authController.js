const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

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
