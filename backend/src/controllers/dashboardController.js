const pool = require("../config/db");

exports.renderDashboard = async (req, res) => {
  try {
    const customerId = req.user.customer_id;

    if (!customerId) {
      const customerCount = await pool.query("SELECT COUNT(*) FROM customers");
      const branchCount = await pool.query("SELECT COUNT(*) FROM branches");

      // FIXED: Demand Data now strictly filters for Today's date only
      const hierarchyQuery = await pool.query(`
        SELECT c.company_name, b.branch_name, p.name AS product_name, SUM(oi.ordered_quantity) AS total_qty, p.unit
        FROM customers c
        JOIN branches b ON c.id = b.customer_id
        JOIN order_items oi ON b.id = oi.branch_id
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE CAST(o.created_at AS DATE) = CURRENT_DATE
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
        orders: allOrdersQuery.rows
      });
    }

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

    const stats = {
      totalOrders: ordersQuery.rows.length,
      inProgress: ordersQuery.rows.filter(o => o.status === 'Pending' || o.status === 'Dispatched').length,
      delivered: ordersQuery.rows.filter(o => o.status === 'Fulfilled').length,
      branches: branchesQuery.rows.length
    };

    return res.render("pages/customer-dashboard", { stats, branches: branchesQuery.rows, products: productsQuery.rows, orders: ordersQuery.rows });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Server Error loading dashboard");
  }
};

exports.fulfillOrder = async (req, res) => {
    const orderId = req.params.id;
    const { delivered_quantities } = req.body; 

    if (!delivered_quantities) return res.status(400).send("No fulfillment data provided.");

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        
        // FIXED: Uses branch_id and product_id to guarantee the exact row updates
        for (const [compositeKey, qty] of Object.entries(delivered_quantities)) {
            if (qty !== "" && qty !== null) {
                const [branchId, productId] = compositeKey.split('_');

                await client.query(
                    "UPDATE order_items SET delivered_quantity = $1 WHERE order_id = $2 AND branch_id = $3 AND product_id = $4",
                    [parseFloat(qty), orderId, branchId, productId]
                );
            }
        }

        await client.query("UPDATE orders SET status = 'Fulfilled' WHERE id = $1", [orderId]);
        await client.query("COMMIT");
        res.redirect("/dashboard"); 
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Fulfillment Error:", err);
        res.status(500).send("Server Error fulfilling order.");
    } finally {
        client.release();
    }
};