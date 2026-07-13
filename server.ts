import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Enable middleware
app.use(express.json({ limit: "50mb" }));

// Lazy initializer for Gemini API client
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please manage this secret in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Scrape URL endpoint to extract news text
app.post("/api/scrape-url", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required." });
  }

  try {
    const targetUrl = url.trim();
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch URL. HTTP status: ${response.status}`);
    }

    const html = await response.text();

    // Parse Title
    let title = "";
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    } else {
      const h1Match = html.match(/<h1>([^<]+)<\/h1>/i);
      if (h1Match) title = h1Match[1].trim();
    }

    // Clean html by stripping script, style, header, footer, nav tags
    let cleanHtml = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "");

    // Extract text from <p> paragraphs
    const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    const paragraphs: string[] = [];
    while ((match = pRegex.exec(cleanHtml)) !== null) {
      const pText = match[1]
        .replace(/<[^>]+>/g, "") // Strip inner tags
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (pText.length > 45) { // Filter out low-value snippets
        paragraphs.push(pText);
      }
    }

    let text = paragraphs.slice(0, 30).join("\n\n");
    if (!text) {
      // Body fallback if no paragraphs
      const bodyMatch = cleanHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
      const contentToStrip = bodyMatch ? bodyMatch[1] : cleanHtml;
      text = contentToStrip
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Crop if excessively long
    if (text.length > 20000) {
      text = text.substring(0, 19900) + "... [truncated]";
    }

    res.json({
      title: title || "Scraped News Article",
      text: text || "Could not extract standard paragraph text. Please paste text manually."
    });
  } catch (error: any) {
    console.error("Scraper Error:", error);
    res.status(500).json({ error: error.message || "Failed to extract text from URL." });
  }
});

// Summarize News articles Endpoint
app.post("/api/summarize-news", async (req, res) => {
  const { articles, duration, focus, tone } = req.body;

  if (!articles || !Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ error: "At least one article is required for summarization." });
  }

  try {
    const ai = getAiClient();

    // Map duration parameters
    let wordCountAdvice = "";
    if (duration === "short") {
      wordCountAdvice = "approx 150-230 words, suitable for a 1-2 minute brief listen. Be punchy, focused, and eliminate fluffy transition filler.";
    } else if (duration === "long") {
      wordCountAdvice = "approx 600-800 words, suitable for a comprehensive 5-7 minute commute presentation. Dive into background context, quotes, impacts, and analysis deeply.";
    } else {
      // Default / medium
      wordCountAdvice = "approx 350-450 words, suitable for a steady 3-4 minute commute catchup. Provide an informative summary with clear transitional structure.";
    }

    // Map focus parameters
    let focusInstructions = "";
    if (focus === "tech") {
      focusInstructions = "Highlight tech innovations, engineering solutions, science discoveries, startup angles, and future implications. Skip pure regulatory gossip.";
    } else if (focus === "business") {
      focusInstructions = "Highlight financial figures, corporate strategies, competitive moves, market impacts, scale, and macroeconomic context.";
    } else if (focus === "tldr") {
      focusInstructions = "Structure the synthesis around high-impact, sequential takeaways (summarized as conversational speech points). Keep sentences highly concise.";
    } else if (focus === "narrative") {
      focusInstructions = "Use a rich story-oriented style, weaving articles together in a unified chronology or theme. Make the pacing flowing, narrative-centric, and highly human.";
    } else {
      focusInstructions = "Deliver a balanced, professional, multi-topic news brief presentation. Cover key points from each article evenly with natural transitions.";
    }

    let toneInstructions = `Deliver the presentation in a ${tone || "friendly"} style expression. Make the vocabulary and energy fit this vibe perfectly.`;

    const articlesContent = articles
      .map((art, idx) => `ARTICLE #${idx + 1}:\nTITLE: ${art.title}\nSOURCE: ${art.source || "Unknown"}\nCONTENT:\n${art.text}`)
      .join("\n\n=============\n\n");

    const promptMessage = `
You are a highly talented professional audio-broadcaster and radio anchor.
Summarize and synthesize the provided news articles into a continuous spoken broadcast script for a user's daily commute.

=== WORKPLACE SPECIFICATIONS ===
1. DURATION CRITERIA: Generate a summary script that is ${wordCountAdvice}
2. FOCUS STRATEGY: ${focusInstructions}
3. TONE CRITERIA: ${toneInstructions}
4. SYNTHESIS ORDER: Introduce the broadcast naturally, flow between the topics with smooth audio transitions (e.g. "Next, moving on to...", "Meanwhile in...", "Finally..."), and wrap up gracefully. 
5. ABSOLUTE STRICT TTS COMPATIBILITY RULES:
   - Generate ONLY pure speakable text content.
   - Do NOT use markdown symbols. Absolutely NO asterisks (*), hashtags (#), underscores (_), bold markers, or titles.
   - Do NOT output bullet points list characters or numbering labels. Everything must be continuous narrative sentences.
   - Do NOT add meta commentary or labels like [Anchor], [Voice], "(Narrator:)", [Opening Music].
   - Write everything out as spoken. If there are percentages write 'percent', if dollars write 'dollars'. 
   - Start immediately with the spoken script, beginning with a warm broadcast greeting.

=== SELECTED ARTICLES TO BROACAST ===
${articlesContent}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptMessage,
    });

    const scriptText = response.text || "Failed to generate summary script.";

    // Produce as simple title too
    const titleResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Given this news script, generate a single-line catchy playlist title (maximum 6 words) summarizing it. Do not use quotes or punctuation.\n\nScript:\n${scriptText.substring(0, 500)}`,
    });

    const summaryTitle = (titleResponse.text || "Daily Commute Summary").trim().replace(/["']/g, "");

    res.json({
      title: summaryTitle,
      script: scriptText,
    });
  } catch (error: any) {
    console.error("Summarize Error:", error);
    res.status(500).json({ error: error.message || "Failed to compile summary script." });
  }
});

// TTS Endpoint
app.post("/api/generate-speech", async (req, res) => {
  const { text, voice, tone } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text content is required for speech generation." });
  }

  try {
    const ai = getAiClient();

    // Map our anchor tone description directly into the pre-prompt
    const speedAdvice = "Pronounce carefully, smoothly, at a comfortable reading pace suitable for a commuter podcast.";
    const expressionMap: Record<string, string> = {
      cheerful: "cheerful, expressive, warm, and highly engaging",
      professional: "formal, clear, calm, objective, and authoritative",
      relaxed: "conversational, casual, friendly, smooth, and laidback",
      enthusiastic: "energetic, highly encouraging, vibrant, and enthusiastic",
      dramatic: "expressive, intense, descriptive, and theatrical",
      friendly: "warm, gentle, accessible, and friendly",
    };
    const styledTune = expressionMap[tone] || "natural, conversational, and clear";

    const promptMessage = `Say this text in a ${styledTune} manner. Keep pronunciation clear. ${speedAdvice}\n\n${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: promptMessage }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice || "Kore" },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      throw new Error("No audio data returned by Gemini speech service.");
    }

    res.json({
      audioBase64: base64Audio,
    });
  } catch (error: any) {
    console.error("Speech Generation Error:", error);
    res.status(500).json({ error: error.message || "Failed to synthesize news speech audio." });
  }
});

// Map Image Analysis Endpoint using Gemini 3.5-flash
app.post("/api/gemini/analyze-map", async (req, res) => {
  const { base64Image, mimeType } = req.body;

  if (!base64Image) {
    return res.status(400).json({ error: "No image content provided." });
  }

  try {
    const ai = getAiClient();

    // Strip "data:image/jpeg;base64," header if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    const imageMimeType = mimeType || "image/png";

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: imageMimeType,
      },
    };

    const promptMessage = `
You are a GIS and Hydrogeological Data Extraction Expert.
Analyze this uploaded map image. The map contains water quality sampling points, heatmaps, contour lines, or water monitoring locations.
Extract as many sampling locations as possible. If there is a coordinate grid (latitude/longitude), resolve the absolute coordinates. If there is NO coordinate grid, please estimate realistic relative latitude and longitude coordinates centered around a logical area (e.g. Latitude ~ 25.0 to 26.0 and Longitude ~ 75.0 to 76.0, which is standard, or anywhere logical based on context) so that they can be plotted correctly on a Leaflet map.
For each point:
- Identify its name or Well ID (e.g., 'Station-01', 'WS-A', 'S-12').
- Identify its location/block name (or estimate from map context, e.g. 'North Zone', 'Sector 4').
- Identify the coordinates (latitude, longitude) as numbers.
- Identify the water quality parameter (e.g., pH, TDS, EC, Chloride, Nitrate, Fluoride, Iron, Arsenic) and its corresponding value. Ensure the value is formatted as a numeric float/integer. Map the parameter to one of the following official keys if possible: pH, TDS, Turbidity, Alkalinity, TH, EC, Cl, NO3, F, Fe, As, U (or default to TDS if unclear).

Additionally, write a nice professional summary of your findings (summary string), describing the geographic distribution seen on the uploaded screenshot, whether there are any visible pollution hotspots, and what general parameter trends you noticed.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ parts: [imagePart, { text: promptMessage }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            success: { type: Type.BOOLEAN },
            summary: { type: Type.STRING },
            points: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  wellId: { type: Type.STRING },
                  location: { type: Type.STRING },
                  latitude: { type: Type.NUMBER },
                  longitude: { type: Type.NUMBER },
                  paramName: { type: Type.STRING },
                  value: { type: Type.NUMBER },
                },
                required: ["wellId", "location", "latitude", "longitude", "paramName", "value"],
              },
            },
          },
          required: ["success", "summary", "points"],
        },
      },
    });

    const bodyText = response.text || "{}";
    const data = JSON.parse(bodyText.trim());

    res.json(data);
  } catch (error: any) {
    console.error("Map Image Analysis Error:", error);
    res.status(500).json({ error: error.message || "Failed to analyze map image." });
  }
});

// Configure Vite middleware in development or serve production builds
// Note: This must come AFTER API routes so Express intercepts /api requests first.
const startWebServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Serve SPA index.html for all other routes
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT}`);
  });
};

startWebServer().catch((err) => {
  console.error("WebServer startup failure:", err);
});
