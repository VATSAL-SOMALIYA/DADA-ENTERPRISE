// seed.js
const pool = require("./src/config/db");
const bcrypt = require("bcrypt");

async function createAdmin() {
  console.log("Starting database seeding...");

  const email = "dada@admin.com";
  const plainTextPassword = "radh123";

  try {
    // 1. Check if the admin already exists so we don't create duplicates
    const checkUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    
    if (checkUser.rows.length > 0) {
      console.log("⚠️ Admin user already exists in the database.");
      process.exit();
    }

    // 2. Hash the password with a "salt" of 10 rounds (industry standard)
    const hashedPassword = await bcrypt.hash(plainTextPassword, 10);

    // 3. Insert the new admin into the users table
    await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3)",
      ["Master Admin", email, hashedPassword]
    );

    console.log("✅ Success! Master Admin account created.");
    console.log(`✉️  Email: ${email}`);
    console.log(`🔑 Password: ${plainTextPassword}`);

  } catch (err) {
    console.error("❌ Database Error:", err.message);
  } finally {
    // 4. Close the database connection and exit the script
    process.exit();
  }
}

// Run the function
createAdmin();