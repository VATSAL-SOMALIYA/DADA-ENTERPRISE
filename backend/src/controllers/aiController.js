/**
 * @file aiController.js
 * @description Controller handling AI endpoints for Dada Enterprise.
 */

const pool = require("../config/db");
const aiService = require("../services/aiService");

/**
 * Scans an order slip photo, voice audio recording, or pasted WhatsApp message
 * and extracts matching branch and product quantities for customer order placement.
 */
exports.scanOrder = async (req, res) => {
  try {
    const customerId = req.user.customer_id;
    if (!customerId) {
      return res.status(400).json({ error: "Only customer accounts can scan orders." });
    }

    const { order_text } = req.body;
    const file = req.file;

    // Fetch customer's valid branches and all available products
    const branchesQuery = await pool.query("SELECT id, branch_name FROM branches WHERE customer_id = $1", [customerId]);
    const productsQuery = await pool.query("SELECT id, name, unit FROM products ORDER BY id");

    if (branchesQuery.rows.length === 0) {
      return res.status(400).json({ error: "Please configure at least one branch before scanning an order." });
    }

    const extractedItems = await aiService.extractQuantities({
      text: order_text,
      fileBuffer: file ? file.buffer : null,
      mimeType: file ? file.mimetype : null,
      branches: branchesQuery.rows,
      products: productsQuery.rows
    });

    return res.json({
      success: true,
      items: extractedItems
    });
  } catch (err) {
    console.error("AI Scan Order Error:", err);
    return res.status(500).json({ error: err.message || "Failed to scan order." });
  }
};

/**
 * Scans a signed delivery slip or driver confirmation message
 * to auto-fill delivered quantities during admin order fulfillment.
 */
exports.scanFulfillment = async (req, res) => {
  try {
    const { order_id, notes } = req.body;
    const file = req.file;

    if (!order_id) {
      return res.status(400).json({ error: "Order ID is required." });
    }

    // Retrieve order items with branch and product details
    const itemsQuery = await pool.query(`
      SELECT oi.branch_id, b.branch_name, oi.product_id, p.name AS product_name, p.unit
      FROM order_items oi
      JOIN branches b ON oi.branch_id = b.id
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [order_id]);

    if (itemsQuery.rows.length === 0) {
      return res.status(404).json({ error: "Order items not found." });
    }

    // Extract unique branches and products involved in this order
    const branchesMap = new Map();
    const productsMap = new Map();

    itemsQuery.rows.forEach(r => {
      branchesMap.set(r.branch_id, { id: r.branch_id, branch_name: r.branch_name });
      productsMap.set(r.product_id, { id: r.product_id, name: r.product_name, unit: r.unit });
    });

    const extractedItems = await aiService.extractQuantities({
      text: notes,
      fileBuffer: file ? file.buffer : null,
      mimeType: file ? file.mimetype : null,
      branches: Array.from(branchesMap.values()),
      products: Array.from(productsMap.values())
    });

    return res.json({
      success: true,
      items: extractedItems
    });
  } catch (err) {
    console.error("AI Scan Fulfillment Error:", err);
    return res.status(500).json({ error: err.message || "Failed to scan delivery slip." });
  }
};

/**
 * Generates an executive morning dispatch summary for the Admin Dashboard.
 */
exports.getMorningBriefing = async (req, res) => {
  try {
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Customer & Branch stats
    const customerCount = await pool.query("SELECT COUNT(*) FROM customers");
    const branchCount = await pool.query("SELECT COUNT(*) FROM branches");

    // Today's product demand hierarchy
    const hierarchyQuery = await pool.query(`
      SELECT c.company_name, b.branch_name, p.name AS product_name, SUM(oi.ordered_quantity) AS total_qty, p.unit
      FROM customers c
      JOIN branches b ON c.id = b.customer_id
      JOIN order_items oi ON b.id = oi.branch_id
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      WHERE timezone('Asia/Kolkata', o.created_at)::date = $1::date
      GROUP BY c.company_name, b.branch_name, p.name, p.unit
      ORDER BY c.company_name, b.branch_name
    `, [todayIST]);

    const groupedData = {};
    hierarchyQuery.rows.forEach(row => {
      if (!groupedData[row.company_name]) groupedData[row.company_name] = {};
      if (!groupedData[row.company_name][row.branch_name]) groupedData[row.company_name][row.branch_name] = [];
      groupedData[row.company_name][row.branch_name].push({
        product: row.product_name, qty: row.total_qty, unit: row.unit
      });
    });

    // Today's orders
    const ordersQuery = await pool.query(`
      SELECT o.id, o.status, c.company_name
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN branches b ON oi.branch_id = b.id
      JOIN customers c ON b.customer_id = c.id
      WHERE timezone('Asia/Kolkata', o.created_at)::date = $1::date
      GROUP BY o.id, o.status, c.company_name
    `, [todayIST]);

    const briefing = await aiService.generateMorningBriefing({
      groupedData,
      orders: ordersQuery.rows,
      stats: { customers: customerCount.rows[0].count, branches: branchCount.rows[0].count }
    });

    return res.json({ success: true, briefing });
  } catch (err) {
    console.error("AI Morning Briefing Error:", err);
    return res.status(500).json({ error: "Failed to generate morning briefing." });
  }
};

/**
 * Handles RAG chat queries for the AI support assistant.
 */
exports.chat = async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const reply = await aiService.askSupportBot({
      question: message.trim(),
      history: history || []
    });

    return res.json({ success: true, reply });
  } catch (err) {
    console.error("AI Chat Error:", err);
    return res.status(500).json({ error: err.message || "Failed to process question." });
  }
};
