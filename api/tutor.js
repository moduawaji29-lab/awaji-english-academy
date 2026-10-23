export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed."
    });
  }

  const question = String(req.body?.question || "").trim();

  if (!question) {
    return res.status(400).json({
      error: "Please enter a question."
    });
  }

  if (question.length > 2000) {
    return res.status(400).json({
      error: "Please keep your question under 2,000 characters."
    });
  }

  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return res.status(503).json({
      error: "The AI Tutor needs GEMINI_API_KEY in the Vercel project environment."
    });
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        encodeURIComponent(key),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are Awaji English Academy's friendly English tutor for learners in Nigeria. Answer clearly and accurately using simple English, short examples, and Hausa translations when useful or requested. Correct mistakes gently and explain why. For pronunciation, provide a readable pronunciation guide. Stay focused on English learning and general educational questions."
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: question
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 700
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Gemini tutor error:",
        response.status,
        JSON.stringify(data).slice(0, 500)
      );

      return res.status(502).json({
        error: "The AI service could not answer. Please check the Gemini API configuration and quota."
      });
    }

    const answer = (
      data.candidates?.[0]?.content?.parts || []
    )
      .map(part => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      return res.status(502).json({
        error: "The AI returned an empty answer. Please try again."
      });
    }

    return res.status(200).json({
      answer
    });

  } catch (error) {
    console.error("Tutor request failed:", error);

    return res.status(500).json({
      error: "Unable to reach the AI service. Please try again."
    });
  }
}
