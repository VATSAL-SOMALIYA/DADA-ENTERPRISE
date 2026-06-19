const pool = require("../config/db");

exports.renderDashboard = async (req, res) => {
  try {
    // Fetch top-level stats
    const customerCount = await pool.query("SELECT COUNT(*) FROM customers");
    const branchCount = await pool.query("SELECT COUNT(*) FROM branches");

    // Fetch hierarchical data: Customers -> Branches -> Products
    const hierarchyQuery = await pool.query(`
      SELECT 
        c.company_name, 
        b.branch_name, 
        p.name AS product_name, 
        SUM(oi.ordered_quantity) AS total_qty, 
        p.unit
      FROM customers c
      JOIN branches b ON c.id = b.customer_id
      JOIN orders o ON b.id = o.branch_id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      GROUP BY c.company_name, b.branch_name, p.name, p.unit
      ORDER BY c.company_name, b.branch_name
    `);

    // Format the flat SQL rows into a nested JavaScript object for EJS
    const groupedData = {};
    hierarchyQuery.rows.forEach(row => {
      if (!groupedData[row.company_name]) {
        groupedData[row.company_name] = {};
      }
      if (!groupedData[row.company_name][row.branch_name]) {
        groupedData[row.company_name][row.branch_name] = [];
      }
      groupedData[row.company_name][row.branch_name].push({
        product: row.product_name,
        qty: row.total_qty,
        unit: row.unit
      });
    });

    res.render("pages/dashboard", { 
      stats: {
        customers: customerCount.rows[0].count,
        branches: branchCount.rows[0].count
      },
      groupedData: groupedData
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Server Error loading dashboard");
  }
};