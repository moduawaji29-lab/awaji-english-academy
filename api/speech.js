export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return res.status(500).json({
      error: "ElevenLabs API key or voice ID is missing in Vercel."
    });
  }

  const text = typeof req.body?.text === "string"
    ? req.body.text.trim()
    : "";

  if (!text || text.length > 2500) {
    return res.status(400).json({
      error: "Enter text between 1 and 2500 characters."
    });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
  text,
  model_id: "eleven_multilingual_v2",
  output_format: "mp3_44100_128",
  voice_settings: {
    speed: 0.8,
    stability: 0.5,
    similarity_boost: 0.75
  }
})

    if (!response.ok) {
      console.error("ElevenLabs error:", response.status);
      return res.status(502).json({
        error: "Audio generation failed. Check your voice access and account credits."
      });
    }

    const audio = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");

    return res.status(200).send(audio);
  } catch (error) {
    console.error("Audio error:", error);

    return res.status(500).json({
      error: "Unable to generate audio."
    });
  }
}
