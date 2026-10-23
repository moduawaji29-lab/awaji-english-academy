// api/tutor.js
// Awaji English Academy — conversational AI tutor with a bounded Gemini request.
// Replace the existing api/tutor.js file with this complete file.

const MODEL = "gemini-3.8-flash";
const REQUEST_TIMEOUT_MS = 25000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 6000;

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const messages = [];
  for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item.text !== "string") continue;

    const text = item.text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) continue;

    const role = item.role === "assistant" || item.role === "model"
      ? "model"
      : item.role === "user"
        ? "user"
        : null;

    if (!role) continue;

    // Gemini expects alternating user/model turns. Merge adjacent turns
    // with the same role instead of sending an invalid conversation.
    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + text;
    } else {
      messages.push({ role, parts: [{ text }] });
    }
  }

  // A Gemini conversation should begin with a user message.
  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }

  return messages;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Use POST to send a message." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured.");
    return sendJson(res, 500, {
      error: "The AI assistant is not configured yet. Please try again later."
    });
  }

  const question = typeof req.body?.question === "string"
    ? req.body.question.trim().slice(0, MAX_MESSAGE_CHARS)
    : "";

  if (!question) {
    return sendJson(res, 400, { error: "Please type a question first." });
  }

  const history = normalizeHistory(req.body?.history);
  const lastMessage = history[history.length - 1];

  if (lastMessage && lastMessage.role === "user") {
    lastMessage.parts[0].text += "\n\nCurrent message: " + question;
  } else {
    history.push({ role: "user", parts: [{ text: question }] });
  }

  const contents = history.length
    ? history
    : [{ role: "user", parts: [{ text: question }] }];

  const systemInstruction = {
    parts: [{
      text:
        "You are Awaji AI Assistant, a helpful, friendly, patient general assistant " +
        "inside Awaji English Academy. Answer questions clearly and naturally. " +
        "Help users learn English when relevant, and explain English words or grammar " +
        "in simple English and Hausa when requested. You may answer general knowledge " +
        "questions too. If the user writes in Hausa, respond in Hausa. Keep answers " +
        "useful and appropriately concise. Do not claim to have performed actions you " +
        "cannot perform. If a question is ambiguous, ask a brief follow-up question."
    }]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200
          }
        }),
        signal: controller.signal
      }
    );

    const rawText = await response.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      console.error("Gemini returned non-JSON output. HTTP status:", response.status);
      return sendJson(res, 502, {
        error: "The AI service returned an unexpected response. Please try again."
      });
    }

    if (!response.ok) {
      // Log only status and provider message; never log the API key or full URL.
      const providerMessage = data?.error?.message || "Unknown Gemini API error";
      console.error("Gemini API error:", response.status, providerMessage);

      if (response.status === 429) {
        return sendJson(res, 429, {
          error: "The AI assistant is busy right now. Please wait a little and try again."
        });
      }

      return sendJson(res, 502, {
        error: "The AI service could not answer this message right now. Please try again."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map(part => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();

    if (!answer) {
      const reason = data?.candidates?.[0]?.finishReason;
      console.error("Gemini returned no answer. Finish reason:", reason || "not provided");
      return sendJson(res, 502, {
        error: "I couldn't form an answer to that message. Please rephrase it and try again."
      });
    }

    return sendJson(res, 200, { answer });
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error("Gemini request timed out after", REQUEST_TIMEOUT_MS, "ms.");
      return sendJson(res, 504, {
        error: "The AI service took too long to respond. Please try again in a moment."
      });
    }

    console.error("AI tutor request failed:", error?.message || "Unknown error");
    return sendJson(res, 502, {
      error: "I couldn't connect to the AI service. Please check your connection and try again."
    });
  } finally {
    clearTimeout(timeout);
  }
};
