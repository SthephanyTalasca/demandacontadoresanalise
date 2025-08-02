// Importa as bibliotecas necessárias. 'cors' é a novidade para a correção.
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors'); // 1. Importar o pacote 'cors'

// Cria a aplicação do servidor.
const app = express();
const PORT = process.env.PORT || 3000; // O servidor irá correr na porta 3000 por defeito.

// 2. Usar o 'cors' para permitir pedidos de qualquer origem
// Isto diz ao servidor para aceitar o pedido do seu dashboard
app.use(cors());

// --- COORDENADAS E CHAVES SECRETAS ---
// Estes valores são lidos das "Variáveis de Ambiente" que configurou na Vercel.
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- FUNÇÃO PARA BUSCAR MENSAGENS DO SLACK ---
async function fetchSlackMessages() {
    const url = `https://slack.com/api/conversations.history?channel=${SLACK_CHANNEL_ID}&limit=50`; // Limite de 50 mensagens por exemplo
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Erro ao buscar mensagens do Slack: ${response.statusText} - ${errorBody}`);
        }
        const data = await response.json();
        if (!data.ok) {
            throw new Error(`Erro da API do Slack: ${data.error}`);
        }
        // Filtra apenas as mensagens de utilizadores reais, ignorando bots ou join/leave.
        return data.messages.filter(msg => msg.type === 'message' && msg.user);
    } catch (error) {
        console.error(error);
        return []; // Retorna uma lista vazia em caso de erro.
    }
}

// --- FUNÇÃO PARA ANALISAR UMA MENSAGEM COM O GEMINI ---
async function analyzeMessageWithGemini(messageText) {
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
        const analysisText = data.candidates[0].content.parts[0].text;
        return JSON.parse(analysisText);
    } catch (error) {
        console.error(error);
        return { category: 'Outro', topic: 'Erro na Análise' }; // Retorno padrão em caso de erro.
    }
}

// --- O "ENDPOINT" DA API ---
// O seu dashboard irá chamar este endereço (ex: https://seuservidor.com/api/messages)
app.get('/api/messages', async (req, res) => {
    console.log("A receber pedido para buscar e analisar mensagens...");
    
    // 1. Busca as mensagens do Slack
    const slackMessages = await fetchSlackMessages();
    
    // 2. Analisa cada mensagem com o Gemini
    const analyzedMessagesPromises = slackMessages.map(async (msg) => {
        const analysis = await analyzeMessageWithGemini(msg.text);
        return {
            id: msg.ts, // usa o timestamp como ID único
            author: msg.user, // Em produção, pode querer buscar o nome do utilizador
            text: msg.text,
            timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
            category: analysis.category,
            topic: analysis.topic
        };
    });

    const analyzedMessages = await Promise.all(analyzedMessagesPromises);
    
    console.log("Análise concluída. A enviar dados para o dashboard.");
    res.json(analyzedMessages); // 3. Envia os dados processados para o dashboard
});

// Inicia o servidor para que ele possa receber pedidos.
app.listen(PORT, () => {
    console.log(`Servidor a correr em http://localhost:${PORT}`);
});
