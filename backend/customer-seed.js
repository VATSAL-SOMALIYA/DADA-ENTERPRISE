const pool = require("./src/config/db");
const bcrypt = require("bcrypt");

async function createDummyCustomer() {
  console.log("Starting customer database seeding...");

  const companyName = "Radhe Madhav Foods";
  const gstin = "24AAACG1234H1W2";
  const email = "radhe@dada.com";
  const plainTextPassword = "radhe123";

  try {
    let customerId;

    // 1. Check if the Customer already exists in the database
    const checkCustomer = await pool.query("SELECT id FROM customers WHERE gstin = $1", [gstin]);
    
    if (checkCustomer.rows.length > 0) {
      console.log("🏢 Customer already exists! Reusing existing profile...");
      customerId = checkCustomer.rows[0].id;
    } else {
      // Create new customer if they don't exist
      const customerResult = await pool.query(
        "INSERT INTO customers (company_name, gstin, contact_number) VALUES ($1, $2, $3) RETURNING id",
        [companyName, gstin, "9876543210"]
      );
      customerId = customerResult.rows[0].id;
    }

    // 2. Check if the User already exists
    const checkUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    
    if (checkUser.rows.length > 0) {
      console.log("⚠️ User already exists! Updating their link to the customer profile...");
      const hashedPassword = await bcrypt.hash(plainTextPassword, 10);
      await pool.query("UPDATE users SET password = $1, customer_id = $2 WHERE email = $3", [hashedPassword, customerId, email]);
    } else {
      // 3. Create the User and link them to the Customer ID
      const hashedPassword = await bcrypt.hash(plainTextPassword, 10);
      await pool.query(
        "INSERT INTO users (name, email, password, customer_id) VALUES ($1, $2, $3, $4)",
        ["Manager Ramesh", email, hashedPassword, customerId]
      );
    }

    console.log("✅ Success! Dummy Customer account is ready.");
    console.log(`✉️  Email: ${email}`);
    console.log(`🔑 Password: ${plainTextPassword}`);

  } catch (err) {
    console.error("❌ Database Error:", err.message);
  } finally {
    process.exit();
  }
}

createDummyCustomer();