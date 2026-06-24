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
 * Dispatches async Text Message (SMS) and WhatsApp notifications to system administrators.
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
      
      for (const [productId, quantity] of Object.entries(products)) {
        if (quantity && parseFloat(quantity) > 0) {
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
    
    // 7. Dispatch order alert notifications asynchronously to avoid blocking user response
    (async () => {
      try {
        const customerRes = await pool.query("SELECT company_name FROM customers WHERE id = $1", [req.user.customer_id]);
        const customerName = customerRes.rows[0]?.company_name || "Unknown Customer";
        
        // Retrieve admin contact numbers from the system (users with no customer_id)
        const adminsQuery = await pool.query("SELECT contact_number FROM users WHERE customer_id IS NULL");
        const adminNumbers = adminsQuery.rows.map(r => r.contact_number).filter(Boolean);
        if (adminNumbers.length === 0) adminNumbers.push("+91 9016764959");

        const { sendSms, sendWhatsapp } = require("../config/notificationService");
        const smsMessage = `Notice: A new order (ID: ${masterOrderId}) has been placed today by ${customerName}.`;
        const whatsappMessage = `*New Order Alert*\n\nOrder ID: *${masterOrderId}*\nCustomer: *${customerName}*\nStatus: *Placed for today*`;

        for (const number of adminNumbers) {
          await sendSms(number, smsMessage);
          await sendWhatsapp(number, whatsappMessage);
        }
      } catch (err) {
        console.error("Failed to send admin notification:", err);
      }
    })();

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