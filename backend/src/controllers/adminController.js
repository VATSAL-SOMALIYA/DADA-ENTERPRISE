const pool = require("../config/db");

// Admin Submits Final Delivered Quantities
exports.fulfillOrder = async (req, res) => {
    const orderId = req.params.id;
    const { delivered_quantities } = req.body; // e.g., { "item_id_1": 50.25, "item_id_2": 10 }

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
        res.redirect("/admin/orders"); // Or wherever your admin orders tab is

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Fulfillment Error:", err);
        res.status(500).send("Server Error fulfilling order.");
    } finally {
        client.release();
    }
};