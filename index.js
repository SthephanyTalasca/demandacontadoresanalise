// Importa as bibliotecas necessárias.
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

// Cria a aplicação do servidor.
const app = express();
const PORT = process.env.PORT || 3000;

// Habilita o CORS para permitir que o seu site se conecte a este servidor.
app.use(cors());

// --- COORDENADAS E CHAVES SECRETAS (Lidas da Vercel) ---
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- FUNÇÃO PARA BUSCAR MENSAGENS DO SLACK ---
async function fetchSlackMessages() {
    console.log('A tentar buscar mensagens do Slack...');
    if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
        throw new Error('As variáveis de ambiente SLACK_BOT_TOKEN ou SLACK_CHANNEL_ID não estão definidas.');
    }
    // Limite de 20 mensagens para uma resposta mais rápida e evitar timeouts.
    const url = `https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=20`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` }
        });
        const data = await response.json();
        if (!data.ok) {
            throw new Error(`Erro da API do Slack: ${data.error}`);
        }
        console.log(`Encontradas ${data.messages.length} mensagens.`);
        return data.messages.filter(msg => msg.type === 'message' && msg.user);
    } catch (error) {
        console.error('Falha em fetchSlackMessages:', error);
        throw error;
    }
}

// --- FUNÇÃO PARA ANALISAR UMA MENSAGEM COM O GEMINI ---
async function analyzeMessageWithGemini(messageText) {
    if (!GEMINI_API_KEY) {
        // Não lança um erro, apenas retorna uma análise padrão para não parar a aplicação.
        console.error('A variável de ambiente GEMINI_API_KEY não está definida.');
        return { category: 'Não Analisado', topic: 'Chave Gemini em falta' };
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
    const prompt = `Analise a seguinte mensagem de um canal de suporte e retorne um objeto JSON com "category" e "topic". Categorias possíveis: "Problema na Ferramenta", "Dificuldade do Atendente", "Dúvida de Uso", "Sugestão de Melhoria", "Outro". Mensagem: "${messageText}"`;
    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            throw new Error(`Erro na API do Gemini: ${response.statusText}`);
        }
        const data = await response.json();
        const analysisText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!analysisText) {
             console.error("Resposta inesperada da API do Gemini:", data);
             return { category: 'Outro', topic: 'Erro na Análise' };
        }
        return JSON.parse(analysisText);
    } catch (error) {
        console.error('Falha em analyzeMessageWithGemini:', error);
        return { category: 'Outro', topic: 'Erro na Análise' };
    }
}

// --- ENDPOINTS DA API ---
app.get('/', (req, res) => {
    res.send('Servidor do Panorama de Atendimento está a funcionar!');
});

app.get('/api/messages', async (req, res) => {
    try {
        console.log("A receber pedido para /api/messages");
        const slackMessages = await fetchSlackMessages();
        
        const analyzedMessagesPromises = slackMessages.map(msg => 
            analyzeMessageWithGemini(msg.text).then(analysis => ({
                id: msg.ts,
                author: msg.user,
                text: msg.text,
                timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
                ...analysis
            }))
        );

        const analyzedMessages = await Promise.all(analyzedMessagesPromises);
        console.log("Análise concluída com sucesso. A enviar dados.");
        res.json(analyzedMessages);
    } catch (error) {
        console.error("Erro final no endpoint /api/messages:", error.message);
        res.status(500).json({ error: 'Falha ao processar o pedido.', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor a correr em http://localhost:${PORT}`);
});

