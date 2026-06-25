const pool = require("./db");

/**
 * Formats and prints a detailed order receipt to the server console log
 * so it can be easily copied/printed from Render logs.
 * 
 * @param {number|string} orderId - The database ID of the order.
 * @param {"PLACED" | "EDITED" | "FULFILLED"} actionType - The type of order action.
 */
async function printOrderLog(orderId, actionType) {
  try {
    const orderQuery = await pool.query(`
      SELECT o.id, o.status, o.created_at, o.fulfilled_at, u.name AS user_name, c.company_name
      FROM orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON u.customer_id = c.id
      WHERE o.id = $1
    `, [orderId]);

    if (orderQuery.rows.length === 0) {
      console.log(`[OrderPrinter] Order ID ${orderId} not found.`);
      return;
    }

    const order = orderQuery.rows[0];
    const itemsQuery = await pool.query(`
      SELECT oi.ordered_quantity, oi.delivered_quantity, oi.rate_at_order, oi.gst_at_order,
             p.name AS product_name, p.unit, b.branch_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN branches b ON oi.branch_id = b.id
      WHERE oi.order_id = $1
      ORDER BY b.branch_name, p.name
    `, [orderId]);

    const items = itemsQuery.rows;

    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const interiorWidth = 81;
    const titleText = `DADA ENTERPRISE - ORDER ${actionType}`;
    const leftPad = Math.floor((interiorWidth - titleText.length) / 2);
    const rightPad = interiorWidth - titleText.length - leftPad;
    const titleLine = `║${" ".repeat(leftPad)}${titleText}${" ".repeat(rightPad)}║`;

    let out = [];
    out.push("");
    out.push("╔═════════════════════════════════════════════════════════════════════════════════╗");
    out.push(titleLine);
    out.push("╠═════════════════════════════════════════════════════════════════════════════════╣");
    out.push(`  Order ID        : ORD-${String(order.id).padStart(4, '0')}`);
    out.push(`  Current Status  : ${order.status}`);
    out.push(`  Customer Name   : ${order.company_name || 'N/A'}`);
    out.push(`  Placed By User  : ${order.user_name}`);
    out.push(`  Placed At       : ${new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    if (order.fulfilled_at) {
      out.push(`  Fulfilled At    : ${new Date(order.fulfilled_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    }
    out.push(`  Log Print Time  : ${timestamp}`);
    out.push("╠═════════════════════════════════════════════════════════════════════════════════╣");
    out.push(
      "  " +
      "Branch Name".padEnd(25) +
      "Product Name".padEnd(20) +
      "Ordered Qty".padStart(13) +
      "Delivered Qty".padStart(15)
    );
    out.push("  -----------------------------------------------------------------------------");

    items.forEach(item => {
      const ordered = `${parseFloat(item.ordered_quantity).toFixed(2)} ${item.unit}`;
      const delivered = item.delivered_quantity !== null 
        ? `${parseFloat(item.delivered_quantity).toFixed(2)} ${item.unit}` 
        : "Pending";
      
      out.push(
        "  " +
        item.branch_name.substring(0, 24).padEnd(25) +
        item.product_name.substring(0, 19).padEnd(20) +
        ordered.padStart(13) +
        delivered.padStart(15)
      );
    });

    out.push("╚═════════════════════════════════════════════════════════════════════════════════╝");
    out.push("");

    console.log(out.join("\n"));
  } catch (err) {
    console.error("[OrderPrinter Error] Failed to print order log:", err);
  }
}

module.exports = { printOrderLog };
