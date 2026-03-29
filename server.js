const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Readable } = require('stream');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws/voice' });

// API Keys from environment
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const MINIMAX_KEY = process.env.MINIMAX_API_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCpGwSZWat3pXPaoUHOOcyMT2yOZJZoE5E';
const DIALOGUE_MODEL = process.env.DIALOGUE_MODEL || 'gemini';

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
    service: 'Voice Chat Backend v1.1.0',
    dialogueModel: DIALOGUE_MODEL,
    wsEndpoint: '/ws/voice'
  });
});

// REST endpoints (keep existing)
app.post('/chat', async (req, res) => {
  try {
    const { audio, format = 'mp3', provider = 'openai' } = req.body;
    
    if (!audio) {
      return res.status(400).json({ error: 'No audio provided' });
    }

    console.log('REST /chat: Transcribing...');
    const transcription = await transcribe(audio, provider);
    console.log('REST /chat: Transcription:', transcription);
    
    if (!transcription || transcription.trim() === '') {
      return res.status(400).json({ error: 'Could not transcribe audio' });
    }

    console.log('REST /chat: Getting AI response...');
    const aiResponse = await getAIResponse(transcription);
    console.log('REST /chat: AI Response:', aiResponse);
    
    if (!aiResponse || aiResponse.trim() === '') {
      return res.status(500).json({ error: 'No response from AI' });
    }

    console.log('REST /chat: Converting to speech...');
    const audioOutput = await textToSpeech(aiResponse, provider);
    console.log('REST /chat: Audio generated');
    
    res.json({
      transcription,
      response: aiResponse,
      audio: audioOutput,
      format
    });
    
  } catch (error) {
    console.error('REST /chat Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/text-chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'No message provided' });
    }
    
    const aiResponse = await getAIResponse(message);
    res.json({ response: aiResponse });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/tts', async (req, res) => {
  try {
    const { text, provider = 'openai', voice } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }
    
    const audio = await textToSpeech(text, provider, voice);
    res.json({ audio, format: 'mp3' });
  } catch (error) {
    console.error('TTS Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket handling for continuous voice chat
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  let conversationHistory = [];
  let isProcessing = false; // Prevent concurrent calls
  
  ws.on('message', async (message) => {
    // Skip if still processing previous message
    if (isProcessing) {
      console.log('Skipping message - still processing previous');
      return;
    }
    
    try {
      isProcessing = true;
      const msg = JSON.parse(message);
      
      if (msg.type === 'audio') {
        const audioBase64 = msg.data;
        
        // Transcribe
        const transcription = await transcribe(audioBase64, 'openai');
        console.log('WS Transcription:', transcription);
        
        if (!transcription || transcription.trim() === '') {
          ws.send(JSON.stringify({ type: 'transcription', text: '' }));
          isProcessing = false;
          return;
        }
        
        ws.send(JSON.stringify({ type: 'transcription', text: transcription }));
        
        // Add to history and get AI response
        conversationHistory.push({ role: 'user', content: transcription });
        
        console.log('WS Getting AI response with history length:', conversationHistory.length);
        const aiResponse = await getAIResponseWithHistory(conversationHistory);
        console.log('WS AI Response:', aiResponse);
        
        if (!aiResponse || aiResponse.trim() === '') {
          console.error('Empty AI response');
          isProcessing = false;
          return;
        }
        
        conversationHistory.push({ role: 'assistant', content: aiResponse });
        
        ws.send(JSON.stringify({ type: 'response', response: aiResponse }));
        
        // Generate TTS
        console.log('WS Generating TTS...');
        const audioOutput = await textToSpeech(aiResponse, 'minimax', 'Friendly_Person');
        ws.send(JSON.stringify({ type: 'audio', data: audioOutput }));
        console.log('WS TTS sent');
        
      } else if (msg.type === 'reset') {
        conversationHistory = [];
        ws.send(JSON.stringify({ type: 'reset', status: 'ok' }));
      }
      
    } catch (error) {
      console.error('WebSocket message error:', error.message);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    } finally {
      isProcessing = false;
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

// ============ Helper Functions ============

async function transcribe(audioBase64, provider) {
  // If it's already text (user sent text instead of audio)
  if (typeof audioBase64 === 'string' && !audioBase64.includes('=') && audioBase64.length < 1000) {
    return audioBase64;
  }
  
  const key = OPENAI_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured');
  }
  
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary7MA4YWxkTrZu0gW';
    const CRLF = '\r\n';
    const parts = [
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}whisper-1`),
      Buffer.from(`${CRLF}--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="audio.webm"${CRLF}Content-Type: audio/webm${CRLF}${CRLF}`),
      audioBuffer,
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
    ];
    const postData = Buffer.concat(parts);
    
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${key}`,
        'Content-Length': postData.length
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
  return getAIResponseWithHistory([
    { role: 'user', content: text }
  ]);
}

async function getAIResponseWithHistory(messages) {
  console.log('getAIResponseWithHistory called, DIALOGUE_MODEL:', DIALOGUE_MODEL, 'GEMINI_KEY exists:', !!GEMINI_KEY);
  
  if (DIALOGUE_MODEL === 'gemini' && GEMINI_KEY) {
    console.log('Using Gemini');
    return getGeminiResponseWithHistory(messages);
  } else if (MINIMAX_KEY) {
    console.log('Using MiniMax');
    return getMinimaxResponseWithHistory(messages);
  } else if (DIALOGUE_MODEL === 'openai' && OPENAI_KEY) {
    console.log('Using OpenAI');
    return getOpenAIResponseWithHistory(messages);
  } else {
    console.log('No valid API key, using Gemini as fallback');
    return getGeminiResponseWithHistory(messages);
  }
}

async function getOpenAIResponseWithHistory(messages) {
  const key = OPENAI_KEY;
  if (!key) {
    throw new Error('OpenAI API key not configured');
  }
  
  const systemMessage = { role: 'system', content: '你是一個友善的語音助理，請用繁體中文簡潔地回覆。' };
  const allMessages = [systemMessage, ...messages];
  
  const postData = JSON.stringify({
    model: OPENAI_MODEL,
    messages: allMessages,
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

async function getGeminiResponseWithHistory(messages) {
  const key = GEMINI_KEY;
  if (!key) {
    throw new Error('Gemini API key not configured');
  }
  
  // Convert messages to Gemini format
  const contents = messages.map(m => ({
    parts: [{ text: m.content }]
  }));
  
  console.log('Gemini request - messages count:', messages.length);
  console.log('Gemini request - first message:', messages[0]);
  
  const postData = JSON.stringify({
    contents,
    generationConfig: {
      maxOutputTokens: 500,
      temperature: 0.9
    }
  });
  
  const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Gemini response status:', res.statusCode);
        try {
          const parsed = JSON.parse(data);
          console.log('Gemini parsed response:', JSON.stringify(parsed).substring(0, 200));
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else if (parsed.candidates && parsed.candidates[0]?.content?.parts[0]?.text) {
            resolve(parsed.candidates[0].content.parts[0].text);
          } else {
            reject(new Error('Invalid Gemini response format: ' + JSON.stringify(parsed).substring(0, 100)));
          }
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getMinimaxResponseWithHistory(messages) {
  const key = MINIMAX_KEY;
  if (!key) {
    throw new Error('MiniMax API key not configured');
  }
  
  const postData = JSON.stringify({
    model: MINIMAX_MODEL,
    messages,
    max_tokens: 500
  });
  
  const options = {
    hostname: 'api.minimax.io',
    path: '/anthropic/v1/messages',
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
            const textBlock = parsed.content.find(c => c.type === 'text');
            if (textBlock) {
              resolve(textBlock.text);
            } else {
              reject(new Error('No text in AI response'));
            }
          }
        } catch (e) {
          reject(new Error('Failed to parse AI response: ' + e.message));
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Voice Chat Backend v1.1.0 running on port ${PORT}`);
  console.log(`REST endpoints: /chat, /text-chat, /tts`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws/voice`);
  console.log(`Dialogue model: ${DIALOGUE_MODEL}`);
});
