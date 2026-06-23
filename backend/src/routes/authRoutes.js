const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

router.get("/", authController.renderLogin);
router.post("/login", authController.handleLogin);
router.get("/logout", authController.logout);
router.post("/register", authController.handleRegister);
// Add this line to your routes file
router.post("/forgot-password", authController.handleForgotPassword);
// This tells Express to capture the token after the slash
router.get("/reset-password/:token", authController.renderResetPassword);
router.post("/reset-password/:token", authController.handleResetPassword);
module.exports = router;