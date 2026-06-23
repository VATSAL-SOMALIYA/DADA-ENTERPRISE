const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");
const { requireAuth } = require("../middleware/authMiddleware");

// Both of these actions require the user to be logged in
router.post("/add-branch", requireAuth, customerController.addBranch);
router.post("/place-order", requireAuth, customerController.placeOrder);
router.get("/order/:id", requireAuth, customerController.getOrderDetails);
router.post("/delete-branch/:id", requireAuth, customerController.deleteBranch);

module.exports = router;
