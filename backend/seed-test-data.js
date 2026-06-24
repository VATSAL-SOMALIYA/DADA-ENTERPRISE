const pool = require("./src/config/db");
const initDb = require("./src/config/initDb");

async function seedTestData() {
  await initDb();
  console.log("Cleaning existing orders data...");
  try {
    await pool.query("BEGIN");
    
    // Clear existing order items and orders
    await pool.query("DELETE FROM order_items");
    await pool.query("DELETE FROM orders");
    
    console.log("Database cleared! Inserting 10-day test order data...");

    // Get all branches of customer 1 (Radhe Madhav Foods)
    const branchRes = await pool.query("SELECT id, branch_name FROM branches WHERE customer_id = 1");
    const branches = branchRes.rows;

    if (branches.length === 0) {
      console.log("No branches found for customer 1! Please run customer-seed.js first.");
      await pool.query("ROLLBACK");
      process.exit(1);
    }

    // Products list mapping
    const products = [
      { id: 1, rate: 122.00, gst: 5.00, name: 'TOFU' },
      { id: 2, rate: 76.20, gst: 5.00, name: 'SUMUL PB DAHI' },
      { id: 3, rate: 16.19, gst: 5.00, name: 'SUMUL BUTTERMILK' },
      { id: 4, rate: 26.00, gst: 0.00, name: 'SUMUL SLIM N TRIM MILK' },
      { id: 5, rate: 29.00, gst: 0.00, name: 'SUMUL TAAZA' }
    ];

    const dates = [
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
      "2026-06-15",
      "2026-06-16",
      "2026-06-17",
      "2026-06-18",
      "2026-06-19",
      "2026-06-20"
    ];

    const userId = 2; // Manager Ramesh

    for (const dateStr of dates) {
      // Create a fulfilled order for this date
      const orderRes = await pool.query(
        "INSERT INTO orders (user_id, status, created_at) VALUES ($1, 'Fulfilled', $2) RETURNING id",
        [userId, dateStr]
      );
      const orderId = orderRes.rows[0].id;

      // Insert order items for each branch
      for (const branch of branches) {
        // Tofu product (id: 1) - with decimal quantities, randomly skipped for some branches/dates
        if (Math.random() > 0.15) {
          const qty = Math.round((5 + Math.random() * 10) * 1000) / 1000;
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 1, qty, qty, 122.00, 5.00]
          );
        }

        // Dairy products (ids: 2, 3, 4, 5) - integer quantities
        if (branch.branch_name === 'Adajan' || branch.branch_name === 'Vesu' || branch.branch_name === 'Katargam' || branch.branch_name === 'Nanpura') {
          // DOODH (4)
          const qtyDoodh = Math.floor(2 + Math.random() * 6);
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 4, qtyDoodh, qtyDoodh, 26.00, 0.00]
          );

          // DAHI-PB (2)
          const qtyDahi = Math.floor(5 + Math.random() * 11);
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 2, qtyDahi, qtyDahi, 76.20, 5.00]
          );

          // STAFF (Buttermilk - 3)
          const qtyStaff = Math.floor(8 + Math.random() * 8);
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 3, qtyStaff, qtyStaff, 16.19, 5.00]
          );
        } else if (branch.branch_name === 'Baroda' || branch.branch_name === 'Baroda-Manjalpur') {
          // Only DAHI-PB (2)
          const qtyDahi = Math.floor(4 + Math.random() * 8);
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 2, qtyDahi, qtyDahi, 76.20, 5.00]
          );
        } else if (branch.branch_name === 'Anand') {
          // DAHI-PB (2) and STAFF (3)
          const qtyDahi = Math.floor(3 + Math.random() * 7);
          const qtyStaff = Math.floor(4 + Math.random() * 8);
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 2, qtyDahi, qtyDahi, 76.20, 5.00]
          );
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branch.id, 3, qtyStaff, qtyStaff, 16.19, 5.00]
          );
        } else {
          // Others get random dairy product occasionally
          if (Math.random() > 0.5) {
            const prod = products[1 + Math.floor(Math.random() * 4)];
            const qty = Math.floor(2 + Math.random() * 8);
            await pool.query(
              `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [orderId, branch.id, prod.id, qty, qty, prod.rate, prod.gst]
            );
          }
        }
      }
    }

    await pool.query("COMMIT");
    console.log("✅ Success! 10 days of order data seeded successfully!");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Error seeding test data:", err);
  } finally {
    process.exit();
  }
}

seedTestData();
