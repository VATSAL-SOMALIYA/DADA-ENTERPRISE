const pool = require("../config/db");

// 1. Add a New Branch (Unchanged)
exports.addBranch = async (req, res) => {
  const { branch_name, address } = req.body;
  const customerId = req.user.customer_id;

  try {
    await pool.query(
      "INSERT INTO branches (customer_id, branch_name, address) VALUES ($1, $2, $3)",
      [customerId, branch_name, address]
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Add Branch Error:", err);
    res.status(500).send("Server Error adding branch");
  }
};

// 2. The NEW Bulk Place Order
// 2. The NEW Resilient Bulk Place Order
exports.placeOrder = async (req, res) => {
  console.log("\n--- [CHECKPOINT 1] Raw Form Data ---");
  console.log(req.body);

  let orders = req.body.orders;
  const userId = req.user.id;

  // 🛠️ AUTO-REPAIR: If browser sent the old format, fix it on the fly
  if (!orders && req.body.products && req.body.branch_id) {
    console.log("🔧 Auto-converting old form format to Matrix format...");
    orders = {};
    orders[req.body.branch_id] = req.body.products;
  }

  // If there's truly no data, safely bounce them back (no crash)
  if (!orders || Object.keys(orders).length === 0) {
    console.log("⚠️ No valid order data found. Bouncing back to dashboard.");
    return res.redirect("/dashboard");
  }

  console.log("--- [CHECKPOINT 2] Transaction Starting... ---");
  let client;
  
  try {
    client = await pool.connect();
    await client.query("BEGIN"); 

    const prodDataResult = await client.query("SELECT id, base_rate, gst_percentage FROM products");
    const productPrices = {};
    prodDataResult.rows.forEach(p => {
      productPrices[p.id] = { rate: p.base_rate, gst: p.gst_percentage };
    });

    let totalBranchesOrdered = 0;

    // Loop through the repaired data
    // Loop through the prefixed data
    for (const [prefixedBranchId, products] of Object.entries(orders)) {
      if (!products) continue; 
      
      // Remove the 'b_' to get the REAL database ID back
      const branchId = prefixedBranchId.replace('b_', '');

      // Check if this branch has at least one item > 0
      const hasValidItems = Object.entries(products).some(([id, qty]) => qty && parseFloat(qty) > 0);
      
      if (hasValidItems) {
        console.log(`--- [CHECKPOINT 3] Saving REAL Branch ID: [${branchId}] ---`);
        
        const orderResult = await client.query(
          "INSERT INTO orders (branch_id, user_id, status) VALUES ($1, $2, 'Pending') RETURNING id",
          [branchId, userId]
        );
        const newOrderId = orderResult.rows[0].id;

        for (const [productId, quantity] of Object.entries(products)) {
          if (quantity && parseFloat(quantity) > 0) {
            const prod = productPrices[productId];
            if (prod) {
              await client.query(
                `INSERT INTO order_items 
                (order_id, product_id, ordered_quantity, rate_at_order, gst_at_order) 
                VALUES ($1, $2, $3, $4, $5)`,
                [newOrderId, productId, parseFloat(quantity), prod.rate, prod.gst]
              );
            }
          }
        }
        totalBranchesOrdered++;
      }
    }

    await client.query("COMMIT"); 
    console.log(`✅ Success! ${totalBranchesOrdered} branches saved.`);
    return res.redirect("/dashboard");

  } catch (err) {
    console.error("\n❌ --- DATABASE ERROR --- ❌");
    console.error(err.message);
    
    if (client) {
        try { await client.query("ROLLBACK"); } 
        catch (rollbackErr) { console.error("Rollback failed:", rollbackErr.message); }
    }
    
    return res.status(500).send("Server Error placing bulk order: " + err.message);

  } finally {
    if (client) {
        client.release(); 
    }
  }
};
// 3. Fetch Specific Order Details (For the Modal)
exports.getOrderDetails = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;

  try {
    // 1. Fetch the main order envelope + branch name
    const orderResult = await pool.query(`
      SELECT o.id, o.status, o.created_at, b.branch_name, b.address 
      FROM orders o
      JOIN branches b ON o.branch_id = b.id
      WHERE o.id = $1 AND o.user_id = $2
    `, [orderId, userId]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found or unauthorized." });
    }

    // 2. Fetch all the itemized products inside this order
    const itemsResult = await pool.query(`
      SELECT oi.ordered_quantity, oi.rate_at_order, oi.gst_at_order, p.name as product_name, p.unit
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = $1
    `, [orderId]);

    // Send it all back to the frontend as JSON
    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });

  } catch (err) {
    console.error("Fetch Order Details Error:", err);
    res.status(500).json({ error: "Server Error fetching order details" });
  }
};