/**
 * @file dashboardController.js
 * @description Controller responsible for rendering portal dashboards (admin / customer specific) 
 * and processing order fulfillment updates (along with customer notifications).
 */

const pool = require("../config/db");

/**
 * Renders the dashboard view.
 * - For administrators (customer_id = null): Compiles today's product demand sums across all branches and active orders.
 * - For customers (customer_id != null): Compiles overall order stats (in-progress vs delivered) and displays branches & products.
 * 
 * @param {import("express").Request} req - Express request object containing verified JWT user details.
 * @param {import("express").Response} res - Express response rendering dashboard EJS templates.
 * @returns {Promise<void>}
 */
exports.renderDashboard = async (req, res) => {
  try {
    const customerId = req.user.customer_id;

    // Shift current system time to Indian Standard Time (IST) to ensure correct date boundary calculations.
    // 'en-CA' outputs date in format YYYY-MM-DD, matching standard date comparisons.
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    if (!customerId) {
      // --- ADMIN PORTAL VIEWS ---
      const customerCount = await pool.query("SELECT COUNT(*) FROM customers");
      const branchCount = await pool.query("SELECT COUNT(*) FROM branches");

      // Compile product distribution sum for each branch today.
      // Shifts DB timestamp using timezone('Asia/Kolkata', o.created_at) before comparing with local date.
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

      // Pivot rows into hierarchy groupings for nesting inside administration UI
      const groupedData = {};
      hierarchyQuery.rows.forEach(row => {
        if (!groupedData[row.company_name]) groupedData[row.company_name] = {};
        if (!groupedData[row.company_name][row.branch_name]) groupedData[row.company_name][row.branch_name] = [];
        groupedData[row.company_name][row.branch_name].push({
          product: row.product_name, qty: row.total_qty, unit: row.unit
        });
      });

      // Retrieve today's active order records
      const allOrdersQuery = await pool.query(`
        SELECT o.id, o.status, o.created_at, c.company_name, STRING_AGG(DISTINCT b.branch_name, ', ') as branch_names
        FROM orders o 
        JOIN order_items oi ON o.id = oi.order_id
        JOIN branches b ON oi.branch_id = b.id
        JOIN customers c ON b.customer_id = c.id
        WHERE timezone('Asia/Kolkata', o.created_at)::date = $1::date
        GROUP BY o.id, o.status, o.created_at, c.company_name
        ORDER BY o.created_at DESC
      `, [todayIST]);

      const customersQuery = await pool.query("SELECT id, company_name FROM customers ORDER BY company_name");

      return res.render("pages/dashboard", { 
        stats: { customers: customerCount.rows[0].count, branches: branchCount.rows[0].count },
        groupedData: groupedData,
        orders: allOrdersQuery.rows,
        customers: customersQuery.rows
      });
    }

    // --- CUSTOMER PORTAL VIEWS ---
    const branchesQuery = await pool.query("SELECT * FROM branches WHERE customer_id = $1", [customerId]);
    const productsQuery = await pool.query("SELECT * FROM products ORDER BY id");
    
    // Fetch orders history for this specific customer
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

/**
 * Fulfills an active order by writing actual delivered product quantities.
 * Implements transaction blocks and fires SMS/WhatsApp delivery updates to customer's contact.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.fulfillOrder = async (req, res) => {
    const orderId = req.params.id;
    const { delivered_quantities } = req.body; 

    if (!delivered_quantities) {
      return res.status(400).send("No fulfillment data provided.");
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        
        // Loop and update each branch/product item with actual delivered quantities
        for (const [compositeKey, qty] of Object.entries(delivered_quantities)) {
            if (qty !== "" && qty !== null) {
                const [branchId, productId] = compositeKey.split('_');

                await client.query(
                    "UPDATE order_items SET delivered_quantity = $1 WHERE order_id = $2 AND branch_id = $3 AND product_id = $4",
                    [parseFloat(qty), orderId, branchId, productId]
                );
            }
        }

        // Mark the overall order header as 'Fulfilled'
        await client.query("UPDATE orders SET status = 'Fulfilled' WHERE id = $1", [orderId]);
        await client.query("COMMIT");
        
        // Asynchronously dispatch fulfillment notification logs to customer contact
        (async () => {
          try {
            // Find customer/user target phone numbers
            const customerQuery = await pool.query(
              `SELECT COALESCE(c.contact_number, u.contact_number) AS contact_number, c.company_name 
               FROM orders o 
               JOIN users u ON o.user_id = u.id 
               LEFT JOIN customers c ON u.customer_id = c.id 
               WHERE o.id = $1`,
              [orderId]
            );

            const customer = customerQuery.rows[0];
            const targetPhone = customer?.contact_number || "+91 9016764959";

            // Aggregate items list containing final values
            const itemsQuery = await pool.query(
              `SELECT oi.delivered_quantity, p.name AS product_name, p.unit, b.branch_name 
               FROM order_items oi 
               JOIN products p ON oi.product_id = p.id 
               JOIN branches b ON oi.branch_id = b.id 
               WHERE oi.order_id = $1 
               ORDER BY b.branch_name, p.name`,
              [orderId]
            );

            const itemsSummary = itemsQuery.rows
              .map(item => `• ${item.branch_name} - ${item.product_name}: ${item.delivered_quantity} ${item.unit}`)
              .join("\n");

            const { sendSms, sendWhatsapp } = require("../config/notificationService");
            const smsMessage = `DADA Enterprise: Order (ID: ${orderId}) has been processed!\nDelivered quantities:\n${itemsSummary}`;
            const whatsappMessage = `🔔 *Order Fulfillment Update*\n\nYour order *ID: ${orderId}* has been processed!\n\n*Delivered Quantities*:\n${itemsSummary}\n\nThank you for doing business with us!`;

            await sendSms(targetPhone, smsMessage);
            await sendWhatsapp(targetPhone, whatsappMessage);
          } catch (err) {
            console.error("Failed to send customer notification:", err);
          }
        })();

        res.redirect("/dashboard"); 
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Fulfillment Error:", err);
        res.status(500).send("Server Error fulfilling order.");
    } finally {
        client.release();
    }
};