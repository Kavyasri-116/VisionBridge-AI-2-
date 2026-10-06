import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getAI() {
  const key = process.env.GEMINI_API_KEY?.trim();

  if (!key) {
    throw new Error(
      'Gemini API key is missing. Create .env and set GEMINI_API_KEY.'
    );
  }

  return new GoogleGenAI({ apiKey: key });
}

const SYSTEM = `You are VisionBridge AI, a helpful visual assistant. Analyze uploaded images accurately. Answer the user's exact question first, then add useful context only when needed. For timetables, read the day and class periods carefully and never invent entries. If text is unclear, say what is unclear. Use simple, clear formatting.`;


// Retry Gemini when the service temporarily returns 503
async function generateWithRetry(ai, request, maxRetries = 4) {
  let delay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent(request);
    } catch (error) {
      const msg = String(error?.message || error);

      const isTemporary =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('HeadersTimeoutError') ||
        msg.includes('UND_ERR_HEADERS_TIMEOUT');

      if (!isTemporary || attempt === maxRetries) {
        throw error;
      }

      console.log(
        `Gemini temporarily unavailable. Retrying in ${delay / 1000}s... (attempt ${attempt}/${maxRetries})`
      );

      await new Promise(resolve => setTimeout(resolve, delay));

      delay *= 2;
    }
  }
}


app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    apiKeyConfigured: Boolean(
      process.env.GEMINI_API_KEY?.trim()
    )
  });
});


app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const ai = getAI();

    const message = (req.body.message || '').trim();

    if (!message) {
      return res.status(400).json({
        error: 'Please enter a question.'
      });
    }

    const parts = [
      {
        text: SYSTEM + '\n\nUser question: ' + message
      }
    ];

    if (req.file) {
      parts.push({
        inlineData: {
          mimeType: req.file.mimetype,
          data: req.file.buffer.toString('base64')
        }
      });
    }

    const response = await generateWithRetry(ai, {
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts
        }
      ]
    });

    res.json({
      reply: response.text || 'I could not generate a response.'
    });

  } catch (error) {
    console.error('Gemini error:', error);

    const msg = String(error?.message || error);

    if (msg.includes('API key')) {
      return res.status(500).json({
        error: 'Gemini API key is missing or invalid. Check your .env file.'
      });
    }

    res.status(500).json({
      error: 'Gemini request failed. Check the terminal for details.',
      details: msg
    });
  }
});


app.listen(PORT, () => {
  console.log(
    `VisionBridge AI running at http://localhost:${PORT}`
  );

  console.log(
    `Gemini API key configured: ${Boolean(
      process.env.GEMINI_API_KEY?.trim()
    )}`
  );
});