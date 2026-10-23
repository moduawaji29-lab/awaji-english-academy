// api/tutor.js
// Awaji English Academy — conversational Gemini assistant with fallback.
// Replace the existing api/tutor.js with this complete file.

const PRIMARY_MODEL = "gemini-3.8-flash";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const PER_MODEL_TIMEOUT_MS = 10000;
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

    const role =
      item.role === "assistant" || item.role === "model"
        ? "model"
        : item.role === "user"
          ? "user"
          : null;

    if (!role) continue;

    const last = messages[messages.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + text;
    } else {
      messages.push({ role, parts: [{ text }] });
    }
  }

  // Gemini conversations must begin with a user turn.
  while (messages.length && messages[0].role !== "user") {
    messages.shift();
  }

  return messages;
}

async function callGemini(model, apiKey, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return {
        ok: false,
        status: response.status,
        message: "Gemini returned a response that was not valid JSON."
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: data?.error?.message || "Unknown Gemini API error."
      };
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map(part => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();

    if (!answer) {
      return {
        ok: false,
        status: 502,
        message: `Gemini returned no answer. Finish reason: ${data?.candidates?.[0]?.finishReason || "not provided"}.`
      };
    }

    return { ok: true, answer };
  } catch (error) {
    if (error?.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        message: `${model} timed out after ${PER_MODEL_TIMEOUT_MS} ms.`
      };
    }

    return {
      ok: false,
      status: 502,
      message: error?.message || "Network request to Gemini failed."
    };
  } finally {
    clearTimeout(timer);
  }
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

  const contents = normalizeHistory(req.body?.history);
  const lastMessage = contents[contents.length - 1];

  // The frontend sends the earlier conversation as history and the latest
  // message separately as "question".
  if (lastMessage && lastMessage.role === "user") {
    lastMessage.parts[0].text += "\n\nCurrent message: " + question;
  } else {
    contents.push({ role: "user", parts: [{ text: question }] });
  }

  const systemInstruction = {
    parts: [{
      text:
        "You are Awaji AI Assistant, a helpful, friendly, patient English teacher and general assistant inside Awaji English Academy. Answer general questions clearly and naturally. When the user is practising English, gently correct grammar, spelling, word choice, and sentence structure; show the corrected sentence, explain the main mistake in simple English, and provide Hausa explanation when helpful or requested. Help learners with grammar, vocabulary, tenses, pronunciation tips, writing, role-play, and quizzes. For quizzes, ask one question at a time and wait for the learner answer before revealing the next answer unless the user explicitly asks for all answers. Adapt explanations to beginner level unless the user requests advanced detail. If the user writes in Hausa, respond in Hausa. Keep answers useful and appropriately concise. Do not claim to have performed actions you cannot perform. If a question is ambiguous, ask a brief follow-up question."
    }]
  };

  const requestBody = {
    systemInstruction,
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800
    }
  };

  // Try the primary model first, then fall back for temporary availability,
  // rate-limit, timeout, or server errors. Total worst-case time is about 20s.
  const primary = await callGemini(PRIMARY_MODEL, apiKey, requestBody);
  if (primary.ok) {
    return sendJson(res, 200, { answer: primary.answer, model: PRIMARY_MODEL });
  }

  console.error(
    `Gemini primary model ${PRIMARY_MODEL} failed:`,
    primary.status,
    primary.message
  );

  const shouldFallback =
    primary.status === 429 ||
    primary.status === 503 ||
    primary.status === 504 ||
    primary.status >= 500;

  if (shouldFallback) {
    const fallback = await callGemini(FALLBACK_MODEL, apiKey, requestBody);
    if (fallback.ok) {
      console.log(`AI tutor answered using fallback model ${FALLBACK_MODEL}.`);
      return sendJson(res, 200, { answer: fallback.answer, model: FALLBACK_MODEL });
    }

    console.error(
      `Gemini fallback model ${FALLBACK_MODEL} failed:`,
      fallback.status,
      fallback.message
    );

    return sendJson(res, 503, {
      error:
        "The AI service is temporarily busy. Please wait a moment and try again. " +
        "If this keeps happening, the available models may be temporarily overloaded."
    });
  }

  if (primary.status === 400 || primary.status === 401 || primary.status === 403 || primary.status === 404) {
    return sendJson(res, 502, {
      error:
        "The AI service rejected the request. Please check the model and API project configuration."
    });
  }

  return sendJson(res, 502, {
    error: "I couldn't connect to the AI service. Please try again."
  });
};
