const pool = require("../config/db");

exports.renderDashboard = async (req, res) => {
  try {
    const customerId = req.user.customer_id;

    // ==========================================
    // PATH 1: ADMIN DASHBOARD (customer_id is null)
    // ==========================================
    if (!customerId) {
      const customerCount = await pool.query("SELECT COUNT(*) FROM customers");
      const branchCount = await pool.query("SELECT COUNT(*) FROM branches");

      const hierarchyQuery = await pool.query(`
        SELECT c.company_name, b.branch_name, p.name AS product_name, SUM(oi.ordered_quantity) AS total_qty, p.unit
        FROM customers c
        JOIN branches b ON c.id = b.customer_id
        JOIN order_items oi ON b.id = oi.branch_id
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        GROUP BY c.company_name, b.branch_name, p.name, p.unit
        ORDER BY c.company_name, b.branch_name
      `);

      const groupedData = {};
      hierarchyQuery.rows.forEach(row => {
        if (!groupedData[row.company_name]) groupedData[row.company_name] = {};
        if (!groupedData[row.company_name][row.branch_name]) groupedData[row.company_name][row.branch_name] = [];
        groupedData[row.company_name][row.branch_name].push({
          product: row.product_name, qty: row.total_qty, unit: row.unit
        });
      });

      // NEW: Fetch all orders across all clients for the Manage Orders tab
      const allOrdersQuery = await pool.query(`
        SELECT o.id, o.status, o.created_at, c.company_name, STRING_AGG(DISTINCT b.branch_name, ', ') as branch_names
        FROM orders o 
        JOIN order_items oi ON o.id = oi.order_id
        JOIN branches b ON oi.branch_id = b.id
        JOIN customers c ON b.customer_id = c.id
        GROUP BY o.id, o.status, o.created_at, c.company_name
        ORDER BY o.created_at DESC
      `);

      return res.render("pages/dashboard", { 
        stats: { customers: customerCount.rows[0].count, branches: branchCount.rows[0].count },
        groupedData: groupedData,
        orders: allOrdersQuery.rows // Passing the orders to the Admin UI
      });
    }

    // ==========================================
    // PATH 2: CUSTOMER DASHBOARD (customer_id exists)
    // ==========================================
    
    const branchesQuery = await pool.query("SELECT * FROM branches WHERE customer_id = $1", [customerId]);
    const productsQuery = await pool.query("SELECT * FROM products ORDER BY id");
    
    const ordersQuery = await pool.query(`
      SELECT o.id, o.status, o.created_at, STRING_AGG(DISTINCT b.branch_name, ', ') as branch_names
      FROM orders o 
      JOIN order_items oi ON o.id = oi.order_id
      JOIN branches b ON oi.branch_id = b.id
      WHERE b.customer_id = $1 
      GROUP BY o.id, o.status, o.created_at
      ORDER BY o.created_at DESC
    `, [customerId]);

    const branches = branchesQuery.rows;
    const products = productsQuery.rows;
    const orders = ordersQuery.rows;

    const stats = {
      totalOrders: orders.length,
      inProgress: orders.filter(o => o.status === 'Pending' || o.status === 'Dispatched').length,
      delivered: orders.filter(o => o.status === 'Fulfilled').length,
      branches: branches.length
    };

    return res.render("pages/customer-dashboard", { stats, branches, products, orders });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Server Error loading dashboard");
  }
};

// Admin Submits Final Delivered Quantities
exports.fulfillOrder = async (req, res) => {
    const orderId = req.params.id;
    const { delivered_quantities } = req.body; 

    if (!delivered_quantities) {
        return res.status(400).send("No fulfillment data provided.");
    }

    const client = await pool.connect();
    
    try {
        await client.query("BEGIN");

        // 1. Loop through every item and update its delivered quantity
        for (const [itemId, qty] of Object.entries(delivered_quantities)) {
            if (qty !== "") {
                await client.query(
                    "UPDATE order_items SET delivered_quantity = $1 WHERE id = $2 AND order_id = $3",
                    [parseFloat(qty), itemId, orderId]
                );
            }
        }

        // 2. Mark the Master Order as Fulfilled
        await client.query(
            "UPDATE orders SET status = 'Fulfilled' WHERE id = $1",
            [orderId]
        );

        await client.query("COMMIT");
        res.redirect("/dashboard"); // Redirects Admin back to dashboard after saving

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Fulfillment Error:", err);
        res.status(500).send("Server Error fulfilling order.");
    } finally {
        client.release();
    }
};