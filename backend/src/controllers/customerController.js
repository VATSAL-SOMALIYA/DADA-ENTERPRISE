const pool = require("../config/db");

// 1. Load the Dashboard
exports.getDashboard = async (req, res) => {
    const userId = req.user.id;
    const customerId = req.user.customer_id;

    try {
        // Fetch branches and products for the Matrix
        const branchesResult = await pool.query("SELECT * FROM branches WHERE customer_id = $1", [customerId]);
        const productsResult = await pool.query("SELECT * FROM products ORDER BY id");

        // The NEW Master Order Query (uses STRING_AGG to combine branch names)
        const ordersResult = await pool.query(`
            SELECT o.id, o.created_at, o.status, 
                   STRING_AGG(DISTINCT b.branch_name, ', ') as branch_names
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN branches b ON oi.branch_id = b.id
            WHERE o.user_id = $1
            GROUP BY o.id, o.created_at, o.status
            ORDER BY o.created_at DESC
        `, [userId]);

        res.render("pages/customer-dashboard", {
            user: req.user,
            branches: branchesResult.rows,
            products: productsResult.rows,
            orders: ordersResult.rows,
            error: null
        });
    } catch (err) {
        console.error("Dashboard Load Error:", err);
        res.status(500).send("Server Error loading dashboard");
    }
};

// 2. Add a New Branch
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

// 3. Bulk Place Order (Master Order System)
exports.placeOrder = async (req, res) => {
  const { orders } = req.body;
  const userId = req.user.id;

  if (!orders || typeof orders !== 'object') {
    return res.status(400).send("Invalid data.");
  }

  const client = await pool.connect();
  
  try {
    await client.query("BEGIN"); 

    // Fetch current product prices
    const prodDataResult = await client.query("SELECT id, base_rate, gst_percentage FROM products");
    const productPrices = {};
    prodDataResult.rows.forEach(p => productPrices[p.id] = { rate: p.base_rate, gst: p.gst_percentage });

    // 1. CREATE ONE SINGLE MASTER ORDER FOR THE ENTIRE SUBMISSION
    const orderResult = await client.query(
      "INSERT INTO orders (user_id, status) VALUES ($1, 'Pending') RETURNING id",
      [userId]
    );
    const masterOrderId = orderResult.rows[0].id;
    let itemsAdded = 0;

    // 2. LOOP THROUGH BRANCHES AND ADD ITEMS TO THE MASTER ORDER
    for (const [prefixedBranchId, products] of Object.entries(orders)) {
      if (!products) continue; 
      
      // Remove the 'b_' array trap fix
      const branchId = prefixedBranchId.replace('b_', '');

      for (const [productId, quantity] of Object.entries(products)) {
        if (quantity && parseFloat(quantity) > 0) {
          const prod = productPrices[productId];
          if (prod) {
            // Notice we are now saving the branchId straight into the order_items table
            await client.query(
              `INSERT INTO order_items 
              (order_id, branch_id, product_id, ordered_quantity, rate_at_order, gst_at_order) 
              VALUES ($1, $2, $3, $4, $5, $6)`,
              [masterOrderId, branchId, productId, parseFloat(quantity), prod.rate, prod.gst]
            );
            itemsAdded++;
          }
        }
      }
    }

    // 3. SAFETY NET: If they submitted a completely blank form, cancel the transaction
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

// 4. Get Order Details (For the Invoice Modal)
// 4. Get Order Details (For the Invoice Modal & Admin Fulfillment)
exports.getOrderDetails = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user.id;
  
  // In your system, if customer_id is null, this person is an Admin
  const isCustomer = req.user.customer_id !== null; 

  try {
    let orderResult;

    if (isCustomer) {
      // CUSTOMER PATH: Strict security lock. Must own the order.
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1 AND user_id = $2`, 
        [orderId, userId]
      );
    } else {
      // ADMIN PATH: Master access. Can pull any order.
      orderResult = await pool.query(
        `SELECT id, status, created_at FROM orders WHERE id = $1`, 
        [orderId]
      );
    }
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Items now contain the branch info and the new delivered_quantity column
    const itemsResult = await pool.query(`
      SELECT oi.id, oi.ordered_quantity, oi.delivered_quantity, oi.rate_at_order, oi.gst_at_order, 
             p.name as product_name, p.unit, b.branch_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN branches b ON oi.branch_id = b.id
      WHERE oi.order_id = $1
      ORDER BY b.branch_name, p.name
    `, [orderId]);

    res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    
  } catch (err) {
    console.error("Order Details Fetch Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};