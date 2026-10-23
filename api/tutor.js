export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const question = String(req.body?.question || "").trim();
  if (!question) return res.status(400).json({ error: "Please enter a message." });
  if (question.length > 2000) return res.status(400).json({ error: "Please keep your message under 2,000 characters." });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: "The AI assistant needs GEMINI_API_KEY in the Vercel project environment." });

  // Accept only a short, bounded history of plain-text messages from this conversation.
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];
  const contents = [];
  for (const item of history) {
    const text = String(item?.text || "").trim();
    if (!text || text.length > 4000) continue;
    const role = item?.role === "assistant" || item?.role === "model" ? "model" : item?.role === "user" ? "user" : null;
    if (!role) continue;
    // Gemini expects alternating user/model turns. Ignore repeated roles rather than send invalid history.
    if (contents.length && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += "\n" + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  if (contents.length && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts[0].text += "\n\nLatest message: " + question;
  } else {
    contents.push({ role: "user", parts: [{ text: question }] });
  }
  // Ensure the first message is a user turn, as required by Gemini.
  while (contents.length && contents[0].role !== "user") contents.shift();

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You are Awaji AI, a helpful conversational assistant built into Awaji English Academy for learners in Nigeria. You can answer general educational questions and help with English learning, grammar, vocabulary, writing, pronunciation and everyday conversation. Use simple, clear language. Support Hausa translations and explanations when requested or helpful. Remember and use the supplied conversation history to understand follow-up questions. Correct mistakes gently. If a request is unrelated to English, still be helpful and accurate. Do not claim to remember chats outside the conversation history supplied to you." }] },
        contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 900 }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini assistant error:", response.status, JSON.stringify(data).slice(0, 700));
      return res.status(502).json({ error: "The AI service could not answer. Please try again shortly." });
    }

    const answer = (data.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("\n").trim();
    if (!answer) return res.status(502).json({ error: "The AI returned an empty answer. Please try again." });
    return res.status(200).json({ answer });
  } catch (error) {
    console.error("AI assistant request failed:", error);
    return res.status(500).json({ error: "Unable to reach the AI service. Please try again." });
  }
}
