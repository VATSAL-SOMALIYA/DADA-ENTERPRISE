/**
 * @file initDb.js
 * @description Auto-initialization database utility.
 * Programmatically checks for and creates all database tables (customers, users, branches, 
 * products, orders, order_items, and otp_verifications) if they are missing.
 * Seeds default products, customers, branches, and admin credentials if the tables are empty.
 */

const pool = require("./db");
const bcrypt = require("bcrypt");

/**
 * Initializes the database schema and default records.
 * @returns {Promise<void>}
 */
async function initDb() {
  try {
    console.log("🛠️ Starting database schema verification...");
    
    // 1. Create tables if they do not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL,
        gstin VARCHAR(255) UNIQUE,
        contact_number VARCHAR(255),
        address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reset_token VARCHAR(255),
        reset_token_expires TIMESTAMP,
        contact_number VARCHAR(255),
        security_question VARCHAR(255) NOT NULL DEFAULT 'What is your favorite food?',
        security_answer VARCHAR(255) NOT NULL DEFAULT 'dhokla'
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
        branch_name VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        hsn_code VARCHAR(255),
        unit VARCHAR(255) NOT NULL,
        base_rate NUMERIC NOT NULL,
        gst_percentage NUMERIC DEFAULT 5.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(255) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fulfilled_at TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        ordered_quantity NUMERIC NOT NULL,
        delivered_quantity NUMERIC,
        rate_at_order NUMERIC NOT NULL,
        gst_at_order NUMERIC NOT NULL,
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        otp VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        type VARCHAR(50) NOT NULL,
        payload JSONB
      );
    `);

    // Migration: ensure security question & answer columns exist for legacy users
    // Note: While useful for our current workflow, using static security questions for password recovery 
    // is not the most secure standard (MFA/TOTP/email verification is preferred in high-security production environments).
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question VARCHAR(255) NOT NULL DEFAULT 'What is your favorite food?';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS security_answer VARCHAR(255) NOT NULL DEFAULT 'dhokla';
    `);

    // Migration: ensure address column exists in customers table
    await pool.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
    `);

    console.log("✅ Database tables verified.");

    // 2. Seed default products if products table is empty
    const prodCheck = await pool.query("SELECT COUNT(*) FROM products");
    if (parseInt(prodCheck.rows[0].count) === 0) {
      console.log("🌱 Seeding default products...");
      const defaultProducts = [
        { id: 1, name: 'TOFU', hsn_code: '1208', unit: 'KG', base_rate: 122.00, gst_percentage: 5.00 },
        { id: 2, name: 'SUMUL PB DAHI', hsn_code: '4039010', unit: 'KG', base_rate: 76.20, gst_percentage: 5.00 },
        { id: 3, name: 'SUMUL BUTTERMILK', hsn_code: '4039010', unit: '500mL', base_rate: 16.19, gst_percentage: 5.00 },
        { id: 4, name: 'SUMUL SLIM N TRIM MILK', hsn_code: '1', unit: '500mL', base_rate: 26.00, gst_percentage: 0.00 },
        { id: 5, name: 'SUMUL TAAZA', hsn_code: '1', unit: '500mL', base_rate: 29.00, gst_percentage: 0.00 },
        { id: 6, name: 'SUMUL LITE DAHI', hsn_code: '4039090', unit: 'KG', base_rate: 57.14, gst_percentage: 5.00 }
      ];

      for (const p of defaultProducts) {
        await pool.query(
          "INSERT INTO products (id, name, hsn_code, unit, base_rate, gst_percentage) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
          [p.id, p.name, p.hsn_code, p.unit, p.base_rate, p.gst_percentage]
        );
      }
      
      // Update serial sequence
      await pool.query("SELECT setval('products_id_seq', (SELECT MAX(id) FROM products))");
      console.log("✅ Default products seeded.");
    }

    // 3. Seed default customers if empty
    const custCheck = await pool.query("SELECT COUNT(*) FROM customers");
    let custMap = {};
    if (parseInt(custCheck.rows[0].count) === 0) {
      console.log("🌱 Seeding default customers...");
      const defaultCustomers = [
        { id: 1, company_name: 'Radhe Madhav Foods', gstin: '24AAACG1234H1W2', contact_number: '9876543210', address: 'Shop G1 – D, Bhagwati Ashish Apartment – 1, City Light Road, S.R. NO 144, TPS:4, FP 149, Umra, Surat' },
        { id: 2, company_name: 'Radhe Dhokla Private Limited', gstin: '24AAACG1234H1W3', contact_number: '9016764959', address: 'G-01/B, GROUND FLOOR, Atlanta Shoppers by Shree Krishna Developers, Vesu Main Road, Vesu, Surat, Surat, Gujarat, 395007' }
      ];

      for (const c of defaultCustomers) {
        const res = await pool.query(
          "INSERT INTO customers (id, company_name, gstin, contact_number, address) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [c.id, c.company_name, c.gstin, c.contact_number, c.address]
        );
        custMap[c.id] = res.rows[0].id;
      }
      await pool.query("SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers))");
      console.log("✅ Default customers seeded.");
    } else {
      // Map existing and ensure names/addresses are up to date
      await pool.query(`
        UPDATE customers 
        SET company_name = 'Radhe Dhokla Private Limited', 
            address = 'G-01/B, GROUND FLOOR, Atlanta Shoppers by Shree Krishna Developers, Vesu Main Road, Vesu, Surat, Surat, Gujarat, 395007'
        WHERE id = 2;
      `);
      await pool.query(`
        UPDATE customers 
        SET company_name = 'Radhe Madhav Foods', 
            address = 'Shop G1 – D, Bhagwati Ashish Apartment – 1, City Light Road, S.R. NO 144, TPS:4, FP 149, Umra, Surat'
        WHERE id = 1 OR id = 4;
      `);

      const existing = await pool.query("SELECT id FROM customers ORDER BY id");
      existing.rows.forEach((r, idx) => {
        custMap[idx + 1] = r.id;
      });
    }

    // 4. Seed default branches if empty
    const branchCheck = await pool.query("SELECT COUNT(*) FROM branches");
    if (parseInt(branchCheck.rows[0].count) === 0 && Object.keys(custMap).length > 0) {
      console.log("🌱 Seeding default branches...");
      const defaultBranches = [
        { customer_id: 1, name: 'Adajan', address: 'Surat' },
        { customer_id: 1, name: 'Vesu', address: 'Surat' },
        { customer_id: 1, name: 'Katargam', address: 'Surat' },
        { customer_id: 1, name: 'Nanpura', address: 'Surat' },
        { customer_id: 1, name: 'Rustompura', address: 'Surat' },
        { customer_id: 1, name: 'Malad', address: 'Mumbai' },
        { customer_id: 1, name: 'Andheri', address: 'Mumbai' },
        { customer_id: 1, name: 'Ghatkopat', address: 'Mumbai' },
        { customer_id: 1, name: 'Kandiwali', address: 'Mumbai' },
        { customer_id: 1, name: 'Mulund', address: 'Mumbai' },
        { customer_id: 1, name: 'Anand', address: 'Anand' },
        { customer_id: 1, name: 'Baroda', address: 'Baroda' },
        { customer_id: 1, name: 'Baroda-Manjalpur', address: 'Baroda' },
        { customer_id: 1, name: 'AMD - 1', address: 'Ahmedabad' },
        { customer_id: 1, name: 'AMD - 2(NP)', address: 'Ahmedabad' },
        { customer_id: 1, name: 'AMD - 3(CK)', address: 'Ahmedabad' },
        { customer_id: 1, name: 'Navsari', address: 'Navsari' },
        { customer_id: 1, name: 'Icchapore', address: 'Surat' },
        { customer_id: 2, name: 'Citylight', address: 'Surat' }
      ];

      for (const b of defaultBranches) {
        const mappedCustId = custMap[b.customer_id];
        if (mappedCustId) {
          await pool.query(
            "INSERT INTO branches (customer_id, branch_name, address) VALUES ($1, $2, $3)",
            [mappedCustId, b.name, b.address]
          );
        }
      }
      console.log("✅ Default branches seeded.");
    }

    // 5. Seed default users if empty
    const userCheck = await pool.query("SELECT COUNT(*) FROM users");
    if (parseInt(userCheck.rows[0].count) === 0) {
      console.log("🌱 Seeding default users...");
      const adminPass = await bcrypt.hash("radh123", 10);
      const custPass = await bcrypt.hash("radhe123", 10);

      // Seed Admin
      await pool.query(
        "INSERT INTO users (name, email, password, customer_id, contact_number) VALUES ($1, $2, $3, $4, $5)",
        ["Master Admin", "dada@admin.com", adminPass, null, "+91 9016764959"]
      );

      // Seed Customer User 1 (linked to customer 1)
      if (custMap[1]) {
        await pool.query(
          "INSERT INTO users (name, email, password, customer_id, contact_number) VALUES ($1, $2, $3, $4, $5)",
          ["Manager Ramesh", "radhe@dada.com", custPass, custMap[1], "+91 9016764959"]
        );
      }

      // Seed Customer User 2 (linked to customer 2)
      if (custMap[2]) {
        await pool.query(
          "INSERT INTO users (name, email, password, customer_id, contact_number) VALUES ($1, $2, $3, $4, $5)",
          ["Manager Dhokla", "radhedhokla@dada.com", custPass, custMap[2], "+91 9016764959"]
        );
      }

      console.log("✅ Default users seeded.");
    }

    // 6. Synchronize primary key sequences for all tables to prevent duplicate key errors on future inserts
    const tablesToSync = ["branches", "customers", "users", "orders", "order_items", "products"];
    for (const table of tablesToSync) {
      await pool.query(`SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id) FROM ${table}), 1))`);
    }
    console.log("✅ Database sequences synchronized.");
    
    console.log("✅ Database schema initialization completed successfully!");
  } catch (err) {
    console.error("❌ Database Schema Initialization Error:", err);
    throw err;
  }
}

let initPromise = null;
module.exports = function() {
  if (!initPromise) {
    initPromise = initDb();
  }
  return initPromise;
};
