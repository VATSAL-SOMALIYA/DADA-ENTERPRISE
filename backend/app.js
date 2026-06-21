require("dotenv").config();
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");

// 1. Import your Route files (The Waiters)
const authRoutes = require("./src/routes/authRoutes");
const customerRoutes = require("./src/routes/customerRoutes"); // ADD THIS
const dashboardRoutes = require("./src/routes/dashboardRoutes");

const app = express();

// --- CONFIGURATION ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src", "views"));

// --- GLOBAL MIDDLEWARE ---
app.use(express.static(path.join(__dirname, "public"))); // Serves your style.css
app.use(express.urlencoded({ extended: true })); // Reads HTML form data
app.use(cookieParser()); // Reads the secure JWT cookies

// --- ROUTE MOUNTING ---
app.use("/", authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/customer", customerRoutes);



// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
