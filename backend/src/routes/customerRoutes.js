/**
 * @file customerRoutes.js
 * @description Defines the router and endpoints for customer specific actions.
 * Protects all routes using `requireAuth` middleware to ensure only authorized users can perform edits.
 */

const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");
const { requireAuth } = require("../middleware/authMiddleware");

// --- SECURE CUSTOMER ENDPOINTS ---

// POST /customer/add-branch - Creates a new branch for the authenticated customer
router.post("/add-branch", requireAuth, customerController.addBranch);

// POST /customer/place-order - Places a multi-branch master order containing daily product distributions
router.post("/place-order", requireAuth, customerController.placeOrder);

// GET /customer/order/:id - Retrieves details of a specific order (restricted to the ordering customer or admins)
router.get("/order/:id", requireAuth, customerController.getOrderDetails);

// POST /customer/delete-branch/:id - Deletes a specific branch (fails if the branch has past order history)
router.post("/delete-branch/:id", requireAuth, customerController.deleteBranch);

// POST /customer/edit-order/:id - Edits requested quantities for an order (restricted to ordering customer)
router.post("/edit-order/:id", requireAuth, customerController.editOrder);

module.exports = router;

