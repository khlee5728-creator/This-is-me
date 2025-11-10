const TEXT_MODEL = "gpt-3.5-turbo";
const IMAGE_MODEL = "dall-e-3";

const appContainer = document.getElementById('app-container');
const loadingOverlay = document.getElementById('loading-overlay');
const apiKeyModal = document.getElementById('api-key-modal');

let photoSource = null;

let appData = {
    openAIApiKey: '',
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

const fetchOpenAIText = async (systemPrompt, userQuery, jsonSchema = null) => {
    if (!appData.openAIApiKey) throw new Error("API Key not set.");

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appData.openAIApiKey}`
    };

    const body = {
        model: TEXT_MODEL,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userQuery }
        ],
        temperature: 0.7,
    };

    if (jsonSchema) {
        body.response_format = { type: "json_object" };
    }

    const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    const result = await response.json();
    if (result.choices && result.choices.length > 0) {
        return result.choices[0].message.content.trim();
    }
    throw new Error("OpenAI text generation failed. No response content.");
};

const fetchOpenAIImage = async (prompt) => {
    if (!appData.openAIApiKey) throw new Error("API Key not set.");

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${appData.openAIApiKey}`
    };

    const body = {
        model: IMAGE_MODEL,
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json"
    };

    const response = await fetchWithRetry('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    });

    const result = await response.json();
    if (result.data && result.data.length > 0) {
        const base64Image = result.data[0].b64_json;
        return `data:image/png;base64,${base64Image}`;
    }
    throw new Error("OpenAI image generation failed. No image data.");
};

const renderScreen = (screenName) => {
    appContainer.innerHTML = '';
    switch (screenName) {
        case 'entry':
            renderEntryScreen();
            break;
        case 'step1':
            if (currentOptionalFields.length === 0 || screenName === 'step1') {
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
    const systemPrompt = `You are an AI assistant for young elementary students. Provide 5 simple, short phrase examples for the category: "${categoryName}". Each option MUST be grammatically correct when placed into the sentence blank (e.g., if the sentence is "I can ___." options should be like "run fast"). All options MUST start with a lowercase letter, unless they are proper nouns (which are not expected here). Respond ONLY with a JSON object containing a single key "options" which is an array of strings.`;
    const userQuery = `Generate 5 options for the category: "${categoryName}".`;

    const jsonSchema = true;
    let success = false;

    try {
        const refreshButton = document.getElementById(`refresh-${categoryKey}`);
        if (refreshButton) {
            if (refreshButton.classList.contains('animate-spin')) return;
            refreshButton.classList.add('animate-spin');
        }

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

        const fullMeta = allOptionalFieldsMeta.find(f => f.key === categoryKey);
        if (fullMeta) {
            appData[categoryKey] = { value: '', options: newOptions };
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
        if(document.getElementById('app-container').children.length > 0 && document.getElementById('next-button')) {
            renderStep1Screen();
        }
    }
};

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
    const scrollContainer = document.querySelector('.custom-scrollbar');
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

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
    }
    checkNextButtonState();
    renderStep1Screen();
    if (scrollContainer) {
        setTimeout(() => {
            document.querySelector('.custom-scrollbar').scrollTop = scrollTop;
        }, 0);
    }
};

const handleInputChange = (event, key, isOptional = false) => {
    let value = event.target.value;

    if (key === 'age') {
        value = value.replace(/[^0-9]/g, '').slice(0, 2);
        event.target.value = value;
    }

    if (event.target.value.length > 0) {
        event.target.classList.remove('placeholder-text');
    } else {
        event.target.classList.add('placeholder-text');
    }

    if (isOptional) {
        if (appData[key] && typeof appData[key] === 'object') {
            appData[key] = { value: value, options: appData[key].options };
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
        <div class="w-full h-full flex flex-col items-center justify-center relative p-8 bg-blue-100/30"
             style="background-image: url(https://placehold.co/1280x800/dff9d7/000?text=Background+Image); background-size: cover;">
            <h1 class="text-6xl font-black text-blue-700 drop-shadow-lg absolute top-16" style="font-size: 55px;">
                This is Me!
            </h1>
            <div class="flex-grow flex items-center justify-center">
                <div class="text-4xl text-gray-500 font-bold p-10 bg-white/70 rounded-2xl shadow-xl">
                    Create your own self-introduction!
                </div>
            </div>
            <button id="start-button"
                class="absolute bottom-16 right-16 px-10 py-5 bg-orange-500 text-white custom-button-text font-extrabold rounded-full shadow-xl hover:bg-orange-600 transform transition-all duration-150 active:scale-95"
            >
                Tap to Start
            </button>
        </div>
    `;
    document.getElementById('start-button').onclick = () => apiKeyModal.style.display = 'flex';
};

const createInputFieldHTML = (meta, isRequired) => {
    const key = meta.key;
    const fieldData = isRequired ? appData[key] : appData[key];
    const currentValue = isRequired ? fieldData : (fieldData.value || '');
    const options = isRequired ? [] : (fieldData.options || []);

    const inputType = 'text';
    const inputPlaceholder = isRequired ? 'Type here' : 'Type or select';
    const baseInputClasses = 'inline-block border-b-2 border-gray-400 focus:border-blue-500 outline-none transition-colors duration-200 text-blue-600 font-bold category-sentence px-1';
    const inputWidthClass = key === 'age' ? 'w-32' : 'w-3/5';
    const inputAlignmentClass = key === 'age' ? 'text-center' : '';
    const maxLength = key === 'age' ? 2 : 30;
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
                    <button id="refresh-${key}" onclick="fetchOptions('${key}', '${meta.categoryName}')"
                        class="flex items-center p-1 bg-yellow-100 text-yellow-700 rounded-full hover:bg-yellow-200 transition-colors shadow-md">
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

    if (status) status.innerHTML = `<span class="text-gray-500">Starting camera...</span>`;

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
        if (status) status.innerHTML = `<span class="text-green-600">Camera is active. Click the button to take a photo!</span>`;

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
    appData.photoBase64 = null;
    if (photoSource === 'camera') {
        startWebcam();
    } else if (photoSource === 'upload') {
        document.getElementById('photo-upload').click();
    } else {
        renderStep2Screen();
    }
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
    renderStep2Screen();
};

const handleSubmit = async () => {
    if (!appData.photoBase64 || !appData.style) return;
    stopWebcam();
    showLoading(true);
    try {
        const basePrompt = `A vibrant, friendly portrait of a young child character for a self-introduction. The child has the appearance of the person in the uploaded photo. The style should be ${appData.style}. The image should be appealing and positive, suitable for elementary school kids.`;
        appData.generatedImageUrl = await fetchOpenAIImage(basePrompt);
    } catch (error) {
        console.error("Image API error:", error);
        appData.generatedImageUrl = "https://placehold.co/450x450/CCCCCC/333333?text=DALL-E+Error";
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
        const systemPrompt = "You are a friendly and encouraging English teacher AI for elementary school students. Write a concise, 5-7 sentence self-introduction in simple, cheerful English using ALL the provided information. Start with 'Hello! My name is...' and structure the paragraph clearly. Ensure the text starts right at the beginning of the line with no leading whitespace or indent. Use appropriate punctuation.";
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
        <div class="flex items-center mb-8 p-4 bg-white rounded-xl shadow-md z-10 sticky top-0">
            <div class="step-title-box mr-4">Step 2</div>
            <p class="text-xl text-gray-700 font-medium">Take or upload your photo. Then choose the style.</p>
        </div>
        <div class="flex flex-1 gap-8">
            <div class="flex flex-col items-center justify-center w-1/2 p-4 bg-white rounded-3xl shadow-xl border-4 border-blue-200">
                <div class="relative w-[450px] h-[450px] bg-gray-200 rounded-3xl flex items-center justify-center overflow-hidden mb-6 border-8 border-white shadow-inner">
                    <video id="webcam-video" autoplay playsinline style="display:none;"></video>
                    ${appData.photoBase64 ?
                        `<img src="${appData.photoBase64}" alt="User Photo" class="w-full h-full object-cover" />` :
                        '<i id="photo-placeholder" data-lucide="camera" class="w-20 h-20 text-gray-500"></i>'
                    }
                </div>
                <div id="photo-status" class="mb-4 text-center">
                    ${appData.photoBase64 ?
                        '<span class="text-green-600 font-bold flex items-center"><i data-lucide="check-circle" class="w-5 h-5 mr-1"></i> Photo uploaded successfully!</span>' :
                        '<span class="text-gray-500">Click below to start your camera or upload a file.</span>'
                    }
                </div>
                <div class="flex items-center space-x-4">
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
            <div class="flex flex-col items-center justify-center w-1/2 p-4 bg-white rounded-3xl shadow-xl border-4 border-yellow-200">
                <h3 class="text-3xl font-bold text-yellow-600 mb-6">Character Style</h3>
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
        <div class="absolute bottom-8 right-8">
            <button id="submit-button" onclick="handleSubmit()"
                ${!isSubmitEnabled ? 'disabled' : ''}
                class="px-8 py-4 custom-button-text font-extrabold rounded-full shadow-2xl transition-all duration-200 flex items-center justify-center
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
        const canvas = await html2canvas(resultArea, {
            scale: 2,
            useCORS: true,
            allowTaint: true
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
                    <div id="result-text-area" class="w-full h-[450px] p-8 bg-white rounded-3xl shadow-xl overflow-y-auto border-2 border-green-300">
                        <p class="whitespace-pre-wrap text-[20px] leading-relaxed font-medium text-gray-800" style="margin-top: 0; text-align: left;">
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
    renderScreen('entry');
    lucide.createIcons();
    const storedKey = localStorage.getItem('openai-api-key');
    if (storedKey) {
        appData.openAIApiKey = storedKey;
        document.getElementById('openai-api-key-input').value = storedKey;
        navigateTo('step1');
    }
};

const originalNavigateTo = navigateTo;
window.navigateTo = async (screenName) => {
    if (screenName === 'step1' && appData.openAIApiKey && currentOptionalFields.length === 0) {
        showLoading(true);
        currentOptionalFields = pickRandomCategories();
        const fetchPromises = currentOptionalFields.map(meta => {
            const fullMeta = allOptionalFieldsMeta.find(f => f.key === meta.key);
            if (fullMeta) {
                return fetchOptions(fullMeta.key, fullMeta.categoryName).catch(err => {
                    console.error(`Initial fetch failed for ${fullMeta.key}:`, err);
                    return Promise.resolve();
                });
            }
            return Promise.resolve();
        });
        await Promise.all(fetchPromises);
        showLoading(false);
    }
    originalNavigateTo(screenName);
};

document.getElementById('openai-api-key-input').addEventListener('input', (e) => {
    const key = e.target.value.trim();
    const button = document.querySelector('#api-key-modal button');
    if (key.startsWith('sk-') && key.length > 20) {
        button.classList.replace('bg-green-500', 'bg-blue-500');
        button.classList.add('hover:bg-blue-600');
    } else {
        button.classList.replace('bg-blue-500', 'bg-green-500');
        button.classList.add('hover:bg-green-600');
    }
});

window.saveApiKey = async () => {
    const key = document.getElementById('openai-api-key-input').value.trim();
    if (key.startsWith('sk-') && key.length > 20) {
        appData.openAIApiKey = key;
        localStorage.setItem('openai-api-key', key);
        apiKeyModal.style.display = 'none';
        showLoading(true);
        currentOptionalFields = pickRandomCategories();
        const fetchPromises = currentOptionalFields.map(meta => {
            const fullMeta = allOptionalFieldsMeta.find(f => f.key === meta.key);
            if (fullMeta) {
                return fetchOptions(fullMeta.key, fullMeta.categoryName).catch(err => {
                    console.error(`Initial fetch failed for ${fullMeta.key}:`, err);
                    return Promise.resolve();
                });
            }
            return Promise.resolve();
        });
        await Promise.all(fetchPromises);
        showLoading(false);
        navigateTo('step1');
    } else {
        const errorMessage = document.createElement('div');
        errorMessage.className = "fixed top-0 left-0 right-0 p-2 bg-red-500 text-white text-center z-50 shadow-lg text-sm";
        errorMessage.textContent = '유효한 OpenAI API Key를 입력해 주세요.';
        document.body.appendChild(errorMessage);
        setTimeout(() => { document.body.removeChild(errorMessage); }, 3000);
    }
};

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


