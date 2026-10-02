/**
 * @file aiRoutes.js
 * @description Routes for AI features in Dada Enterprise.
 */

const express = require("express");
const router = express.Router();
const multer = require("multer");
const aiController = require("../controllers/aiController");
const { requireAuth } = require("../middleware/authMiddleware");

// Configure multer memory storage (stores file in memory buffer for instant transmission to Gemini)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB maximum
});

// POST /api/ai/scan-order - Extracts order quantities from photo slip, audio, or text
router.post("/scan-order", requireAuth, upload.single("slip_file"), aiController.scanOrder);

// POST /api/ai/scan-fulfillment - Extracts delivered quantities from delivery challan or message
router.post("/scan-fulfillment", requireAuth, upload.single("slip_file"), aiController.scanFulfillment);

// GET /api/ai/morning-briefing - Generates 3-bullet morning dispatch analysis for Admin
router.get("/morning-briefing", requireAuth, aiController.getMorningBriefing);

// POST /api/ai/chat - Simple RAG support assistant with conversation history
router.post("/chat", requireAuth, aiController.chat);

module.exports = router;
