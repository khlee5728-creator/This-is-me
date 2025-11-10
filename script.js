function bindRefreshButtons() {
    const buttons = document.querySelectorAll('button[id^="refresh-"]');
    buttons.forEach(btn => {
        if (btn._bound) return;
        const key = btn.getAttribute('data-category-key');
        const name = btn.getAttribute('data-category-name');
        if (!key || !name) return;
        btn.addEventListener('click', () => fetchOptions(key, name));
        btn._bound = true;
    });
}
const TEXT_MODEL = "gpt-3.5-turbo";
const IMAGE_MODEL = "gpt-image-1";
// Provider toggle: 'openai' | 'gemini'
const PROVIDER = 'openai';
const GEMINI_TEXT_MODEL = 'gemini-2.5-flash-preview-05-20';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-preview-05-20';
const BACKEND_URL = 'https://playground.ils.ai.kr/api';

const appContainer = document.getElementById('app-container');
const stageWrapper = document.getElementById('stage-wrapper');
const loadingOverlay = document.getElementById('loading-overlay');

// Fixed-canvas scaling logic
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 800;

function applyStageScale() {
    if (!stageWrapper) return;
    const scale = Math.min(window.innerWidth / BASE_WIDTH, window.innerHeight / BASE_HEIGHT);
    stageWrapper.style.transform = `translateX(-50%) scale(${scale})`;
}

window.addEventListener('resize', () => {
    applyStageScale();
    // 필요 시 스크롤 처리: 기본은 숨김, 스케일로 커버되지 못하는 경우만 보임
    const needScrollX = BASE_WIDTH * (parseFloat(getComputedStyle(stageWrapper).transform.split(',')[0]?.replace('matrix(', '') || '1')) > window.innerWidth;
    const needScrollY = BASE_HEIGHT * (parseFloat(getComputedStyle(stageWrapper).transform.split(',')[0]?.replace('matrix(', '') || '1')) > window.innerHeight;
    document.body.style.overflowX = needScrollX ? 'auto' : 'hidden';
    document.body.style.overflowY = needScrollY ? 'auto' : 'hidden';
});

let photoSource = null;

let appData = {
    openAIApiKey: '',
    geminiApiKey: '',
    name: '', age: '', town: '',
    color: { value: '', options: [] },
    food: { value: '', options: [] },
    animal: { value: '', options: [] },
    hobby: { value: '', options: [] },
    skill: { value: '', options: [] },
    dream: { value: '', options: [] },
    style: '',
    photoBase64: null,
    generatedImageUrl: null,
    generatedText: ''
};

const allOptionalFieldsMeta = [
    { key: 'color', label: 'Color', sentence: 'My favorite color is ___.', categoryName: 'a common, simple color adjective (like "red", "blue", "yellow", "purple", "orange", "gray")' },
    { key: 'food', label: 'Food', sentence: 'My favorite food is ___.', categoryName: 'a simple food noun or phrase, like "pizza" or "fried chicken"' },
    { key: 'animal', label: 'Animal', sentence: 'My favorite animal is ___.', categoryName: 'a simple animal noun, preceded by an appropriate article (a/an/no article), like "a cat", "an elephant", or "lions"' },
    { key: 'hobby', label: 'Hobby', sentence: 'My hobby is ___.', categoryName: 'a gerund phrase (ending in -ing) that describes an activity, like "reading books" or "playing soccer"' },
    { key: 'skill', label: 'Skill', sentence: 'I can ___.', categoryName: 'a simple base verb or verb phrase describing a unique or above-average ability/talent (e.g., "sing very loudly", "build tall towers", "catch things easily")' },
    { key: 'dream', label: 'Dream', sentence: 'I want to be ___ .', categoryName: 'a profession or job title (like "a dentist" or "a teacher"), which should be singular and preceded by "a" or "an"' },
];

const showLoading = (show) => {
    loadingOverlay.style.display = show ? 'flex' : 'none';
};

const fetchWithRetry = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`HTTP error! Status: ${response.status}`, errorBody);
                throw new Error(`API Error: ${response.status}. Details: ${errorBody.substring(0, 100)}...`);
            }
            return response;
        } catch (error) {
            if (i === retries - 1) {
                console.error("API call failed after all retries:", error);
                throw error;
            }
            const delay = Math.pow(2, i) * 1000;
            console.warn(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const pickRandomCategories = () => {
    const shuffled = allOptionalFieldsMeta.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
};

let currentOptionalFields = [];

// Keep track of recent option pools to reduce repetition across refreshes
const recentOptionsByCategory = {};

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function normalizeOptions(categoryKey, options) {
    return options
        .map(opt => String(opt).trim())
        .filter(Boolean)
        .map(opt => opt.replace(/^\s*(no\s*article\s*:|article\s*:|label\s*:|use\s*:)/i, '').trim())
        .map(opt => {
            let s = opt;
            // Always lowercase start unless proper noun (not expected)
            s = s.replace(/^\s+|\s+$/g, '');
            // Category specific rules
            if (categoryKey === 'color') {
                // No article for color
                s = s.replace(/^(a|an)\s+/i, '');
            }
            if (categoryKey === 'dream' || categoryKey === 'animal') {
                // Ensure singular with correct article; avoid simple plurals (e.g., bears → a bear)
                if (categoryKey === 'animal') {
                    const word = s.trim();
                    if (/s$/i.test(word) && !/octopus$/i.test(word)) {
                        s = word.replace(/s$/i, '');
                    }
                }
                if (!/^(a|an)\s+/i.test(s)) {
                    const startsWithVowel = /^[aeiou]/i.test(s.trim());
                    s = (startsWithVowel ? 'an ' : 'a ') + s;
                }
            }
            return s;
        })
        .filter((v, i, arr) => arr.indexOf(v) === i); // dedupe
}

const fetchOpenAIText = async (systemPrompt, userQuery, jsonSchema = null) => {
    if (PROVIDER === 'gemini') {
        const res = await fetch('http://127.0.0.1:3001/api/gemini/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt, userQuery, responseMimeType: jsonSchema ? 'application/json' : 'text/plain', model: GEMINI_TEXT_MODEL })
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(txt || 'Proxy text error');
        let data; try { data = JSON.parse(txt); } catch { throw new Error(txt || 'Empty JSON'); }
        return data.text || '';
    }

    const headers = { 'Content-Type': 'application/json' };
    const body = {
        model: TEXT_MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userQuery }
        ],
        temperature: 0.7,
        ...(jsonSchema ? { response_format: { type: 'json_object' } } : {})
    };
    const url = `${BACKEND_URL}/chat/completions`;
    const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await response.text();
    let result; try { result = JSON.parse(txt); } catch { throw new Error(txt || 'Backend text error'); }
    if (result.choices && result.choices.length > 0) {
        return (result.choices[0].message?.content || '').trim();
    }
    return (result.text || '').trim();
};

const fetchOpenAIImage = async (prompt) => {
    if (PROVIDER === 'gemini') {
        const res = await fetch('http://127.0.0.1:3001/api/gemini/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, aspectRatio: '1:1', model: GEMINI_IMAGE_MODEL })
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(txt || 'Proxy image error');
        let json; try { json = JSON.parse(txt); } catch { throw new Error(txt || 'Empty JSON'); }
        return json.dataUrl;
    }

    const headers = { 'Content-Type': 'application/json' };
    const body = { model: IMAGE_MODEL, prompt, size: '1024x1024' };
    const url = `${BACKEND_URL}/images/generations`;
    const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await response.text();
    let result; try { result = JSON.parse(txt); } catch { throw new Error(txt || 'Backend image error'); }
    if (result.dataUrl) return result.dataUrl;
    const b64 = result.data?.[0]?.b64_json || result.image?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
    const urlDirect = result.data?.[0]?.url || result.url;
    if (urlDirect) return urlDirect;
    throw new Error('Image generation failed (no data)');
};

// Convert data URL (base64) to Blob
function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const byteString = atob(parts[1]);
    const mimeString = parts[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
}

// Safe dataURL header stripper
function stripDataUrl(dataUrl) {
    const i = dataUrl.indexOf(',');
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

// Get mime-type from dataURL header
function getDataUrlMime(dataUrl) {
    try {
        const head = dataUrl.substring(0, dataUrl.indexOf(','));
        const m = head.match(/data:(.*?);base64/i);
        return m ? m[1] : 'image/png';
    } catch {
        return 'image/png';
    }
}

// Generate an image using OpenAI images/edits endpoint with the uploaded photo as reference
const fetchOpenAIImageWithPhoto = async (prompt, base64Image, size = '1024x1024') => {
    if (PROVIDER === 'gemini') {
        const res = await fetch('http://127.0.0.1:3001/api/gemini/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, aspectRatio: '1:1', referenceImageBase64: base64Image, mimeType: getDataUrlMime(base64Image), model: GEMINI_IMAGE_MODEL })
        });
        const txt = await res.text();
        if (!res.ok) throw new Error(txt || 'Proxy image error');
        let json; try { json = JSON.parse(txt); } catch { throw new Error(txt || 'Empty JSON'); }
        return json.dataUrl;
    }

    // OpenAI Images Edits via backend: JSON wrapper on /images/generations
    const headers = { 'Content-Type': 'application/json' };
    const body = {
        model: IMAGE_MODEL,
        prompt,
        size,
        imageBase64: base64Image,
        mimeType: getDataUrlMime(base64Image)
    };
    const url = `${BACKEND_URL}/images/generations`;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const txt = await response.text();
    let result; try { result = JSON.parse(txt); } catch { throw new Error(txt || 'Backend image edit error'); }
    if (result.dataUrl) return result.dataUrl;
    const b64 = result.data?.[0]?.b64_json || result.image?.b64_json;
    if (b64) return `data:image/png;base64,${b64}`;
    const urlDirect = result.data?.[0]?.url || result.url;
    if (urlDirect) return urlDirect;
    throw new Error('Image edit failed (no data)');
};

// Local fallback: stylize the uploaded photo on canvas when AI image fails
async function generateLocalStyledImage(base64, style) {
    return new Promise((resolve, reject) => {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const size = 450;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');

                // Base draw
                ctx.drawImage(img, 0, 0, size, size);

                // Effects per style (simple, fast, kid-friendly)
                const s = (style || 'Cartoon');
                if (s === 'Cartoon') {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.filter = 'contrast(1.25) saturate(1.35) brightness(1.05)';
                    ctx.drawImage(canvas, 0, 0);
                    ctx.filter = 'none';
                    // soft white vignette
                    const g = ctx.createRadialGradient(size*0.5, size*0.5, size*0.1, size*0.5, size*0.5, size*0.6);
                    g.addColorStop(0, 'rgba(255,255,255,0.08)');
                    g.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(0,0,size,size);
                } else if (s === 'Fairy Tale') {
                    ctx.filter = 'saturate(1.2) brightness(1.08)';
                    ctx.drawImage(canvas, 0, 0);
                    ctx.filter = 'none';
                    const g = ctx.createLinearGradient(0,0,size,size);
                    g.addColorStop(0, 'rgba(255,192,203,0.25)');
                    g.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(0,0,size,size);
                    // sparkles
                    ctx.fillStyle = 'rgba(255,255,255,0.7)';
                    for (let i=0;i<30;i++){ const x=Math.random()*size, y=Math.random()*size, r=Math.random()*2+0.5; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
                } else if (s === 'Super Hero') {
                    ctx.filter = 'contrast(1.5) saturate(1.4)';
                    ctx.drawImage(canvas, 0, 0);
                    ctx.filter = 'none';
                    // diagonal stripes overlay
                    ctx.globalAlpha = 0.08;
                    ctx.fillStyle = '#1e3a8a';
                    for (let x=-size; x<size*2; x+=30) { ctx.save(); ctx.translate(x,0); ctx.rotate(-Math.PI/6); ctx.fillRect(0,0,12,size*2); ctx.restore(); }
                    ctx.globalAlpha = 1;
                } else if (s === 'LEGO') {
                    // pixelate
                    const block = 8;
                    const off = document.createElement('canvas');
                    off.width = size/block; off.height = size/block;
                    const octx = off.getContext('2d');
                    octx.imageSmoothingEnabled = false;
                    octx.drawImage(canvas, 0, 0, off.width, off.height);
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0,0,size,size);
                    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, size, size);
                    ctx.imageSmoothingEnabled = true;
                } else if (s === 'Fantasy') {
                    ctx.filter = 'saturate(1.25) hue-rotate(20deg)';
                    ctx.drawImage(canvas, 0, 0);
                    ctx.filter = 'none';
                    // colored glow
                    const g = ctx.createRadialGradient(size*0.7, size*0.3, 10, size*0.7, size*0.3, size*0.6);
                    g.addColorStop(0, 'rgba(173,216,230,0.25)');
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(0,0,size,size);
                    // tiny stars
                    ctx.fillStyle = 'rgba(255,255,255,0.8)';
                    for (let i=0;i<25;i++){ const x=Math.random()*size, y=Math.random()*size; ctx.fillRect(x,y,1.5,1.5); }
                }
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('Local image load error'));
            img.src = base64;
        } catch (e) { reject(e); }
    });
}

const renderScreen = (screenName) => {
    appContainer.innerHTML = '';
    switch (screenName) {
        case 'entry':
            renderEntryScreen();
            break;
        case 'step1':
            if (currentOptionalFields.length === 0) {
                currentOptionalFields = pickRandomCategories();
            }
            renderStep1Screen();
            break;
        case 'step2':
            renderStep2Screen();
            break;
        case 'result':
            renderResultScreen();
            break;
    }
    lucide.createIcons();
};

const navigateTo = (screenName) => {
    if (screenName !== 'step2') {
        stopWebcam();
    }
    renderScreen(screenName);
};

const fetchOptions = async (categoryKey, categoryName) => {
    let extraCategoryRules = '';
    if (categoryKey === 'color') {
        extraCategoryRules = `\n- For the sentence "My favorite color is ___.", options MUST be bare color words without any article (e.g., "red", "blue", "white"). NEVER prefix with "a" or "an".`;
    } else if (categoryKey === 'food') {
        extraCategoryRules = `\n- IMPORTANT: Prefer simple dish/meal names over single ingredients. Use CEFR A1 level, kid-friendly food items like: sandwich, fried noodles, kimbap, pasta, pizza, chicken soup, fried rice, curry rice, hot dog.\n- Avoid plain ingredients such as single fruits/vegetables or basic components (e.g., banana, grapes, cheese) unless they are commonly used as standalone foods for kids.\n- Keep each option to 1-3 simple words, no emojis, no quotes.`;
    } else if (categoryKey === 'dream') {
        extraCategoryRules = `\n- For the sentence "I want to be ___ .", options MUST include the correct article: "a doctor", "an artist", etc.`;
    } else if (categoryKey === 'animal') {
        extraCategoryRules = `\n- For the sentence "My favorite animal is ___.", ALWAYS provide a singular animal with the correct article ("a"/"an").\n- DO NOT return plural forms (e.g., "bears", "dogs"). If a plural form would be natural, convert it to singular with an article instead (e.g., "a bear").`;
    }
    const prevOptions = (appData[categoryKey] && Array.isArray(appData[categoryKey].options)) ? appData[categoryKey].options : [];
    const prevList = prevOptions.length ? `Previously shown options: [${prevOptions.join(', ')}].` : '';
    const systemPrompt = `You are an AI assistant for young elementary students.
Provide 5 simple, short phrase options for the category: "${categoryName}".
CRITICAL RULES:
- Each option MUST be grammatically correct when inserted into the fixed sentence pattern for that category.${extraCategoryRules}
- Generate five options that are ALL different from one another AND also different from the previously shown list for this category (avoid repeats for at least the next refresh). If the word pool is too small, you may repeat only when necessary on later refreshes, but prefer new items first.
- Start with lowercase unless proper nouns are required (not expected here).
${prevList}
Respond ONLY with a JSON object: { "options": string[] }.`;
    const userQuery = `Generate 5 options for the category: "${categoryName}".`;

    const jsonSchema = true;
    let success = false;

    try {
        const refreshButton = document.getElementById(`refresh-${categoryKey}`);
        if (refreshButton) {
            if (refreshButton.classList.contains('animate-spin')) return;
            refreshButton.classList.add('animate-spin');
        }

        // Immediately clear current selection and input before fetching new options
        if (appData[categoryKey] && typeof appData[categoryKey] === 'object') {
            appData[categoryKey].value = '';
        }
        const inputEl = document.getElementById(`input-${categoryKey}`);
        if (inputEl) {
            inputEl.value = '';
            inputEl.classList.add('placeholder-text');
        }
        const box = document.getElementById(`category-box-${categoryKey}`);
        if (box) {
            const optionButtons = box.querySelectorAll('button');
            optionButtons.forEach(btn => {
                if (!btn.id || !btn.id.startsWith('refresh-')) {
                    btn.classList.remove('bg-blue-500','text-white','ring-2','ring-blue-700');
                    btn.classList.add('bg-gray-100','text-gray-700');
                }
            });
        }
        checkNextButtonState();

        const jsonText = await fetchOpenAIText(systemPrompt, userQuery, jsonSchema);

        let newOptions = [];
        try {
            const parsedJson = JSON.parse(jsonText);
            newOptions = parsedJson.options ? parsedJson.options.slice(0, 5) : [];
        } catch (e) {
            console.error("Failed to parse AI options JSON:", e);
            throw new Error("Failed to parse AI response.");
        }

        if (newOptions.length === 0) {
            throw new Error("AI returned no options.");
        }

        // Normalize, shuffle, and reduce repetition
        newOptions = normalizeOptions(categoryKey, newOptions);
        newOptions = shuffleArray(newOptions);
        const prevSet = recentOptionsByCategory[categoryKey] || [];
        const filtered = newOptions.filter(opt => !prevSet.includes(opt));
        const finalOptions = (filtered.length >= 5 ? filtered.slice(0, 5) : newOptions.slice(0, 5));
        recentOptionsByCategory[categoryKey] = finalOptions.slice(0, 5);

        const fullMeta = allOptionalFieldsMeta.find(f => f.key === categoryKey);
        if (fullMeta) {
            appData[categoryKey] = { value: '', options: finalOptions };
        }

        success = true;

    } catch (error) {
        console.error("Failed to fetch options (API error):", error);
        const fallbackMap = {
            'color': ['red', 'blue', 'yellow', 'green', 'purple'],
            'food': ['pizza', 'burger', 'apple', 'noodles', 'ice cream'],
            'animal': ['a dog', 'a cat', 'a fish', 'an elephant', 'a bird'],
            'hobby': ['reading books', 'playing games', 'singing songs', 'drawing pictures', 'dancing'],
            'skill': ['run fast', 'jump high', 'climb trees', 'swim well', 'build things'],
            'dream': ['a doctor', 'a teacher', 'a chef', 'an astronaut', 'a firefighter']
        };
        const fallbackOptions = fallbackMap[categoryKey] || [];
        // Also clear existing selection when using fallback
        appData[categoryKey] = { value: '', options: fallbackOptions };

        const errorMessage = document.createElement('div');
        errorMessage.className = "fixed top-0 left-0 right-0 p-2 bg-red-500 text-white text-center z-50 shadow-lg text-sm";
        errorMessage.textContent = `옵션 생성 오류: ${error.message.substring(0, 50)}... 백업 옵션을 사용합니다.`;
        document.body.appendChild(errorMessage);
        setTimeout(() => { document.body.removeChild(errorMessage); }, 3000);

    } finally {
        const refreshButton = document.getElementById(`refresh-${categoryKey}`);
        if (refreshButton) {
            refreshButton.classList.remove('animate-spin');
        }
        // Re-render Step 1 to show refreshed options; set scroll position preservation
        if(document.getElementById('app-container').children.length > 0 && document.getElementById('next-button')) {
            const scrollContainer = document.querySelector('.custom-scrollbar');
            const scrollTopBefore = scrollContainer ? scrollContainer.scrollTop : 0;
            renderStep1Screen();
            if (scrollContainer) {
                setTimeout(() => {
                    const sc = document.querySelector('.custom-scrollbar');
                    if (sc) sc.scrollTop = scrollTopBefore;
                }, 0);
            }
        }
    }
};

// Prefetch Step 1 options before entering the screen
const prefetchStep1Options = async () => {
    if (currentOptionalFields.length === 0) {
        currentOptionalFields = pickRandomCategories();
    }
    await Promise.all(currentOptionalFields.map(meta => {
        const fullMeta = allOptionalFieldsMeta.find(f => f.key === meta.key);
        if (fullMeta) {
            return fetchOptions(fullMeta.key, fullMeta.categoryName).catch(err => {
                console.error(`Initial fetch failed for ${fullMeta.key}:`, err);
                return Promise.resolve();
            });
        }
        return Promise.resolve();
    }));
};

// Entry start handler: prefetch first, then navigate
async function startStep1WithPrefetch() {
    try {
        showLoading(true);
        const lt = document.getElementById('loading-text');
        if (lt) lt.textContent = 'AI is making your choices...';
        // Show Step 1 first, keep overlay on top while options load
        navigateTo('step1');
        await prefetchStep1Options();
    } finally {
        showLoading(false);
    }
}

const updateData = (key, value) => {
    if (['name', 'age', 'town'].includes(key)) {
        appData[key] = value;
    }
    else if (appData[key] && typeof appData[key] === 'object') {
        appData[key].value = value;
    }
    checkNextButtonState();
};

const handleOptionSelect = (categoryKey, option) => {
    // Update only input field value to avoid re-render flicker
    if (appData[categoryKey] && typeof appData[categoryKey] === 'object') {
        let finalOption = option;
        if (categoryKey === 'animal' || categoryKey === 'dream') {
            if (!option.match(/^(a|an)\s/i) && !option.match(/s$/i)) {
                const startsWithVowel = /^[aeiou]/i.test(option.trim());
                finalOption = (startsWithVowel ? 'an ' : 'a ') + option;
            }
        }
        appData[categoryKey].value = finalOption;
        const inputElement = document.getElementById(`input-${categoryKey}`);
        if (inputElement) {
            inputElement.value = finalOption;
            inputElement.classList.remove('placeholder-text');
        }
        // Update option chip highlight without full re-render
        const categoryBox = document.getElementById(`category-box-${categoryKey}`);
        if (categoryBox) {
            const buttons = categoryBox.querySelectorAll('button');
            buttons.forEach(btn => {
                const text = btn.textContent.trim();
                if (text === option) {
                    btn.classList.add('bg-blue-500','text-white','ring-2','ring-blue-700');
                    btn.classList.remove('bg-gray-100','text-gray-700');
                } else if (!btn.id || !btn.id.startsWith('refresh-')) {
                    btn.classList.remove('bg-blue-500','text-white','ring-2','ring-blue-700');
                    btn.classList.add('bg-gray-100','text-gray-700');
                }
            });
        }
    }
    checkNextButtonState();
};

const handleInputChange = (event, key, isOptional = false) => {
    let value = event.target.value;
    // Allow up to 60 characters for all inputs
    value = value.slice(0, 60);
    event.target.value = value;

    if (event.target.value.length > 0) {
        event.target.classList.remove('placeholder-text');
    } else {
        event.target.classList.add('placeholder-text');
    }

    if (isOptional) {
        if (appData[key] && typeof appData[key] === 'object') {
            appData[key] = { value: value, options: appData[key].options };
        }
        // Keep option chip highlight in sync with manual edits (e.g., backspace)
        const categoryBox = document.getElementById(`category-box-${key}`);
        if (categoryBox) {
            const buttons = categoryBox.querySelectorAll('button');
            buttons.forEach(btn => {
                if (!btn.id || !btn.id.startsWith('refresh-')) {
                    const text = btn.textContent.trim();
                    if (text === value.trim()) {
                        btn.classList.add('bg-blue-500','text-white','ring-2','ring-blue-700');
                        btn.classList.remove('bg-gray-100','text-gray-700');
                    } else {
                        btn.classList.remove('bg-blue-500','text-white','ring-2','ring-blue-700');
                        btn.classList.add('bg-gray-100','text-gray-700');
                    }
                }
            });
        }
    } else {
        updateData(key, value);
    }
    checkNextButtonState();
};

const checkNextButtonState = () => {
    const requiredFields = ['name', 'age', 'town'];
    const isRequiredFilled = requiredFields.every(key => appData[key].toString().trim() !== '');

    const isOptionalFilled = currentOptionalFields.every(field => {
        const value = appData[field.key]?.value || '';
        return value.trim() !== '';
    });

    const isNextEnabled = isRequiredFilled && isOptionalFilled;
    const nextButton = document.getElementById('next-button');
    if (nextButton) {
        nextButton.disabled = !isNextEnabled;
        if (isNextEnabled) {
            nextButton.classList.replace('bg-gray-300', 'bg-green-500');
            nextButton.classList.replace('text-gray-500', 'text-white');
            nextButton.classList.remove('cursor-not-allowed');
        } else {
            nextButton.classList.replace('bg-green-500', 'bg-gray-300');
            nextButton.classList.replace('text-white', 'text-gray-500');
            nextButton.classList.add('cursor-not-allowed');
        }
    }
};

const renderEntryScreen = () => {
    appContainer.className = "w-[1280px] h-[800px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col items-center justify-center relative";
    appContainer.innerHTML = `
        <div class="w-full h-full flex flex-col items-center justify-center relative p-8"
             style="background-image: url(image/entry-screen.png); background-size: cover; background-position: center 70%; background-repeat: no-repeat;">
            <h1 class="text-6xl font-black text-orange-500 drop-shadow-lg absolute top-16" style="font-size: 55px;">
                This is Me!
            </h1>
            <button id="start-button"
                class="absolute bottom-11 right-12 px-10 py-5 bg-orange-500 text-white custom-button-text font-extrabold rounded-full shadow-xl hover:bg-orange-600 transform transition-all duration-150 active:scale-95"
            >
                Tap to Start
            </button>
        </div>
    `;
    document.getElementById('start-button').onclick = () => startStep1WithPrefetch();
};

const createInputFieldHTML = (meta, isRequired) => {
    const key = meta.key;
    const fieldData = isRequired ? appData[key] : appData[key];
    const currentValue = isRequired ? fieldData : (fieldData.value || '');
    const options = isRequired ? [] : (fieldData.options || []);

    const inputType = 'text';
    const inputPlaceholder = isRequired ? 'Type here' : 'Type or select';
    const baseInputClasses = 'inline-block border-b-2 border-gray-400 focus:border-blue-500 outline-none transition-colors duration-200 text-blue-600 font-bold category-sentence px-1';
    const inputWidthClass = key === 'age' ? 'w-96' : (key === 'name' || key === 'town' ? 'w-2/5' : 'w-3/5');
    const inputAlignmentClass = key === 'age' ? 'text-left' : '';
    const maxLength = key === 'age' ? 30 : 60;
    const disabledAttr = '';
    const placeholderClass = currentValue.length === 0 ? 'placeholder-text' : '';
    const inputValue = currentValue;

    let sentenceContent = meta.sentence;
    if (key === 'dream') {
        sentenceContent = sentenceContent.replace('a ___ .', '___ .');
    }

    let html = `
        <div class="category-box" id="category-box-${key}">
            <div class="category-title-tag">${meta.label}</div>
            <p class="text-xl text-gray-700 mt-2 mb-3 category-sentence">
                ${sentenceContent.split('___')[0]}
                <input
                    id="input-${key}"
                    type="${inputType}"
                    value="${inputValue}"
                    oninput="handleInputChange(event, '${key}', ${!isRequired})"
                    onchange="${isRequired ? `updateData('${key}', this.value)` : ''}"
                    placeholder="${inputPlaceholder}"
                    class="${baseInputClasses} ${inputWidthClass} ${inputAlignmentClass} ${placeholderClass}"
                    maxlength="${maxLength}"
                    ${disabledAttr}
                />
                ${sentenceContent.split('___')[1]}
            </p>
    `;

    if (!isRequired) {
            html += `
            <div class="option-container flex flex-col">
                <div class="refresh-button-container">
                        <button id="refresh-${key}" data-category-key="${key}" data-category-name="${meta.categoryName}"
                            class="flex items-center p-1 bg-yellow-100 text-yellow-700 rounded-full hover:bg-yellow-200 transition-colors shadow-md" type="button">
                        <i data-lucide="refresh-cw" class="refresh-icon"></i>
                    </button>
                </div>
                <div class="flex flex-wrap gap-2 mt-2 pt-2 border-t border-gray-100">
                    ${options.map((option, index) => {
                        const isHighlighted = currentValue === option;
                        const optionClass = isHighlighted
                            ? 'bg-blue-500 text-white ring-2 ring-blue-700'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200';
                        return `
                            <button onclick="handleOptionSelect('${key}', '${option}')"
                                class="px-4 py-2 text-lg rounded-full font-semibold transition-all shadow-md ${optionClass}">
                                ${option}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    html += `</div>`;
    return html;
};

const renderStep1Screen = () => {
    appContainer.className = "w-[1280px] h-[800px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col p-8 bg-yellow-50";

    const requiredFieldsMeta = [
        { key: 'name', label: 'Name', sentence: 'My name is ___.', categoryName: 'Name' },
        { key: 'age', label: 'Age', sentence: 'I am ___ years old.', categoryName: 'Age' },
        { key: 'town', label: 'Town', sentence: 'I live in ___.', categoryName: 'Town' },
    ];

    const mandatoryHTML = requiredFieldsMeta.map(meta => createInputFieldHTML(meta, true)).join('');
    const optionalHTML = currentOptionalFields.map(meta => createInputFieldHTML(meta, false)).join('');

    appContainer.innerHTML = `
        <div class="flex items-center mb-4 p-4 bg-white rounded-xl shadow-md z-10 sticky top-0">
            <div class="step-title-box mr-4">Step 1</div>
            <p class="text-xl text-gray-700 font-medium">Fill in the blanks to introduce yourself!</p>
        </div>
        <div class="flex-grow overflow-y-auto pr-4 custom-scrollbar pt-4">
            ${mandatoryHTML}
            ${optionalHTML}
            <div class='h-32'></div>
        </div>
        <div class="absolute bottom-8 right-8">
            <button id="next-button"
                onclick="navigateTo('step2')"
                disabled
                class="px-8 py-4 custom-button-text font-extrabold rounded-full shadow-2xl transition-all duration-200 bg-gray-300 text-gray-500 cursor-not-allowed">
                Next
            </button>
        </div>
    `;
    checkNextButtonState();
    lucide.createIcons();
    bindRefreshButtons();
};

let webcamStream = null;

const startWebcam = async () => {
    photoSource = 'camera';

    const video = document.getElementById('webcam-video');
    const placeholder = document.getElementById('photo-placeholder');
    const startButton = document.getElementById('start-camera-button-container');
    const uploadButton = document.getElementById('file-upload-button-container');
    const retryButton = document.getElementById('retry-button-container');
    const status = document.getElementById('photo-status');
    const captureButton = document.getElementById('capture-button');

    if (webcamStream) {
        stopWebcam();
    }

    if (startButton) startButton.disabled = true;
    if (uploadButton) uploadButton.disabled = true;
    if (retryButton) retryButton.style.display = 'none';
    if (captureButton) captureButton.style.display = 'none';

    if (status) status.innerHTML = ``;

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("getUserMedia not supported in this browser.");
        }

        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = webcamStream;
        video.style.display = 'block';
        placeholder.style.display = 'none';
        await video.play();

        if (captureButton) captureButton.style.display = 'flex';
        if (startButton) startButton.style.display = 'none';
        if (uploadButton) uploadButton.style.display = 'none';
        if (status) status.innerHTML = `<span class="text-green-600 font-bold">The camera is on. Tap the button to take a photo!</span>`;

    } catch (err) {
        console.error("Error accessing webcam: ", err);
        photoSource = appData.photoBase64 ? photoSource : null;

        stopWebcam();
        if (startButton) startButton.disabled = false;
        if (uploadButton) uploadButton.disabled = false;
        if (captureButton) captureButton.style.display = 'none';
        if (status) status.innerHTML = `<span class="text-red-500">Camera blocked or unavailable. Please upload a file.</span>`;

        if (!appData.photoBase64) {
            if (startButton) startButton.style.display = 'flex';
            if (uploadButton) uploadButton.style.display = 'block';
        }
    }
};

const stopWebcam = () => {
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => {
            track.stop();
        });
        webcamStream = null;
    }
    const video = document.getElementById('webcam-video');
    const placeholder = document.getElementById('photo-placeholder');
    const startButton = document.getElementById('start-camera-button-container');
    const uploadButton = document.getElementById('file-upload-button-container');
    const retryButton = document.getElementById('retry-button-container');
    const captureButton = document.getElementById('capture-button');

    if (video) {
        video.srcObject = null;
        video.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';

    if (appData.photoBase64) {
        if (startButton) startButton.style.display = 'none';
        if (uploadButton) uploadButton.style.display = 'none';
        if (retryButton) retryButton.style.display = 'flex';
    } else {
        if (startButton) startButton.style.display = 'flex';
        if (uploadButton) uploadButton.style.display = 'block';
        if (retryButton) retryButton.style.display = 'none';
    }
    if (captureButton) captureButton.style.display = 'none';
};

const handleCapture = () => {
    const video = document.getElementById('webcam-video');
    const canvas = document.createElement('canvas');
    const size = 450;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, size, size);
    const base64Image = canvas.toDataURL('image/png');
    appData.photoBase64 = base64Image;
    stopWebcam();
    renderStep2Screen();
};

const handleRetry = () => {
    // Reset to initial Step 2 state: no source, no saved photo, no selected style
    photoSource = null;
    stopWebcam();
    appData.photoBase64 = null;
    appData.style = '';
    renderStep2Screen();
};

const handlePhotoUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
        photoSource = 'upload';
        stopWebcam();
        const reader = new FileReader();
        reader.onload = (e) => {
            appData.photoBase64 = e.target.result;
            renderStep2Screen();
        };
        reader.readAsDataURL(file);
    }
};

const handleStyleSelect = (style) => {
    appData.style = style;
    // Re-render but keep existing photoBase64 image visible
    renderStep2Screen();
};

const handleSubmit = async () => {
    if (!appData.photoBase64 || !appData.style) return;
    stopWebcam();
    showLoading(true);
    const lt = document.getElementById('loading-text');
    if (lt) lt.textContent = 'AI is making your character...';
    try {
        const style = (appData.style || 'Cartoon');
        const styleMap = {
            'Cartoon': {
                prompt: 'Create a close-up portrait based on the uploaded photo, keeping the same face and hairstyle. Turn it into a cute cartoon-style character for a young elementary school student. Focus on the face and upper body. Use bright pastel colors, soft lighting, and a friendly smile. The background should be simple and cheerful, like a children\'s cartoon show.',
                size: '1024x1024'
            },
            'Fairy Tale': {
                prompt: 'Create a close-up portrait based on the uploaded photo, keeping the same face and hairstyle. Turn it into a fairy tale-style character suitable for a young child, like a kind princess or gentle storyteller. Focus on the face and upper body. Use soft glow, sparkles, and dreamy pastel tones. The background should feel like a magical storybook scene.',
                size: '1024x1024'
            },
            'Super Hero': {
                prompt: 'Create a close-up portrait based on the uploaded photo, keeping the same face and hairstyle. Turn it into a kid-friendly superhero character with a confident and cheerful expression. Focus on the face and upper body. Use colorful lighting, comic-style details, and a simple action background. Keep the style bright and fun, not dark.',
                size: '1024x1024'
            },
            'LEGO': {
                prompt: 'Create a close-up portrait based on the uploaded photo, keeping the same face and hairstyle. Turn it into a LEGO-style character face with a smiling expression. Focus on the head and shoulders, showing a simple LEGO body. Use bright colors and a clean background. Make it look friendly and toy-like, suitable for kids.',
                size: '1024x1024'
            },
            'Fantasy': {
                prompt: 'Create a close-up portrait based on the uploaded photo, keeping the same face and hairstyle. Turn it into a fantasy-style character like a young wizard, explorer, or dragon friend. Focus on the face and upper body. Add soft magical effects, glowing light, or colorful fantasy background. Keep it bright, kind, and child-friendly.',
                size: '1024x1024'
            }
        };

        const promptSpec = styleMap[style] || styleMap['Cartoon'];
        if (appData.photoBase64) {
            // Use edit endpoint when we have a photo. If it fails, fall back to text generation.
            try {
                appData.generatedImageUrl = await fetchOpenAIImageWithPhoto(promptSpec.prompt, appData.photoBase64, promptSpec.size);
            } catch (editErr) {
                console.error('Image edit failed, falling back to generation:', editErr);
                try {
                    appData.generatedImageUrl = await fetchOpenAIImage(promptSpec.prompt);
                } catch {
                    // Final fallback: local sample image
                    appData.generatedImageUrl = 'image/sample_image.png';
                }
            }
        } else {
            try {
                appData.generatedImageUrl = await fetchOpenAIImage(promptSpec.prompt);
            } catch {
                appData.generatedImageUrl = 'image/sample_image.png';
            }
        }
    } catch (error) {
        console.error("Image API error:", error);
        appData.generatedImageUrl = 'image/sample_image.png';
        const errorMessage = document.createElement('div');
        errorMessage.className = "fixed top-0 left-0 right-0 p-2 bg-red-500 text-white text-center z-50 shadow-lg text-sm";
        errorMessage.textContent = `이미지 생성 오류: ${error.message.substring(0, 50)}...`;
        document.body.appendChild(errorMessage);
        setTimeout(() => { document.body.removeChild(errorMessage); }, 3000);
    }

    try {
        const dataForAI = {
            name: appData.name, age: appData.age, town: appData.town,
            ...currentOptionalFields.reduce((acc, field) => {
                acc[field.key] = appData[field.key].value;
                return acc;
            }, {})
        };
        const systemPrompt = "You are a friendly and encouraging English teacher AI for elementary school students. Write a concise, 5-7 sentence self-introduction in simple, cheerful English using ALL the provided information. Start immediately at the beginning of the line with 'Hello! My name is ...' (no leading spaces or indentation). Use correct spacing around punctuation: no spaces before commas/periods, one space after. Keep it clean and readable.";
        const userQuery = `Generate a self-introduction based on the following data: ${JSON.stringify(dataForAI, null, 2)}`;
        appData.generatedText = await fetchOpenAIText(systemPrompt, userQuery);
    } catch (error) {
        console.error("Text API error:", error);
        appData.generatedText = "Oops! My AI friend is taking a break. Here is a simple introduction: Hello! My name is [Name] and I am [Age] years old. I live in [Town]. I love [Color] color. I enjoy [Food] and I can [Skill].";
        const errorMessage = document.createElement('div');
        errorMessage.className = "fixed top-0 left-0 right-0 p-2 bg-red-500 text-white text-center z-50 shadow-lg text-sm";
        errorMessage.textContent = `자기소개 생성 오류: ${error.message.substring(0, 50)}...`;
        document.body.appendChild(errorMessage);
        setTimeout(() => { document.body.removeChild(errorMessage); }, 3000);
    }

    showLoading(false);
    navigateTo('result');
};

const renderStep2Screen = () => {
    const styles = ['Cartoon', 'Fairy Tale', 'Super Hero', 'LEGO', 'Fantasy'];
    const isSubmitEnabled = appData.photoBase64 && appData.style;
    appContainer.className = "w-[1280px] h-[800px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col p-8 bg-yellow-50";
    appContainer.innerHTML = `
        <div class="flex items-center mb-6 p-4 bg-white rounded-xl shadow-md z-10 sticky top-0">
            <div class="step-title-box mr-4">Step 2</div>
            <p class="text-xl text-gray-700 font-medium">Take or upload your photo. Then choose the style.</p>
        </div>
        <div class="flex flex-1 gap-8">
            <div class="flex flex-col items-center justify-start w-1/2 p-4 bg-white rounded-3xl shadow-xl border-4 border-blue-200">
                <div class="relative w-[450px] h-[450px] bg-gray-200 rounded-3xl flex items-center justify-center overflow-hidden mb-6 border-8 border-white shadow-inner">
                    <video id="webcam-video" autoplay playsinline style="display:none;"></video>
                    ${appData.photoBase64 ?
                        `<img src="${appData.photoBase64}" alt="User Photo" class="w-full h-full object-cover" />` :
                        '<i id="photo-placeholder" data-lucide="camera" class="w-20 h-20 text-gray-500"></i>'
                    }
                </div>
                <div id="photo-status" class="mb-2 text-center"></div>
                <div class="flex items-center justify-center w-full space-x-4 mt-2">
                    <button id="capture-button" onclick="handleCapture()" style="display:none;"
                        class="flex items-center p-4 bg-red-400 text-white rounded-full shadow-lg hover:bg-red-500 transition-all active:scale-95">
                        <i data-lucide="camera" class="w-8 h-8"></i>
                    </button>
                    <button onclick="handleRetry()" id="retry-button-container" style="display:${appData.photoBase64 ? 'flex' : 'none'};"
                        class="flex items-center px-6 py-3 bg-red-500 text-white text-xl font-bold rounded-full shadow-lg hover:bg-red-600 transition-all active:scale-95">
                        <i data-lucide="refresh-ccw" class="w-6 h-6 mr-2"></i>
                        Retry
                    </button>
                    <button onclick="startWebcam()" id="start-camera-button-container"
                        class="flex items-center px-6 py-3 bg-indigo-500 text-white text-xl font-bold rounded-full shadow-lg hover:bg-indigo-600 transition-all active:scale-95 ${appData.photoBase64 ? 'hidden' : ''}">
                        <i data-lucide="video" class="w-6 h-6 mr-2"></i>
                        Camera
                    </button>
                    <label for="photo-upload" id="file-upload-button-container" class="${appData.photoBase64 ? 'hidden' : 'block'}">
                        <input type="file" id="photo-upload" accept="image/*" onchange="handlePhotoUpload(event)" class="hidden"/>
                        <button onclick="document.getElementById('photo-upload').click(); stopWebcam();"
                            class="flex items-center px-6 py-3 bg-yellow-400 text-gray-800 text-xl font-bold rounded-full shadow-lg hover:bg-yellow-500 transition-all active:scale-95">
                            <i data-lucide="upload" class="w-6 h-6 mr-2"></i>
                            Upload
                        </button>
                    </label>
                </div>
            </div>
            <div class="flex flex-col items-center justify-start w-1/2 p-6 pt-0 bg-white rounded-3xl shadow-xl border-4 border-yellow-200">
                <h3 class="text-3xl font-bold text-yellow-600 mb-4 mt-2">Character Style</h3>
                ${['Cartoon', 'Fairy Tale', 'Super Hero', 'LEGO', 'Fantasy'].map(style => `
                    <button onclick="handleStyleSelect('${style}')"
                        class="w-4/5 py-4 my-2 text-xl font-bold rounded-xl shadow-lg transition-all transform
                        ${appData.style === style ?
                            'bg-yellow-400 text-gray-800 ring-4 ring-yellow-600 scale-105' :
                            'bg-yellow-50 text-gray-600 hover:bg-yellow-100 hover:scale-[1.02] active:scale-100'
                        }"
                    >
                        ${style}
                    </button>
                `).join('')}
            </div>
        </div>
        <div class="absolute bottom-20 right-24">
            <button id="submit-button" onclick="handleSubmit()"
                ${!isSubmitEnabled ? 'disabled' : ''}
                class="px-6 py-3 text-xl font-bold rounded-full shadow-2xl transition-all duration-200 flex items-center justify-center
                ${isSubmitEnabled
                    ? 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }">
                Submit
            </button>
        </div>
    `;
    stopWebcam();
    lucide.createIcons();
};

const handleDownload = async () => {
    const resultArea = document.getElementById('result-content-area');
    const downloadButton = document.getElementById('download-button');
    const playAgainButton = document.getElementById('play-again-button');
    if (!resultArea) return;
    if (downloadButton) downloadButton.style.display = 'none';
    if (playAgainButton) playAgainButton.style.display = 'none';
    try {
        // Render from an unscaled clone so text does not overlap when the page is scaled
        const canvas = await html2canvas(resultArea, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            onclone: (doc) => {
                const sw = doc.getElementById('stage-wrapper');
                if (sw) {
                    sw.style.transform = 'translateX(-50%) scale(1)';
                }
                const ra = doc.getElementById('result-content-area');
                if (ra) {
                    ra.style.transform = 'none';
                }
            },
            windowWidth: BASE_WIDTH,
            windowHeight: BASE_HEIGHT
        });
        const image = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = image;
        a.download = `This_Is_Me_${appData.name}_Result.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (error) {
        console.error("Download Capture Error:", error);
        const errorMessage = document.createElement('div');
        errorMessage.className = "fixed top-0 left-0 right-0 p-4 bg-red-500 text-white text-center z-50 shadow-lg";
        errorMessage.textContent = '다운로드 오류: 이미지가 크거나 CORS 문제로 캡처하지 못했습니다. 브라우저의 스크린샷 기능을 사용해 주세요.';
        document.body.appendChild(errorMessage);
        setTimeout(() => { document.body.removeChild(errorMessage); }, 5000);
    } finally {
        if (downloadButton) downloadButton.style.display = 'flex';
        if (playAgainButton) playAgainButton.style.display = 'flex';
    }
};

const renderResultScreen = () => {
    appContainer.className = "w-[1280px] h-[800px] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col p-8 bg-yellow-50";
    const imageSrc = appData.generatedImageUrl || "https://placehold.co/450x450/CCCCCC/333333?text=Image+Not+Available";
    appContainer.innerHTML = `
        <div id="result-content-area" class="w-full h-full flex flex-col p-4">
            <h1 class="text-5xl font-black text-blue-700 mb-8 text-center">
                This is Me!
            </h1>
            <div class="flex flex-1 gap-8 items-center pt-8">
                <div class="w-1/2 flex items-center justify-center self-start pt-8">
                    <div class="w-[450px] h-[450px] bg-white rounded-3xl shadow-2xl border-8 border-yellow-300 overflow-hidden flex items-center justify-center">
                        <img src="${imageSrc}" alt="Generated Character" class="w-full h-full object-cover" crossorigin="anonymous" onerror="this.src='https://placehold.co/450x450/CCCCCC/333333?text=Image+Load+Error';"/>
                    </div>
                </div>
                <div class="w-1/2 flex flex-col justify-start h-full pt-8">
                    <div id="result-text-area" class="w-full h-[450px] pt-0 px-8 pb-8 bg-white rounded-3xl shadow-xl overflow-y-auto border-8 border-green-300">
                        <p class="whitespace-pre-wrap leading-relaxed font-medium text-gray-800 result-text-21px" style="margin-top: 0; text-align: left;">
                            ${appData.generatedText || "The AI-generated self-introduction will be displayed here."}
                        </p>
                    </div>
                </div>
            </div>
        </div>
        <div class="flex justify-center space-x-8 mt-12">
            <button id="download-button" onclick="handleDownload()"
                class="flex items-center px-10 py-4 bg-yellow-500 text-white custom-button-text font-extrabold rounded-full shadow-xl hover:bg-yellow-600 transition-all active:scale-95">
                <i data-lucide="download" class="w-7 h-7 mr-2"></i>
                Download
            </button>
            <button id="play-again-button" onclick="location.reload()"
                class="flex items-center px-10 py-4 bg-green-500 text-white custom-button-text font-extrabold rounded-full shadow-xl hover:bg-green-600 transition-all active:scale-95">
                <i data-lucide="play" class="w-7 h-7 mr-2"></i>
                Play Again
            </button>
        </div>
    `;
    lucide.createIcons();
};

window.onload = () => {
    applyStageScale();
    renderScreen('entry');
    lucide.createIcons();
};

const originalNavigateTo = navigateTo;
window.navigateTo = async (screenName) => {
    if (screenName === 'step1' && currentOptionalFields.length === 0) {
        currentOptionalFields = pickRandomCategories();
        // Preload options in background without showing overlay, then refresh Step 1
        Promise.all(currentOptionalFields.map(meta => {
            const fullMeta = allOptionalFieldsMeta.find(f => f.key === meta.key);
            if (fullMeta) {
                return fetchOptions(fullMeta.key, fullMeta.categoryName).catch(err => {
                    console.error(`Initial fetch failed for ${fullMeta.key}:`, err);
                    return Promise.resolve();
                });
            }
            return Promise.resolve();
        })).then(() => {
            if (document.getElementById('next-button')) {
                renderStep1Screen();
            }
        });
    }
    originalNavigateTo(screenName);
};

// Removed API key modal flow; server holds the key

// expose functions used by inline HTML event handlers
window.fetchOptions = fetchOptions;
window.updateData = updateData;
window.handleOptionSelect = handleOptionSelect;
window.handleInputChange = handleInputChange;
window.startWebcam = startWebcam;
window.stopWebcam = stopWebcam;
window.handleCapture = handleCapture;
window.handleRetry = handleRetry;
window.handlePhotoUpload = handlePhotoUpload;
window.handleStyleSelect = handleStyleSelect;
window.handleSubmit = handleSubmit;
window.handleDownload = handleDownload;
window.startStep1WithPrefetch = startStep1WithPrefetch;




