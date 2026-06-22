const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const { requireAuth } = require("../middleware/authMiddleware"); 

// Load the dashboard
router.get("/", requireAuth, dashboardController.renderDashboard);

// The Fulfillment Route (This automatically becomes /dashboard/fulfill/:id)
router.post("/fulfill/:id", requireAuth, dashboardController.fulfillOrder);

module.exports = router;