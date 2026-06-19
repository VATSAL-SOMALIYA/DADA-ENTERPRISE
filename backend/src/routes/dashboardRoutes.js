const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { requireAuth } = require("../middleware/authMiddleware"); // Import the bouncer

// Put the bouncer in front of the controller
router.get("/", requireAuth, dashboardController.renderDashboard);

module.exports = router;