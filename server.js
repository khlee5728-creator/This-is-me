import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// JSON parse error handler in JSON middleware
app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON', details: String(err) });
    }
    if (err instanceof SyntaxError) {
        return res.status(400).json({ error: 'Invalid JSON', details: String(err) });
    }
    next(err);
});

const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash-preview-05-20';
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-preview-05-20';
const HARDCODED_GEMINI_KEY = 'AIzaSyCXPK1Uu8SZU1oCvaiu-scuUEqjU-uC-rY';

function getApiKey(req) {
    // Prefer environment, then hardcoded fallback; no client header needed
    return process.env.GEMINI_API_KEY || HARDCODED_GEMINI_KEY;
}

// Safely obtain parsed JSON body regardless of how the client sent it
function getJsonBody(req) {
    try {
        if (req && typeof req.body === 'object' && req.body !== null) {
            return req.body;
        }
        if (req && typeof req.body === 'string' && req.body.trim().length > 0) {
            return JSON.parse(req.body);
        }
        // Some clients may send raw text in req.rawBody
        if (req && typeof req.rawBody === 'string' && req.rawBody.trim().length > 0) {
            return JSON.parse(req.rawBody);
        }
        return {};
    } catch (e) {
        return { __parse_error: String(e) };
    }
}

app.post('/api/gemini/text', async (req, res) => {
    try {
        const apiKey = getApiKey(req);

        const bodyIn = getJsonBody(req);
        if (bodyIn.__parse_error) return res.status(400).json({ error: 'Invalid JSON', details: bodyIn.__parse_error });
        const { systemPrompt = '', userQuery = '', responseMimeType = 'text/plain', model = DEFAULT_TEXT_MODEL } = bodyIn || {};

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
        const body = {
            contents: [
                { role: 'user', parts: [{ text: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userQuery}` }] }
            ],
            generationConfig: { response_mime_type: responseMimeType }
        };

        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) });
        const raw = await r.text();
        let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
        if (!r.ok) return res.status(r.status).json(data || { error: raw || 'Upstream error' });

        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        res.json({ text });
    } catch (err) {
        res.status(500).json({ error: String(err) });
    }
});

app.post('/api/gemini/image', async (req, res) => {
    try {
        const apiKey = getApiKey(req);

        const bodyIn = getJsonBody(req);
        if (bodyIn.__parse_error) return res.status(400).json({ error: 'Invalid JSON', details: bodyIn.__parse_error });
        const { prompt = '', aspectRatio = '1:1', referenceImageBase64 = '', mimeType = 'image/png', model = DEFAULT_IMAGE_MODEL } = bodyIn || {};

        const pureRef = referenceImageBase64 ? referenceImageBase64.replace(/^data:[^,]*?,/, '') : '';

        // Payload variants for different Imagen deployments
        const payloads = [];
        // generateImages style
        const pGenerateImages = {
            prompt: { text: prompt },
            imageGenerationConfig: { numberOfImages: 1, aspectRatio }
        };
        if (pureRef) {
            pGenerateImages.referenceImages = [{ mimeType, bytesBase64: pureRef }];
        }
        payloads.push(pGenerateImages);

        // predict style A (instances + parameters) with prompt object
        const pPredictA = {
            instances: [{ prompt: { text: prompt }, ...(pureRef ? { referenceImages: [{ mimeType, bytesBase64: pureRef }] } : {}) }],
            parameters: { sampleCount: 1, aspectRatio }
        };
        payloads.push(pPredictA);

        // predict style B (instances + parameters) with text field
        const pPredictB = {
            instances: [{ text: prompt, ...(pureRef ? { referenceImages: [{ mimeType, bytesBase64: pureRef }] } : {}) }],
            parameters: { sampleCount: 1, aspectRatio }
        };
        payloads.push(pPredictB);

        const urls = [
            // Gemini 2.5 multimodal image generation via content API
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`
        ];

        let lastErr = null;
        for (const u of urls) {
            for (const p of payloads) {
                try {
                    const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
                    // Map payload into generateContent schema
                    const parts = [];
                    if (prompt) parts.push({ text: prompt });
                    if (pureRef) parts.push({ inline_data: { mime_type: mimeType, data: pureRef } });
                    const body = { contents: [{ role: 'user', parts }], generationConfig: {} };
                    const r = await fetch(u, { method: 'POST', headers, body: JSON.stringify(body) });
                    const raw = await r.text();
                    let data; try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
                    if (!r.ok) throw new Error(JSON.stringify({ status: r.status, url: u, body: data || raw || null }));
                    const b64 = data?.candidates?.[0]?.content?.parts?.find(p2 => p2.inline_data)?.inline_data?.data;
                    if (!b64) throw new Error('No image returned');
                    return res.json({ dataUrl: `data:image/png;base64,${b64}` });
                } catch (e) {
                    lastErr = e;
                }
            }
        }
        throw lastErr || new Error('Image generation failed');
    } catch (err) {
        console.error('[proxy:image] error', err);
        res.status(500).json({ error: String(err) });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[proxy] Gemini proxy running on http://127.0.0.1:${PORT}`);
});


