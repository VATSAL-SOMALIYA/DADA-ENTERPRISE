const pool = require("../config/db");

// 1. Add a New Branch (Corrected)
exports.addBranch = async (req, res) => {
  // We are grabbing BOTH the branch_name and address from your form
  const { branch_name, address } = req.body;
  const customerId = req.user.customer_id;

  try {
    // We send all 3 required pieces of data to the database
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

exports.placeOrder = async (req, res) => {
  const { orders } = req.body;
  const userId = req.user.id;
  if (!orders || typeof orders !== "object")
    return res.status(400).send("Invalid data.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prodDataResult = await client.query(
      "SELECT id, base_rate, gst_percentage FROM products",
    );
    const productPrices = {};
    prodDataResult.rows.forEach(
      (p) =>
        (productPrices[p.id] = { rate: p.base_rate, gst: p.gst_percentage }),
    );

    const orderResult = await client.query(
      "INSERT INTO orders (user_id, status) VALUES ($1, 'Pending') RETURNING id",
      [userId],
    );
    const masterOrderId = orderResult.rows[0].id;
    let itemsAdded = 0;

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
    if (itemsAdded === 0) {
      await client.query("ROLLBACK");
      return res.redirect("/dashboard");
    }
    await client.query("COMMIT");
    res.redirect("/dashboard");
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Master Order Error:", err);
    res.status(500).send("Server Error placing master order.");
  } finally {
    if (client) client.release();
  }
};

exports.getOrderDetails = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;
  const isCustomer = req.user.customer_id !== null;

  try {
    let orderResult;
    if (isCustomer) {
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
    } else {
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1`,
        [orderId],
      );
    }
    if (orderResult.rows.length === 0)
      return res.status(404).json({ error: "Order not found." });

    // FIXED: Added oi.product_id and oi.branch_id here
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

// Delete a Branch
exports.deleteBranch = async (req, res) => {
  const branchId = req.params.id;
  const customerId = req.user.customer_id;

  try {
    await pool.query("DELETE FROM branches WHERE id = $1 AND customer_id = $2", [branchId, customerId]);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Delete Branch Error:", err);
    // Error 23503 means this branch already has orders attached to it in the database
    if (err.code === '23503') {
        return res.status(400).send("Cannot delete this branch because it already has past orders attached to it.");
    }
    res.status(500).send("Server Error deleting branch");
  }
};