const pool = require("../config/db");

exports.renderDashboard = async (req, res) => {
  try {
    // 1. Check the user's wristband to see if they belong to a client company
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
        JOIN orders o ON b.id = o.branch_id
        JOIN order_items oi ON o.id = oi.order_id
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

      return res.render("pages/dashboard", { 
        stats: { customers: customerCount.rows[0].count, branches: branchCount.rows[0].count },
        groupedData: groupedData
      });
    }

    // ==========================================
    // PATH 2: CUSTOMER DASHBOARD (customer_id exists)
    // ==========================================
    // This is where your decimal inputs, Add Branch, and order tracking live!
    
    const branchesQuery = await pool.query("SELECT * FROM branches WHERE customer_id = $1", [customerId]);
    const productsQuery = await pool.query("SELECT * FROM products ORDER BY id");
    const ordersQuery = await pool.query(`
      SELECT o.id, o.status, o.created_at, b.branch_name
      FROM orders o JOIN branches b ON o.branch_id = b.id
      WHERE b.customer_id = $1 ORDER BY o.created_at DESC
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

    // Note: It looks specifically for the new EJS file we made!
    return res.render("pages/customer-dashboard", { stats, branches, products, orders });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Server Error loading dashboard");
  }
};