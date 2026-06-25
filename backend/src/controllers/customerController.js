/**
 * @file customerController.js
 * @description Controller handling customer interactions, branch management (adding, deleting),
 * order placements (transactions), and retrieving order invoice/delivery details.
 */

const pool = require("../config/db");

/**
 * Registers a new branch location for the logged-in customer account.
 * 
 * @param {import("express").Request} req - Express request object containing branch details.
 * @param {import("express").Response} res - Express response redirecting to dashboard.
 * @returns {Promise<void>}
 */
exports.addBranch = async (req, res) => {
  const { branch_name, address } = req.body;
  const customerId = req.user.customer_id;

  try {
    // Write new branch details directly to the database branches table
    await pool.query(
      "INSERT INTO branches (customer_id, branch_name, address) VALUES ($1, $2, $3)",
      [customerId, branch_name, address],
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Add Branch Error:", err);
    res.status(500).send("Server Error adding branch.");
  }
};

/**
 * Places a multi-branch master order containing daily product allocations.
 * Implements a database transaction to ensure order headers and items are written atomically.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.placeOrder = async (req, res) => {
  const { orders } = req.body;
  const userId = req.user.id;
  
  if (!orders || typeof orders !== "object") {
    return res.status(400).send("Invalid data.");
  }

  const client = await pool.connect();
  try {
    // 1. Begin atomic database transaction block
    await client.query("BEGIN");

    // 2. Fetch standard product base rates and GST percentages for calculation
    const prodDataResult = await client.query(
      "SELECT id, base_rate, gst_percentage FROM products",
    );
    const productPrices = {};
    prodDataResult.rows.forEach(
      (p) => (productPrices[p.id] = { rate: p.base_rate, gst: p.gst_percentage }),
    );

    // 3. Create the master order record with 'Pending' status
    const orderResult = await client.query(
      "INSERT INTO orders (user_id, status) VALUES ($1, 'Pending') RETURNING id",
      [userId],
    );
    const masterOrderId = orderResult.rows[0].id;
    let itemsAdded = 0;

    // 4. Iterate and insert items grouped under branches
    for (const [prefixedBranchId, products] of Object.entries(orders)) {
      if (!products) continue;
      const branchId = prefixedBranchId.replace("b_", "");
      
      for (const [prefixedProductId, quantity] of Object.entries(products)) {
        if (quantity && parseFloat(quantity) > 0) {
          const productId = prefixedProductId.replace("p_", "");
          const prod = productPrices[productId];
          if (prod) {
            await client.query(
              `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, rate_at_order, gst_at_order) 
              VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                masterOrderId,
                branchId,
                productId,
                parseFloat(quantity),
                prod.rate,
                prod.gst,
              ],
            );
            itemsAdded++;
          }
        }
      }
    }

    // 5. If no items had quantities, rollback to avoid inserting empty orders
    if (itemsAdded === 0) {
      await client.query("ROLLBACK");
      return res.redirect("/dashboard");
    }

    // 6. Commit the entire transaction
    await client.query("COMMIT");

    // Print order list to console log
    const { printOrderLog } = require("../config/orderPrinter");
    printOrderLog(masterOrderId, "PLACED").catch(err => console.error("Printer error:", err));

    res.redirect("/dashboard");
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Master Order Error:", err);
    res.status(500).send("Server Error placing master order.");
  } finally {
    if (client) client.release(); // release client connection pool lease
  }
};

/**
 * Retrieves the specific details and product list of an individual order.
 * Ensures security checks are passed (customers can only fetch their own orders).
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.getOrderDetails = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;
  const isCustomer = req.user.customer_id !== null;

  try {
    let orderResult;
    if (isCustomer) {
      // Secure check: Customers can only fetch details for orders they placed
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
    } else {
      // Admins are authorized to view any order details
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1`,
        [orderId],
      );
    }
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Retrieve corresponding items, matching names, branches, and quantities
    const itemsResult = await pool.query(
      `
      SELECT oi.id, oi.product_id, oi.branch_id, oi.ordered_quantity, oi.delivered_quantity, oi.rate_at_order, oi.gst_at_order, 
             p.name as product_name, p.unit, b.branch_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN branches b ON oi.branch_id = b.id
      WHERE oi.order_id = $1
      ORDER BY b.branch_name, p.name
    `,
      [orderId],
    );

    res.json({ order: orderResult.rows[0], items: itemsResult.rows });
  } catch (err) {
    console.error("Order Details Fetch Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};

/**
 * Deletes a customer's branch.
 * Throws a clean user-facing error block if foreign-key constraints prevent deletion.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.deleteBranch = async (req, res) => {
  const branchId = req.params.id;
  const customerId = req.user.customer_id;

  try {
    // Run deletion matching customer id constraint
    await pool.query("DELETE FROM branches WHERE id = $1 AND customer_id = $2", [branchId, customerId]);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Delete Branch Error:", err);
    // Error code 23503 corresponds to foreign key constraint violations in PostgreSQL
    if (err.code === '23503') {
      return res.status(400).send("Cannot delete this branch because it already has past orders attached to it.");
    }
    res.status(500).send("Server Error deleting branch");
  }
};

/**
 * Edits an existing master order (requested quantities).
 * Only allowed before the order is fulfilled.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.editOrder = async (req, res) => {
  const { id } = req.params;
  const { orders } = req.body;
  const userId = req.user.id;

  if (!orders || typeof orders !== "object") {
    return res.status(400).send("Invalid data.");
  }

  const client = await pool.connect();
  try {
    // 1. Begin database transaction
    await client.query("BEGIN");

    // 2. Fetch the order and verify ownership & status
    const orderRes = await client.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).send("Order not found.");
    }

    const order = orderRes.rows[0];
    if (order.user_id !== userId) {
      await client.query("ROLLBACK");
      return res.status(403).send("Unauthorized to edit this order.");
    }

    if (order.status === "Fulfilled") {
      await client.query("ROLLBACK");
      return res.status(400).send("Fulfilled orders cannot be edited.");
    }

    // 3. Fetch standard product prices for rate & gst calculations
    const prodDataResult = await client.query(
      "SELECT id, base_rate, gst_percentage FROM products",
    );
    const productPrices = {};
    prodDataResult.rows.forEach(
      (p) => (productPrices[p.id] = { rate: p.base_rate, gst: p.gst_percentage }),
    );

    // 4. Delete existing order items for this order
    await client.query("DELETE FROM order_items WHERE order_id = $1", [id]);

    let itemsAdded = 0;

    // 5. Insert updated order items
    for (const [prefixedBranchId, products] of Object.entries(orders)) {
      if (!products) continue;
      const branchId = prefixedBranchId.replace("b_", "");

      for (const [prefixedProductId, quantity] of Object.entries(products)) {
        if (quantity && parseFloat(quantity) > 0) {
          const productId = prefixedProductId.replace("p_", "");
          const prod = productPrices[productId];
          if (prod) {
            await client.query(
              `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, rate_at_order, gst_at_order) 
              VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                id,
                branchId,
                productId,
                parseFloat(quantity),
                prod.rate,
                prod.gst,
              ],
            );
            itemsAdded++;
          }
        }
      }
    }

    // 6. If no items were added with quantity > 0, we delete the master order record
    if (itemsAdded === 0) {
      await client.query("DELETE FROM orders WHERE id = $1", [id]);
      await client.query("COMMIT");
      return res.redirect("/dashboard");
    }

    // 7. Commit the transaction
    await client.query("COMMIT");

    // Print order list to console log
    const { printOrderLog } = require("../config/orderPrinter");
    printOrderLog(id, "EDITED").catch(err => console.error("Printer error:", err));

    res.redirect("/dashboard");
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Edit Order Error:", err);
    res.status(500).send("Server Error editing order.");
  } finally {
    if (client) client.release();
  }
};