const pool = require("../config/db");

// 1. Add a New Branch
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

// 2. Place a New Order (Using Transactions)
exports.placeOrder = async (req, res) => {
  const { branch_id, products } = req.body;
  const userId = req.user.id;

  // Grab a dedicated connection for our transaction
  const client = await pool.connect();

  try {
    await client.query("BEGIN"); // Lock the database

    // 1. Create the main envelope (The Order)
    const orderResult = await client.query(
      "INSERT INTO orders (branch_id, user_id, status) VALUES ($1, $2, 'Pending') RETURNING id",
      [branch_id, userId]
    );
    const newOrderId = orderResult.rows[0].id;

    // 2. Loop through the submitted products and add the items
    for (const [productId, quantity] of Object.entries(products)) {
      // Only process products where the customer actually typed a number greater than 0
      if (quantity && parseFloat(quantity) > 0) {
        
        // Fetch the current price so we lock it in forever (prices change, history shouldn't!)
        const prodData = await client.query("SELECT base_rate, gst_percentage FROM products WHERE id = $1", [productId]);
        const { base_rate, gst_percentage } = prodData.rows[0];

        // Insert the specific item using exact decimal quantities
        await client.query(
          `INSERT INTO order_items 
          (order_id, product_id, ordered_quantity, rate_at_order, gst_at_order) 
          VALUES ($1, $2, $3, $4, $5)`,
          [newOrderId, productId, parseFloat(quantity), base_rate, gst_percentage]
        );
      }
    }

    await client.query("COMMIT"); // Everything worked, save it permanently!
    res.redirect("/dashboard");

  } catch (err) {
    await client.query("ROLLBACK"); // Something broke, erase the half-finished order!
    console.error("Place Order Error:", err);
    res.status(500).send("Server Error placing order");
  } finally {
    client.release(); // Return the connection to the pool
  }
};