/**
 * @file dashboardRoutes.js
 * @description Defines routes linked to customer & admin dashboards.
 * Protects all access paths with authorization middleware, directing users to reports or order fulfillments.
 */

const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const reportController = require("../controllers/reportController");
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware"); 

// --- SECURE DASHBOARD & MANAGEMENT ENDPOINTS ---

// GET /dashboard - Loads the dashboard (directs to admin vs customer views based on JWT payload)
router.get("/", requireAuth, dashboardController.renderDashboard);

// POST /dashboard/fulfill/:id - Only an admin can record actual delivery quantities
router.post("/fulfill/:id", requireAuth, requireAdmin, dashboardController.fulfillOrder);

// GET /dashboard/reports/generate - Compiles structured dairy or tofu sales reports for a date range
router.get("/reports/generate", requireAuth, reportController.generateReport);

// GET /dashboard/reports/gst - Only an admin can generate invoices for customers
router.get("/reports/gst", requireAuth, requireAdmin, reportController.generateGstInvoice);

module.exports = router;
