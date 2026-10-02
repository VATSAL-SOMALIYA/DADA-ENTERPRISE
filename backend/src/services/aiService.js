/**
 * @file aiService.js
 * @description AI Service for Dada Enterprise using Google Gemini API.
 * Features:
 * 1. Multimodal Quantity Extractor (Photo slips, WhatsApp text, Voice audio)
 * 2. Smart Morning Dispatch Briefing for Admin
 * 3. Simple Knowledge Assistant (RAG) with Conversation Memory
 */

const { GoogleGenAI } = require("@google/genai");
const path = require("path");
const fs = require("fs");

// Candidate models in prioritized fallback cascade (tested active & supported)
const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash"
].filter((v, i, a) => v && a.indexOf(v) === i);

// Initialize Gemini Client
const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in .env");
  }
  return new GoogleGenAI({ apiKey });
};

// Resilient helper to call Gemini with automatic model fallback on temporary 503 or 404
const generateWithFallback = async (ai, options) => {
  let lastError;
  for (const model of CANDIDATE_MODELS) {
    try {
      return await ai.models.generateContent({
        ...options,
        model
      });
    } catch (err) {
      lastError = err;
      console.warn(`[AI Warning] Gemini model "${model}" failed (${err.message || err.status}). Falling back to next model...`);
    }
  }
  throw lastError;
};

// Default fallback knowledge base
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
 * 1. Multimodal Order & Fulfillment Quantity Extractor
 * Reads an uploaded image (photo of handwritten slip or printed challan),
 * audio recording (voice order), or raw text (WhatsApp message) and maps it to registered products and branches.
 * 
 * @param {Object} options
 * @param {string} [options.text] - Raw pasted text or transcript
 * @param {Buffer} [options.fileBuffer] - Uploaded image/audio buffer
 * @param {string} [options.mimeType] - MIME type of the uploaded file
 * @param {Array} options.branches - List of valid customer branches [{ id, branch_name }]
 * @param {Array} options.products - List of valid products [{ id, name, unit }]
 * @returns {Promise<Array<{ branch_id: number, product_id: number, quantity: number, notes?: string }>>}
 */
exports.extractQuantities = async ({ text, fileBuffer, mimeType, branches, products }) => {
  const ai = getClient();

  const branchListStr = branches.map(b => `ID ${b.id}: "${b.branch_name}"`).join(", ");
  const productListStr = products.map(p => `ID ${p.id}: "${p.name}" (${p.unit})`).join(", ");

  const systemPrompt = `
You are the AI Order Extraction Engine for Dada Enterprise, a dairy and food distribution company in Gujarat, India.
Your task is to accurately extract order item quantities from the user's input (which can be a photo of a handwritten/printed slip, WhatsApp text, or voice audio).

VALID BRANCHES IN DATABASE:
[${branchListStr}]

VALID PRODUCTS IN DATABASE:
[${productListStr}]

LOCAL TERMINOLOGY RULES:
- "paneer" or "soya paneer" or "tofu" maps to TOFU.
- "chhas" or "buttermilk" or "butter milk" maps to SUMUL BUTTERMILK.
- "dahi" or "curd" or "pb dahi" maps to SUMUL PB DAHI (or SUMUL LITE DAHI if specifically says lite).
- "dudh" or "milk" or "taaza" maps to SUMUL TAAZA.
- "slim" or "diet milk" maps to SUMUL SLIM N TRIM MILK.
- If a quantity has no unit, assume standard product units (KG for Tofu/Dahi, 500mL pouches for Milk/Buttermilk).
- Branch names might have phonetic spellings (e.g. "Adajan", "Vesu", "Katargam", "Nanpura", "Ichhapore", "City light"). Map to closest matching valid branch.
- If multiple branches are mentioned, group items by their respective branch. If only one branch exists in the customer's profile, map all items to that branch.

OUTPUT FORMAT:
Respond STRICTLY with a valid JSON array of objects. Do NOT include markdown code fences, backticks, or any conversational text.
Format:
[
  {
    "branch_id": <valid branch ID number>,
    "product_id": <valid product ID number>,
    "quantity": <positive number>
  }
]
If nothing can be extracted, respond with: []
`;

  const contents = [];

  // Add file part if an image or audio is uploaded
  if (fileBuffer && mimeType) {
    contents.push({
      inlineData: {
        data: fileBuffer.toString("base64"),
        mimeType: mimeType
      }
    });
  }

  // Add text part
  let userTextContent = text && text.trim() ? text.trim() : "Please extract the order items from the attached image/audio.";
  contents.push(userTextContent);

  const response = await generateWithFallback(ai, {
    contents: contents,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.1, // Low temperature for high precision
    }
  });

  const responseText = response.text ? response.text.trim() : "[]";
  
  // Clean markdown fences if any
  const cleaned = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    const extractedData = JSON.parse(cleaned);
    return Array.isArray(extractedData) ? extractedData : [];
  } catch (err) {
    console.error("AI JSON parse error:", responseText);
    return [];
  }
};

/**
 * 2. AI Morning Executive Briefing for Admin Dashboard
 * Generates a 3-bullet smart summary of today's morning dispatches, volume spikes, and pending actions.
 * 
 * @param {Object} options
 * @param {Object} options.groupedData - Hierarchy of branch/product demands for today
 * @param {Array} options.orders - List of today's orders
 * @param {Object} options.stats - Overall counts
 * @returns {Promise<string>} Clean markdown/HTML bullet briefing
 */
exports.generateMorningBriefing = async ({ groupedData, orders, stats }) => {
  const ai = getClient();

  const prompt = `
You are the Executive Operations Director AI for Dada Enterprise (Dairy & Tofu Distribution).
Generate a crisp, professional 3 to 4 bullet morning operational briefing for the owner at 6:00 AM.

TODAY'S OPERATIONS DATA:
- Total Customers: ${stats.customers}
- Total Branches Configured: ${stats.branches}
- Total Active Orders: ${orders ? orders.length : 0}
- Detailed Branch Demand Hierarchy: ${JSON.stringify(groupedData)}

RULES:
1. Provide exactly 3 or 4 concise bullet points.
2. Highlight high-demand product volumes (e.g. Total Tofu KG, Total Buttermilk pouches across all branches).
3. Mention key branches receiving heavy dispatches.
4. If orders are pending, add an alert to mark them fulfilled.
5. Use professional tone with appropriate emojis (📊, 🚚, 🥛, ⚠️).
6. Return only the bullet points without introductory or concluding filler.
`;

  const response = await generateWithFallback(ai, {
    contents: prompt,
    config: {
      temperature: 0.3
    }
  });

  return response.text ? response.text.trim() : "All morning dispatches are proceeding normally.";
};

/**
 * 3. Simple Knowledge Assistant (RAG) with Conversation Memory
 * Answers customer or admin questions strictly grounded on company facts, product HSN/tax rates, and order rules.
 * 
 * @param {Object} options
 * @param {string} options.question - User's current message
 * @param {Array} [options.history] - Array of previous turns [{ role: 'user'|'model', text: string }]
 * @returns {Promise<string>}
 */
exports.askSupportBot = async ({ question, history = [] }) => {
  const ai = getClient();

  // Format knowledge base context
  const contextText = knowledgeBase
    .map(k => `[${k.category.toUpperCase()}] ${k.topic}: ${k.content}`)
    .join("\n");

  const systemInstruction = `
You are "Dada Assistant", the friendly AI support specialist for Dada Enterprise (a B2B dairy and fresh tofu supplier in Gujarat).
Your duty is to answer questions about products, base rates, GST percentages, HSN codes, and delivery schedules.

COMPANY VERIFIED KNOWLEDGE BASE:
----------------------------------------
${contextText}
----------------------------------------

GUIDELINES:
1. Answer strictly based on the verified knowledge base above.
2. If the user asks in Gujarati or Hindi, answer politely in the same language.
3. Keep answers concise, clear, and easy to read on mobile.
4. If asked something completely outside Dada Enterprise's business, politely state you only assist with Dada Enterprise products and orders.
`;

  // Build conversational turns for Gemini
  const contents = [];
  if (Array.isArray(history)) {
    // Keep last 4 turns for efficient memory window
    const recentHistory = history.slice(-4);
    for (const msg of recentHistory) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text || msg.content || "" }]
      });
    }
  }

  // Append current user message
  contents.push({
    role: "user",
    parts: [{ text: question }]
  });

  const response = await generateWithFallback(ai, {
    contents: contents,
    config: {
      systemInstruction: systemInstruction,
      temperature: 0.2
    }
  });

  return response.text ? response.text.trim() : "I am here to help with your orders and product queries.";
};
