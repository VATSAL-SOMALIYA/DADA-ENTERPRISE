/**
 * @file aiService.js
 * @description Simple AI Service for Dada Enterprise using Google Gemini.
 */

const { GoogleGenAI } = require("@google/genai");
const path = require("path");
const fs = require("fs");

// Gemini Model
const GEMINI_MODEL = "gemini-3.5-flash";

// Initialize Gemini Client
const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in .env");
  }
  return new GoogleGenAI({ apiKey });
};

// Load company facts for the support bot
let knowledgeBase = [];
try {
  const kbPath = path.join(__dirname, "../data/knowledgeBase.json");
  if (fs.existsSync(kbPath)) {
    knowledgeBase = JSON.parse(fs.readFileSync(kbPath, "utf-8"));
  }
} catch (err) {
  console.warn("Could not load knowledgeBase.json:", err.message);
}

/**
 * 1. AI Quantity Extractor (Photo slip, WhatsApp text, Voice audio)
 */
exports.extractQuantities = async ({ text, fileBuffer, mimeType, branches, products }) => {
  const ai = getClient();

  const branchListStr = branches.map(b => `ID ${b.id}: "${b.branch_name}"`).join(", ");
  const productListStr = products.map(p => `ID ${p.id}: "${p.name}" (${p.unit})`).join(", ");

  const systemPrompt = `
You are the AI Order Extraction Engine for Dada Enterprise, a dairy and food distribution company in Gujarat, India.
Your task is to extract order quantities from user input (slip photo, WhatsApp text, or voice transcript).

VALID BRANCHES:
[${branchListStr}]

VALID PRODUCTS:
[${productListStr}]

RULES:
- PRODUCT MAPPING:
  * "paneer" / "soya paneer" / "tofu" maps to TOFU.
  * "chhas" / "buttermilk" maps to SUMUL BUTTERMILK.
  * "dahi" / "curd" maps to SUMUL PB DAHI (or SUMUL LITE DAHI if specifically says lite).
  * MILK RULES:
    - DEFAULT MILK IS SUMUL SLIM N TRIM MILK. Whenever the input mentions "milk", "dudh", "slim", "diet milk", or does not specify the milk type, map it to SUMUL SLIM N TRIM MILK.
    - Use SUMUL TAAZA ONLY when explicitly specified by name (e.g. "taaza", "sumul taaza", "taaza milk").
  * If no unit is mentioned, assume standard product units (KG for Tofu/Dahi, pouches for Milk/Buttermilk).

- BRANCH ALIAS & LOCATION MAPPING:
  * "Vastrapur" is also a name / alias for branch "AHM1" (or "AHM-1").
  * "HL" and "Navrangpura" are names / aliases for branch "AHM-2" (or "AHM2").
  * "Chandkheda" is also a name / alias for branch "AHM3" (or "AHM-3").
  * For other branches, map to the closest matching valid branch name from the list above.
  * If the customer has only one branch configured, map all items to that branch.

OUTPUT FORMAT:
Return ONLY a valid JSON array of objects. No markdown formatting.
[
  {
    "branch_id": <branch ID>,
    "product_id": <product ID>,
    "quantity": <number>
  }
]
If nothing detected, return: []
`;

  const contents = [];

  // Add image/audio file if uploaded
  if (fileBuffer && mimeType) {
    contents.push({
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType
      }
    });
  }

  // Add text
  const userText = text && text.trim() ? text.trim() : "Extract order items from this slip.";
  contents.push(userText);

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.1
    }
  });

  const rawText = response.text ? response.text.trim() : "[]";
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    const data = JSON.parse(cleaned);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("AI JSON parse error:", rawText);
    return [];
  }
};

/**
 * 2. AI Morning Briefing for Admin Dashboard
 */
exports.generateMorningBriefing = async ({ groupedData, orders, stats }) => {
  const ai = getClient();

  const prompt = `
You are the Operations AI for Dada Enterprise (Dairy & Tofu Distribution).
Generate a crisp 3 to 4 bullet morning briefing for the owner.

DATA:
- Total Customers: ${stats.customers}
- Total Branches: ${stats.branches}
- Active Orders: ${orders ? orders.length : 0}
- Branch Demand Details: ${JSON.stringify(groupedData)}

RULES:
1. Provide 3 or 4 concise bullet points.
2. Summarize key product volumes (e.g. Total Tofu KG, Total Buttermilk pouches).
3. Mention heavy dispatch branches.
4. If orders are pending, add an alert.
5. Use emojis (📊, 🚚, 🥛, ⚠️).
6. Return only bullet points.
`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      temperature: 0.3
    }
  });

  return response.text ? response.text.trim() : "All morning dispatches are proceeding normally.";
};

/**
 * 3. AI Support Chatbot for Rates and Rules
 */
exports.askSupportBot = async ({ question, history = [] }) => {
  const ai = getClient();

  const contextText = knowledgeBase
    .map(k => `[${k.category.toUpperCase()}] ${k.topic}: ${k.content}`)
    .join("\n");

  const systemInstruction = `
You are "Dada Assistant", the friendly AI support specialist for Dada Enterprise (dairy & fresh tofu supplier in Gujarat).
Answer customer questions about products, rates, GST, HSN codes, and delivery timings.

KNOWLEDGE BASE:
${contextText}

GUIDELINES:
1. Answer based on the knowledge base above.
2. If asked in Gujarati or Hindi, answer in that language.
3. Keep answers short and polite.
`;

  const contents = [];
  if (Array.isArray(history)) {
    const recent = history.slice(-4);
    for (const msg of recent) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text || msg.content || "" }]
      });
    }
  }

  contents.push({
    role: "user",
    parts: [{ text: question }]
  });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: contents,
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.2
    }
  });

  return response.text ? response.text.trim() : "I am here to help with your orders and product queries.";
};
