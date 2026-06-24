/**
 * @file dashboardRoutes.js
 * @description Defines routes linked to customer & admin dashboards.
 * Protects all access paths with authorization middleware, directing users to reports or order fulfillments.
 */

const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const reportController = require("../controllers/reportController");
const { requireAuth } = require("../middleware/authMiddleware"); 

// --- SECURE DASHBOARD & MANAGEMENT ENDPOINTS ---

// GET /dashboard - Loads the dashboard (directs to admin vs customer views based on JWT payload)
router.get("/", requireAuth, dashboardController.renderDashboard);

// POST /dashboard/fulfill/:id - Processes order fulfillment and updates items' delivered quantities
router.post("/fulfill/:id", requireAuth, dashboardController.fulfillOrder);

// GET /dashboard/reports/generate - Compiles structured dairy or tofu sales reports for a date range
router.get("/reports/generate", requireAuth, reportController.generateReport);

// GET /dashboard/reports/gst - Generates standard tax-compliant GST invoice for a specific customer
router.get("/reports/gst", requireAuth, reportController.generateGstInvoice);

module.exports = router;