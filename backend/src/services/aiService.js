/**
 * @file aiService.js
 * @description Universal AI Service for Dada Enterprise.
 * Automatically supports both Google Gemini AND Groq (LLaMA / GPT-OSS) based on the provided API key.
 */

const { GoogleGenAI } = require("@google/genai");
const path = require("path");
const fs = require("fs");

// Detect API Key & Provider
const getApiKey = () => {
  return process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || "";
};

const isGroq = () => {
  const key = getApiKey();
  return key.trim().startsWith("gsk_");
};

// Candidate Groq models with graceful fallback if a model is unavailable
const GROQ_MODELS = [
  process.env.GEMINI_MODEL,
  process.env.AI_MODEL,
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b"
].filter(Boolean);

// Candidate Gemini models (prioritizing high-availability lite models to prevent 503 errors)
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  process.env.AI_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash"
].filter(Boolean);

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
 * Universal caller for Groq API
 */
async function callGroq({ systemPrompt, userText, history = [], temperature = 0.2 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key configured in .env");

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  // Add history
  if (Array.isArray(history)) {
    for (const msg of history.slice(-4)) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.text || msg.content || ""
      });
    }
  }

  // Add current message
  messages.push({ role: "user", content: userText });

  let lastError;
  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ? data.error.message : `Groq error status ${res.status}`);
      }
      return data.choices && data.choices[0] ? data.choices[0].message.content : "";
    } catch (err) {
      lastError = err;
      console.warn(`[Groq Warning] Model "${model}" failed (${err.message}). Trying fallback...`);
    }
  }
  throw lastError;
}

/**
 * Universal caller for Google Gemini API
 */
async function callGemini({ systemPrompt, contents, temperature = 0.2 }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No API key configured in .env");

  const ai = new GoogleGenAI({ apiKey });

  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          temperature
        }
      });
      return response.text ? response.text.trim() : "";
    } catch (err) {
      lastError = err;
      const statusMsg = err.status || err.message || "error";
      console.warn(`[Gemini Warning] Model "${model}" failed (${statusMsg}). Trying fallback...`);
    }
  }
  throw lastError;
}

/**
 * 1. AI Quantity Extractor (Photo slip, WhatsApp text, Voice audio)
 */
exports.extractQuantities = async ({ text, fileBuffer, mimeType, branches, products }) => {
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

  let rawText = "[]";

  if (isGroq()) {
    const userText = text && text.trim() ? text.trim() : "Extract order items from this slip.";
    rawText = await callGroq({
      systemPrompt,
      userText,
      temperature: 0.1
    });
  } else {
    const contents = [];
    if (fileBuffer && mimeType) {
      contents.push({
        inlineData: {
          data: fileBuffer.toString("base64"),
          mimeType: mimeType
        }
      });
    }
    const userText = text && text.trim() ? text.trim() : "Extract order items from this slip.";
    contents.push(userText);

    rawText = await callGemini({
      systemPrompt,
      contents,
      temperature: 0.1
    });
  }

  const cleaned = (rawText || "[]").replace(/```json/gi, "").replace(/```/g, "").trim();

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

  if (isGroq()) {
    const res = await callGroq({
      systemPrompt: "You are the Operations Director AI for Dada Enterprise.",
      userText: prompt,
      temperature: 0.3
    });
    return res || "All morning dispatches are proceeding normally.";
  } else {
    const res = await callGemini({
      systemPrompt: "You are the Operations Director AI for Dada Enterprise.",
      contents: [prompt],
      temperature: 0.3
    });
    return res || "All morning dispatches are proceeding normally.";
  }
};

/**
 * 3. AI Support Chatbot for Rates and Rules
 */
exports.askSupportBot = async ({ question, history = [] }) => {
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

  if (isGroq()) {
    const res = await callGroq({
      systemPrompt: systemInstruction,
      userText: question,
      history,
      temperature: 0.2
    });
    return res || "I am here to help with your orders and product queries.";
  } else {
    const contents = [];
    if (Array.isArray(history)) {
      for (const msg of history.slice(-4)) {
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

    const res = await callGemini({
      systemPrompt: systemInstruction,
      contents,
      temperature: 0.2
    });
    return res || "I am here to help with your orders and product queries.";
  }
};
