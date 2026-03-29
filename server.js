const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// API Keys from environment
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || '';
const DIALOGUE_MODEL = process.env.DIALOGUE_MODEL || 'minimax'; // 'minimax' or 'openai'

// MiniMax config
const MINIMAX_BASE_URL = 'https://api.minimax.io';
const MINIMAX_MODEL = 'MiniMax-M2.7';

// OpenAI config
const OPENAI_BASE_URL = 'https://api.openai.com';
const OPENAI_MODEL = 'gpt-4o-mini';

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Voice Chat Backend',
    dialogueModel: DIALOGUE_MODEL,
    hasOpenAI: !!OPENAI_KEY,
    hasMinimax: !!MINIMAX_KEY
  });
});

// Main voice chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { audio, format = 'mp3', provider = 'openai' } = req.body;
    
    if (!audio) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    // Step 1: Transcribe audio to text (Whisper)
    console.log('Step 1: Transcribing...');
    const transcription = await transcribe(audio, provider);
    console.log('Transcription:', transcription);
    
    if (!transcription || transcription.trim() === '') {
      return res.status(400).json({ error: 'Could not transcribe audio' });
    }

    // Step 2: Get AI response
    console.log('Step 2: Getting AI response...');
    const aiResponse = await getAIResponse(transcription);
    console.log('AI Response:', aiResponse);
    
    if (!aiResponse || aiResponse.trim() === '') {
      return res.status(500).json({ error: 'No response from AI' });
    }

    // Step 3: Convert AI response to speech
    console.log('Step 3: Converting to speech...');
    const audioOutput = await textToSpeech(aiResponse, provider);
    console.log('Audio generated, length:', audioOutput.length);
    
    res.json({
      transcription,
      response: aiResponse,
      audio: audioOutput,
      format
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Transcription endpoint (for testing with text)
app.post('/transcribe', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    const aiResponse = await getAIResponse(text);
    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Text chat endpoint (no audio)
app.post('/text-chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'No message provided' });
    }
    
    const aiResponse = await getAIResponse(message);
    res.json({ response: aiResponse });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Text to speech endpoint
app.post('/tts', async (req, res) => {
  try {
    const { text, provider = 'openai', voice } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const audio = await textToSpeech(text, provider, voice);
    res.json({ audio, format: 'mp3' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ Helper Functions ============

async function transcribe(audioBase64, provider) {
  // For now, we'll use a simple approach
  // In production, you'd use Whisper API
  
  // If it's already text (user sent text instead of audio)
  if (typeof audioBase64 === 'string' && !audioBase64.includes('=') && audioBase64.length < 1000) {
    return audioBase64;
  }
  
  // Use OpenAI Whisper for transcription
  const key = OPENAI_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured');
  }
  
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary7MA4YWxkTrZu0gW';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`;
    const end = `\r\n--${boundary}--\r\n`;
    
    const postData = Buffer.concat([
      Buffer.from(body),
      audioBuffer,
      Buffer.from(end)
    ]);
    
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${key}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.text);
          }
        } catch (e) {
          reject(new Error('Failed to parse transcription response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAIResponse(text) {
  if (DIALOGUE_MODEL === 'openai' && OPENAI_KEY) {
    return getOpenAIResponse(text);
  } else {
    return getMinimaxResponse(text);
  }
}

async function getOpenAIResponse(text) {
  const key = OPENAI_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured');
  }
  
  const postData = JSON.stringify({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: '你是一個友善的語音助理，請用簡潔的對話方式回覆。' },
      { role: 'user', content: text }
    ],
    max_tokens: 500
  });
  
  const options = {
    hostname: 'api.openai.com',
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.choices[0].message.content);
          }
        } catch (e) {
          reject(new Error('Failed to parse AI response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getMinimaxResponse(text) {
  const key = MINIMAX_KEY;
  if (!key) {
    throw new Error('MiniMax API key not configured');
  }
  
  const postData = JSON.stringify({
    model: MINIMAX_MODEL,
    messages: [
      { role: 'user', content: text }
    ],
    max_tokens: 500
  });
  
  const options = {
    hostname: 'api.minimax.io',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(postData),
      'anthropic-version': '2023-06-01'
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.content[0].text);
          }
        } catch (e) {
          reject(new Error('Failed to parse AI response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function textToSpeech(text, provider = 'openai', voice) {
  if (provider === 'minimax') {
    return minimaxTTS(text, voice);
  } else {
    return openaiTTS(text, voice);
  }
}

async function openaiTTS(text, voice = 'alloy') {
  const key = OPENAI_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured');
  }
  
  const postData = JSON.stringify({
    model: 'gpt-4o-mini-tts',
    voice: voice || 'alloy',
    input: text,
    response_format: 'mp3'
  });
  
  const options = {
    hostname: 'api.openai.com',
    path: '/v1/audio/speech',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('base64'));
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function minimaxTTS(text, voice = 'Friendly_Person') {
  const key = MINIMAX_KEY;
  if (!key) {
    throw new Error('MiniMax API key not configured');
  }
  
  const postData = JSON.stringify({
    model: 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voice
    },
    audio_setting: {
      sample_rate: 32000,
      format: 'mp3'
    }
  });
  
  const options = {
    hostname: 'api.minimax.io',
    path: '/v1/t2a_v2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.base_resp?.status_code !== 0) {
            reject(new Error(parsed.base_resp?.status_msg || 'MiniMax TTS error'));
          } else {
            // MiniMax returns hex-encoded audio
            const audioBuffer = Buffer.from(parsed.data.audio, 'hex');
            resolve(audioBuffer.toString('base64'));
          }
        } catch (e) {
          reject(new Error('Failed to parse MiniMax response'));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Voice Chat Backend running on port ${PORT}`);
  console.log(`Dialogue model: ${DIALOGUE_MODEL}`);
  console.log(`OpenAI: ${OPENAI_KEY ? 'configured' : 'NOT configured'}`);
  console.log(`MiniMax: ${MINIMAX_KEY ? 'configured' : 'NOT configured'}`);
});
