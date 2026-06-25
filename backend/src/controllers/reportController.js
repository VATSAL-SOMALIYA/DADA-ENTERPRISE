/**
 * @file reportController.js
 * @description Controller responsible for compiling sales reports (dairy and tofu products)
 * and generating detailed, tax-compliant GST invoices. Includes currency formatting helpers.
 */

const pool = require("../config/db");

/**
 * Standard sorting priority map for products.
 * Defines the custom sort order for products on report lists.
 * @type {Object<number, number>}
 */
const productOrder = {
    4: 1, // SUMUL SLIM N TRIM MILK
    5: 2, // SUMUL TAAZA
    2: 3, // SUMUL PB DAHI
    6: 4, // SUMUL LITE DAHI
    3: 5, // SUMUL BUTTERMILK
    1: 6  // TOFU
};

/**
 * Resolves sorting rank for a product.
 * Falls back to 99 if product id is unrecognized.
 * 
 * @param {number} productId - The product database ID.
 * @returns {number} The sorting priority rank.
 */
function getProductRank(productId) {
    return productOrder[productId] || 99;
}

/**
 * Generates pivoted report views grouped by branch, product, and dates.
 * Accommodates multiple orders on a single date by assigning incremental ranks.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.generateReport = async (req, res) => {
    const { startDate, endDate, reportType, branchId } = req.query; 

    if (!startDate || !endDate || !reportType) {
        return res.status(400).send("Missing required report parameters: startDate, endDate, reportType");
    }

    const customerIdFromUser = req.user.customer_id;
    const targetCustomerId = customerIdFromUser ? customerIdFromUser : (req.query.customerId || null);

    try {
        // Generate listing of all dates within range to display as individual columns.
        // Formatted using UTC boundaries to prevent timezone shifting.
        const dates = [];
        let [y, m, d] = startDate.split('-').map(Number);
        let curr = new Date(Date.UTC(y, m - 1, d));
        let [ey, em, ed] = endDate.split('-').map(Number);
        let last = new Date(Date.UTC(ey, em - 1, ed));

        while (curr <= last) {
            dates.push(curr.toISOString().split('T')[0]);
            curr.setUTCDate(curr.getUTCDate() + 1);
        }

        // Build base SQL query to retrieve items within dates
        let query = `
            SELECT 
                o.id AS order_id,
                b.id AS branch_id,
                b.branch_name, 
                p.id AS product_id,
                p.name AS product_name, 
                o.created_at::date::text AS date, 
                oi.delivered_quantity AS quantity, 
                oi.rate_at_order AS rate,
                oi.gst_at_order AS gst
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN branches b ON oi.branch_id = b.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.status = 'Fulfilled'
              AND o.created_at::date >= $1 
              AND o.created_at::date <= $2
        `;
        let params = [startDate, endDate];

        if (targetCustomerId) {
            params.push(targetCustomerId);
            query += ` AND b.customer_id = $${params.length}`;
        }

        if (branchId && branchId !== 'ALL') {
            params.push(branchId);
            query += ` AND b.id = $${params.length}`;
        }

        query += ` ORDER BY b.id ASC`;

        const { rows } = await pool.query(query, params);

        // Filter based on reportType: 'tofu' (tofu/paneer products) vs 'dairy' (milk/buttermilk/dahi products)
        const filteredRows = rows.filter(row => {
            const isTofu = row.product_name.toLowerCase().includes('tofu') || row.product_name.toLowerCase().includes('paneer');
            return reportType === 'tofu' ? isTofu : !isTofu;
        });

        // Sort items for rank calculations
        filteredRows.sort((a, b) => {
            if (a.branch_id !== b.branch_id) return a.branch_id - b.branch_id;
            if (a.product_id !== b.product_id) return a.product_id - b.product_id;
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.order_id - b.order_id;
        });

        // Compute local sequence ranks for multiple order postings on a single date
        const dailyCounts = {};
        filteredRows.forEach(row => {
            const key = `${row.branch_id}_${row.product_id}_${row.date}`;
            if (dailyCounts[key] === undefined) {
                dailyCounts[key] = 0;
            }
            row.rank = dailyCounts[key];
            dailyCounts[key]++;
        });

        // Group rows under branch -> product -> rank hierarchies
        const groups = {};
        const branchOrder = [];

        filteredRows.forEach(row => {
            const dateStr = row.date;
            const branchId = row.branch_id;
            const productId = row.product_id;
            const rank = row.rank;
            
            if (!groups[branchId]) {
                groups[branchId] = {
                    branchId,
                    branchName: row.branch_name,
                    products: {}
                };
                branchOrder.push(branchId);
            }
            
            if (!groups[branchId].products[productId]) {
                groups[branchId].products[productId] = {};
            }
            
            if (!groups[branchId].products[productId][rank]) {
                groups[branchId].products[productId][rank] = {
                    productId,
                    productName: row.product_name,
                    rank,
                    rate: Number(row.rate),
                    gst: Number(row.gst),
                    price: Number(row.rate) * (1 + Number(row.gst) / 100),
                    dailyQtys: {},
                    totalQty: 0
                };
                // Initialize all date cells in the pivot table row with 0 quantity
                dates.forEach(date => {
                    groups[branchId].products[productId][rank].dailyQtys[date] = 0;
                });
            }
            
            const qty = Number(row.quantity);
            groups[branchId].products[productId][rank].dailyQtys[dateStr] += qty;
            groups[branchId].products[productId][rank].totalQty += qty;
        });

        // Map aggregated groups into report lists
        const reportRows = [];
        branchOrder.forEach(branchId => {
            const branchGroup = groups[branchId];
            
            const itemsList = [];
            Object.keys(branchGroup.products).forEach(prodIdStr => {
                const productId = Number(prodIdStr);
                const ranksObj = branchGroup.products[productId];
                Object.values(ranksObj).forEach(prodRankData => {
                    if (prodRankData.totalQty > 0) {
                        itemsList.push(prodRankData);
                    }
                });
            });

            // Sort items inside this branch group
            itemsList.sort((a, b) => {
                const rankA = getProductRank(a.productId);
                const rankB = getProductRank(b.productId);
                if (rankA !== rankB) return rankA - rankB;
                return a.rank - b.rank;
            });
            
            itemsList.forEach((item, index) => {
                // Round daily quantities to 3 decimal places to display clean measurements
                dates.forEach(d => {
                    item.dailyQtys[d] = Math.round(item.dailyQtys[d] * 1000) / 1000;
                });

                const isFirstItem = (index === 0);
                let label;
                if (reportType === 'tofu') {
                    // For tofu reports, display branch name as the main row header
                    if (isFirstItem) {
                        label = branchGroup.branchName.toUpperCase();
                    } else {
                        label = '';
                    }
                } else {
                    // For dairy reports, combine branch name and product name
                    if (isFirstItem) {
                        label = `${branchGroup.branchName}-${item.productName}`;
                    } else {
                        label = item.productName;
                    }
                }
                
                // Round final unit pricing depending on product category
                const finalPrice = reportType === 'tofu' ? (Math.round(item.price * 10) / 10) : Math.round(item.price);
                const totalAmount = Math.round(item.totalQty * finalPrice * 100) / 100;
                
                reportRows.push({
                    label,
                    dailyQtys: item.dailyQtys,
                    totalQty: Math.round(item.totalQty * 1000) / 1000,
                    price: finalPrice,
                    totalAmount
                });
            });
        });

        // Compute summary totals for the footer row
        const columnTotals = {};
        dates.forEach(d => columnTotals[d] = 0);
        let overallQty = 0;
        let overallAmount = 0;
        
        reportRows.forEach(row => {
            dates.forEach(d => {
                columnTotals[d] += row.dailyQtys[d];
            });
            overallQty += row.totalQty;
            overallAmount += row.totalAmount;
        });
        
        dates.forEach(d => {
            columnTotals[d] = Math.round(columnTotals[d] * 1000) / 1000;
        });
        overallQty = Math.round(overallQty * 1000) / 1000;
        overallAmount = Math.round(overallAmount * 100) / 100;

        res.render("pages/report-view", {
            reportType,
            dates,
            rows: reportRows,
            totals: {
                ...columnTotals,
                overallQty,
                overallAmount
            }
        });

    } catch (err) {
        console.error("Report Error:", err);
        res.status(500).send("Error generating report");
    }
};

/**
 * Mapping state codes (first two digits of GSTIN) to state names.
 * @type {Object<string, string>}
 */
const stateCodes = {
    '24': 'Gujarat',
    '27': 'Maharashtra'
};

/**
 * Extracts and maps the state name and code from a GSTIN number.
 * 
 * @param {string} gstin - The customer/seller GSTIN string.
 * @returns {string} Human-friendly state label.
 */
function getStateName(gstin) {
    if (!gstin) return '';
    const code = gstin.substring(0, 2);
    const name = stateCodes[code] || 'Other';
    return `${name} - ${code}`;
}

/**
 * Spells out an integer value in standard Indian numbering words.
 * 
 * @param {number} num - The rounded integer amount.
 * @returns {string} Word-representation string (e.g. "One Lakh Two Thousand only").
 */
function numberToIndianWords(num) {
    if (num === 0) return 'Zero';
    
    const a = [
        '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
    ];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function helper(n) {
        let str = '';
        if (n >= 100) {
            str += a[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 20) {
            str += b[Math.floor(n / 10)] + ' ';
            n %= 10;
        }
        if (n > 0) {
            str += a[n] + ' ';
        }
        return str.trim();
    }
    
    let words = '';
    
    if (num >= 10000000) {
        words += helper(Math.floor(num / 10000000)) + ' Crore ';
        num %= 10000000;
    }
    if (num >= 100000) {
        words += helper(Math.floor(num / 100000)) + ' Lakh ';
        num %= 100000;
    }
    if (num >= 1000) {
        words += helper(Math.floor(num / 1000)) + ' Thousand ';
        num %= 1000;
    }
    if (num > 0) {
        words += helper(num);
    }
    
    return words.replace(/\s+/g, ' ').trim() + ' only';
}

/**
 * Compiles a GST-compliant tax invoice.
 * Groups delivered items by product, matches state codes to split taxes (CGST/SGST vs IGST),
 * computes rounding differences, and formats numbers to word spellings.
 * 
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<void>}
 */
exports.generateGstInvoice = async (req, res) => {
    const { customerId, startDate, endDate, invoiceDate, invoiceNo, sellerGstin, customerGstin } = req.query;

    if (!customerId || !startDate || !endDate || !invoiceDate || !invoiceNo || !sellerGstin) {
        return res.status(400).send("Missing required parameters for GST invoice.");
    }

    try {
        // 1. Fetch customer details
        const customerResult = await pool.query("SELECT * FROM customers WHERE id = $1", [customerId]);
        if (customerResult.rows.length === 0) {
            return res.status(404).send("Customer not found.");
        }
        const customer = customerResult.rows[0];

        // 1b. If customerGstin is provided and is different from the database record, update it
        if (customerGstin !== undefined) {
            const cleanGstin = customerGstin.trim();
            if (cleanGstin !== (customer.gstin || "")) {
                await pool.query("UPDATE customers SET gstin = $1 WHERE id = $2", [cleanGstin || null, customerId]);
                customer.gstin = cleanGstin || null;
            }
        }

        // 2. Fetch order items (aggregated by product HSN code and rate at time of order)
        const query = `
            SELECT 
                p.id AS product_id,
                p.name AS product_name, 
                p.hsn_code,
                p.unit,
                SUM(oi.delivered_quantity) AS quantity, 
                oi.rate_at_order AS rate,
                oi.gst_at_order AS gst
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN branches b ON oi.branch_id = b.id
            JOIN products p ON oi.product_id = p.id
            WHERE o.status = 'Fulfilled'
              AND b.customer_id = $1
              AND o.created_at::date >= $2 
              AND o.created_at::date <= $3
            GROUP BY p.id, p.name, p.hsn_code, p.unit, oi.rate_at_order, oi.gst_at_order
            ORDER BY p.id
        `;
        const { rows } = await pool.query(query, [customerId, startDate, endDate]);

        const invoiceRows = [];
        let subTotalTaxable = 0;
        let subTotalGst = 0;
        let subTotalAmount = 0;

        // Group breakdown values by unique GST rates
        const gstBreakdown = {};

        rows.forEach(row => {
            const quantity = Number(row.quantity);
            if (quantity <= 0) return;

            let displayUnit = row.unit;
            let displayQty = quantity;
            let displayRate = Number(row.rate);

            // standard conversions for milk packaging types (half-liter conversions)
            if (row.unit === '500mL') {
                displayUnit = 'L';
                displayQty = quantity / 2;
                displayRate = Number(row.rate) * 2;
            } else if (row.unit === 'KG') {
                displayUnit = 'KG';
            }

            const taxableValue = displayQty * displayRate;
            const gstPercentage = Number(row.gst);
            const gstAmount = taxableValue * (gstPercentage / 100);
            const totalAmount = taxableValue + gstAmount;

            // Round values to 2 decimal places
            const roundedTaxable = Math.round(taxableValue * 100) / 100;
            const roundedGst = Math.round(gstAmount * 100) / 100;
            const roundedTotal = Math.round(totalAmount * 100) / 100;

            invoiceRows.push({
                productName: row.product_name,
                hsnCode: row.hsn_code,
                displayQty: Math.round(displayQty * 1000) / 1000,
                displayUnit,
                displayRate: Math.round(displayRate * 100) / 100,
                taxableValue: roundedTaxable,
                gstPercentage,
                gstAmount: roundedGst,
                totalAmount: roundedTotal
            });

            subTotalTaxable += roundedTaxable;
            subTotalGst += roundedGst;
            subTotalAmount += roundedTotal;

            // Group values for GST tax schedule table breakdown
            const gstKey = gstPercentage.toFixed(2);
            if (!gstBreakdown[gstKey]) {
                gstBreakdown[gstKey] = {
                    gstPercentage,
                    taxableAmt: 0,
                    cgstAmt: 0,
                    sgstAmt: 0,
                    igstAmt: 0,
                    totalAmt: 0
                };
            }
            gstBreakdown[gstKey].taxableAmt += roundedTaxable;
        });

        // Determine if state codes match. 
        // If intra-state (seller & buyer in same state): split tax into CGST (50%) and SGST (50%).
        // If inter-state (different states): allocate entirely to IGST.
        const sellerStateCode = sellerGstin.substring(0, 2);
        const buyerStateCode = customer.gstin ? customer.gstin.substring(0, 2) : sellerStateCode;
        const isIntraState = (sellerStateCode === buyerStateCode);

        let overallTaxable = 0;
        let overallCgst = 0;
        let overallSgst = 0;
        let overallIgst = 0;
        let overallTotalAmt = 0;

        for (const gstKey of Object.keys(gstBreakdown)) {
            const group = gstBreakdown[gstKey];
            group.taxableAmt = Math.round(group.taxableAmt * 100) / 100;
            
            if (isIntraState) {
                const halfRate = group.gstPercentage / 2;
                group.cgstAmt = Math.round(group.taxableAmt * (halfRate / 100) * 100) / 100;
                group.sgstAmt = group.cgstAmt;
                group.totalAmt = Math.round((group.taxableAmt + group.cgstAmt + group.sgstAmt) * 100) / 100;
                
                overallCgst += group.cgstAmt;
                overallSgst += group.sgstAmt;
            } else {
                group.igstAmt = Math.round(group.taxableAmt * (group.gstPercentage / 100) * 100) / 100;
                group.totalAmt = Math.round((group.taxableAmt + group.igstAmt) * 100) / 100;
                
                overallIgst += group.igstAmt;
            }
            overallTaxable += group.taxableAmt;
            overallTotalAmt += group.totalAmt;
        }

        // Round final calculations
        subTotalTaxable = Math.round(subTotalTaxable * 100) / 100;
        subTotalGst = Math.round(subTotalGst * 100) / 100;
        subTotalAmount = Math.round(subTotalAmount * 100) / 100;

        overallTaxable = Math.round(overallTaxable * 100) / 100;
        overallCgst = Math.round(overallCgst * 100) / 100;
        overallSgst = Math.round(overallSgst * 100) / 100;
        overallIgst = Math.round(overallIgst * 100) / 100;
        overallTotalAmt = Math.round(overallTotalAmt * 100) / 100;

        // Perform final mathematical rounding to integer
        const finalRoundedTotal = Math.round(subTotalAmount);
        const roundOff = Math.round((finalRoundedTotal - subTotalAmount) * 100) / 100;
        const finalWords = numberToIndianWords(finalRoundedTotal);

        res.render("pages/gst-invoice", {
            invoiceNo,
            invoiceDate: new Date(invoiceDate).toLocaleDateString('en-GB'),
            sellerGstin,
            customer,
            invoiceRows,
            isIntraState,
            gstBreakdown: Object.values(gstBreakdown).sort((a, b) => b.gstPercentage - a.gstPercentage),
            getStateName,
            totals: {
                subTotalTaxable,
                subTotalGst,
                subTotalAmount,
                overallTaxable,
                overallCgst,
                overallSgst,
                overallIgst,
                overallTotalAmt,
                finalRoundedTotal,
                roundOff,
                finalWords
            }
        });

    } catch (err) {
        console.error("GST Invoice Error:", err);
        res.status(500).send("Error generating GST invoice");
    }
};