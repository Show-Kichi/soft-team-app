require('dotenv').config();

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3000;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(express.json());
app.use(express.static('public'));

app.post('/api/claude', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'promptがありません' });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const text = message.content
      .map((block) => block.type === 'text' ? block.text : '')
      .join('');

    res.json({ text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Claude APIでエラーが発生しました' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running: http://localhost:${PORT}`);
});