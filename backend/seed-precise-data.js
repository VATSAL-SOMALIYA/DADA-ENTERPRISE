const pool = require("./src/config/db");
const initDb = require("./src/config/initDb");

const tofuData = {
  "Adajan": [11.05, 12.14, 11.37, 11.175, 11.35, 5.56, 8.43, 7.95, 11.02, 12.32],
  "Vesu": [3.495, 8.18, 5.46, 5.55, 3.33, 5.37, 5.38, 5.35, 5.52, 5.495],
  "Katargam": [5.905, 5.33, 5.205, 10.47, 5.42, 5.26, 5.42, null, 5.31, 5.405],
  "Nanpura": [5.31, 3.55, 5.27, 5.42, 5.295, 5.14, 5.11, 7.32, 4.055, 5.225],
  "Rustompura": [5.33, 5.17, 5.055, 3.3, 5.46, 5.295, 5.03, 4.825, 2.83, null],
  "Kandiwali": [10.38, 21.67, 11.095, null, 5.01, 8.14, 3.91, 6.265, 10.485, 10.595],
  "Malad": [null, 6.635, 10.175, 6.19, null, null, null, null, 6.09, 10.77],
  "Andheri": [null, 6.685, 10.59, 10.7, null, 10.4, null, 6.135, 10.64, 10],
  "Ghatkopat": [null, 6.82, 7.4, 7.55, 6.515, 5.315, 5.79, null, 6.415, 5.945],
  "Anand": [null, null, 2.775, 2.775, null, null, 2.645, null, 5.36, 3.105],
  "Baroda": [null, 3.71, null, 5.2, null, 5.07, null, null, 5.075, 2.66],
  "Baroda-Manjalpur": [5.34, null, 2.565, 3.46, 3.2, 2.935, null, 5.205, null, 2.85],
  "AMD - 1": [5.355, 5.925, 10.81, null, 5.6, 5.315, 7.43, 7.555, 7.52, null],
  "AMD - 2(NP)": [5.24, null, 5.305, null, null, 5.04, null, null, 5.975, null],
  "AMD - 3(CK)": [null, 5.92, 3.475, null, null, 5.72, null, 3.54, 3.33, null],
  "Mulund": [null, null, 6.02, 11.395, null, null, null, null, 6.525, 5.765],
  "Navsari": [2.585, null, 3.465, 2.715, 6.135, 3.1, 5.46, null, 5.01, 5.51]
};

const dairyData = {
  "Adajan": {
    4: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    2: [15, 10, 15, 10, 15, null, 8, 10, 10, 15],
    3: [12, 12, 12, 12, 12, 12, 12, 12, 12, 12]
  },
  "Vesu": {
    4: [4, 2, 2, 2, 2, 2, 2, 4, 3, 4],
    2: [10, 10, 12, 12, 10, 8, 10, 10, 5, 12],
    3: [10, 10, 10, 12, 12, 12, 10, 10, 10, 10]
  },
  "Katargam": {
    4: [4, null, null, null, null, null, null, null, null, null],
    2: [5, 5, 5, 4, 4, 5, 4, 4, 4, 3],
    3: [10, 10, 10, 10, 10, 10, 10, 10, 10, 12]
  },
  "Nanpura": {
    4: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    2: [10, 5, 8, 8, 12, 8, 6, 8, 5, 8],
    3: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
  },
  "Rustompura": {
    4: [1, 2, null, 1, 1, 2, 1, 2, 2, 2],
    2: [12, 8, 9, 12, 12, 6, 8, 9, 4, 12],
    3: [12, 10, null, 10, 10, 10, 10, 10, 10, 10]
  },
  "Icchapore": {
    5: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
    3: [28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
  },
  "Baroda": {
    2: [10, 10, 15, 8, 10, 10, 10, 8, 10, 10]
  },
  "Baroda-Manjalpur": {
    2: [6, 7, 6, null, 7, 6, 5, 4, 4, 7]
  }
};

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

async function seedPreciseData() {
  await initDb();

  // Guard: check if there are existing orders to prevent overwriting/deleting live data
  try {
    const orderCheck = await pool.query("SELECT COUNT(*) FROM orders");
    if (parseInt(orderCheck.rows[0].count) > 0) {
      console.log("⚠️ Orders already exist in the database. Skipping seeding to prevent data loss.");
      process.exit(0);
    }
  } catch (err) {
    console.error("❌ Error checking existing orders:", err);
    process.exit(1);
  }

  console.log("Cleaning existing orders and order_items...");
  try {
    await pool.query("BEGIN");
    
    await pool.query("DELETE FROM order_items");
    await pool.query("DELETE FROM orders");
    
    console.log("Database cleared! Resolving branches and products...");

    // Get branches mapping
    const branchRes = await pool.query("SELECT id, branch_name FROM branches WHERE customer_id = 1");
    const branches = {};
    branchRes.rows.forEach(b => {
      branches[b.branch_name] = b.id;
    });

    // Products list mapping
    const productsRes = await pool.query("SELECT id, base_rate, gst_percentage FROM products");
    const products = {};
    productsRes.rows.forEach(p => {
      products[p.id] = { rate: Number(p.base_rate), gst: Number(p.gst_percentage) };
    });

    const userId = 2; // Manager Ramesh

    for (let i = 0; i < dates.length; i++) {
      const dateStr = dates[i];

      // Create fulfilled order for this date
      const orderRes = await pool.query(
        "INSERT INTO orders (user_id, status, created_at) VALUES ($1, 'Fulfilled', $2) RETURNING id",
        [userId, dateStr]
      );
      const orderId = orderRes.rows[0].id;

      // Seed Tofu Data
      for (const [branchName, qtys] of Object.entries(tofuData)) {
        const branchId = branches[branchName];
        if (!branchId) {
          console.warn(`⚠️ Warning: Branch ${branchName} not found in database.`);
          continue;
        }

        const qty = qtys[i];
        if (qty !== null && qty > 0) {
          const pInfo = products[1]; // TOFU is product_id = 1
          await pool.query(
            `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, branchId, 1, qty, qty, pInfo.rate, pInfo.gst]
          );
        }
      }

      // Seed Dairy Data
      for (const [branchName, productQtys] of Object.entries(dairyData)) {
        const branchId = branches[branchName];
        if (!branchId) {
          console.warn(`⚠️ Warning: Branch ${branchName} not found in database.`);
          continue;
        }

        for (const [prodIdStr, qtys] of Object.entries(productQtys)) {
          const productId = Number(prodIdStr);
          const qty = qtys[i];

          if (qty !== null && qty > 0) {
            const pInfo = products[productId];
            if (!pInfo) {
              console.warn(`⚠️ Warning: Product ${productId} not found in database.`);
              continue;
            }

            await pool.query(
              `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [orderId, branchId, productId, qty, qty, pInfo.rate, pInfo.gst]
            );
          }
        }
      }
    }
    // Insert a 2nd order for a few branches on June 20th (2026-06-20) to test multiple orders aggregation
    console.log("Seeding a 2nd order for June 20th...");
    const secondOrderRes = await pool.query(
      "INSERT INTO orders (user_id, status, created_at) VALUES ($1, 'Fulfilled', '2026-06-20') RETURNING id",
      [userId]
    );
    const secondOrderId = secondOrderRes.rows[0].id;

    // 1. Tofu order for Adajan (quantity 5.000)
    await pool.query(
      `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [secondOrderId, branches["Adajan"], 1, 5.000, 5.000, products[1].rate, products[1].gst]
    );

    // 2. Tofu order for Vesu (quantity 2.000)
    await pool.query(
      `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [secondOrderId, branches["Vesu"], 1, 2.000, 2.000, products[1].rate, products[1].gst]
    );

    // 3. Dairy order (PB Dahi - id 2) for Adajan (quantity 10)
    await pool.query(
      `INSERT INTO order_items (order_id, branch_id, product_id, ordered_quantity, delivered_quantity, rate_at_order, gst_at_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [secondOrderId, branches["Adajan"], 2, 10, 10, products[2].rate, products[2].gst]
    );

    await pool.query("COMMIT");
    console.log("✅ Success! Precise order data for 10 days has been seeded successfully.");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Error seeding precise data:", err);
  } finally {
    process.exit();
  }
}

seedPreciseData();
