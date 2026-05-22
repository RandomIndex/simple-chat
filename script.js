// ======================== КОНФИГУРАЦИЯ ИЗ token.js ========================
if (typeof GITHUB_TOKEN === 'undefined' || typeof GITHUB_OWNER === 'undefined' || typeof GITHUB_REPO === 'undefined') {
    alert('Ошибка: файл token.js не настроен. Создайте его по примеру token.example.js и укажите токен, владельца и репозиторий.');
    throw new Error('Missing GitHub config');
}

const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/chat-db.json`;
let currentSha = null;           // SHA файла chat-db.json
let pollingInterval = null;
let currentRoom = null;          // текущий код комнаты
let currentKey = null;           // CryptoKey для текущей комнаты
let currentSalt = null;          // соль комнаты (Uint8Array)
let messagesList = [];           // расшифрованные сообщения для UI
let senderId = localStorage.getItem('senderId');
if (!senderId) {
    senderId = crypto.randomUUID();
    localStorage.setItem('senderId', senderId);
}
let lastStoredRoom = localStorage.getItem('lastRoom') || '';
let isEditing = false;
let editingMsgId = null;

// DOM элементы
const startScreen = document.getElementById('startScreen');
const chatScreen = document.getElementById('chatScreen');
const roomCodeInput = document.getElementById('roomCodeInput');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const exitBtn = document.getElementById('exitBtn');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusBar = document.getElementById('statusBar');
const toastEl = document.getElementById('toast');
const startError = document.getElementById('startError');

// Вспомогательные функции
function showToast(msg, duration = 2000) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function setStatus(msg, isError = false) {
    statusBar.textContent = msg;
    statusBar.style.color = isError ? '#ff8888' : '#8c8c92';
    setTimeout(() => {
        if (statusBar.textContent === msg) statusBar.style.color = '#8c8c92';
    }, 3000);
}

// Генерация кода комнаты (8 символов, буквы+цифры)
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// Копирование в буфер
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => showToast(`Код "${text}" скопирован`));
}

// ======================== РАБОТА С GITHUB API ========================
async function fetchDB() {
    try {
        const res = await fetch(API_BASE, {
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (res.status === 404) {
            return { data: { rooms: {} }, sha: null };
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const content = atob(json.content);
        const data = JSON.parse(content);
        return { data, sha: json.sha };
    } catch (err) {
        console.error('fetchDB error', err);
        throw new Error('Не удалось загрузить базу данных');
    }
}

async function putDB(newData, expectedSha) {
    const contentBase64 = btoa(JSON.stringify(newData, null, 2));
    const body = {
        message: `Update chat: ${new Date().toISOString()}`,
        content: contentBase64,
        sha: expectedSha || undefined
    };
    const res = await fetch(API_BASE, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`PUT failed: ${res.status} ${errText}`);
    }
    const json = await res.json();
    return json.content.sha;
}

// Обновление данных комнаты с автоматическим разрешением конфликтов (один повтор)
async function saveRoomData(roomCode, newRoomData, retry = true) {
    try {
        const { data, sha } = await fetchDB();
        currentSha = sha;
        if (!data.rooms[roomCode]) data.rooms[roomCode] = { salt: null, messages: [] };
        data.rooms[roomCode] = newRoomData;
        const newSha = await putDB(data, currentSha);
        currentSha = newSha;
        return true;
    } catch (err) {
        console.warn('saveRoomData conflict/error:', err);
        if (retry) {
            setStatus('Конфликт данных, повторная попытка...');
            await new Promise(r => setTimeout(r, 500));
            return saveRoomData(roomCode, newRoomData, false);
        } else {
            setStatus('Ошибка сохранения. Попробуйте позже.', true);
            return false;
        }
    }
}

// ======================== КРИПТОГРАФИЯ (Web Crypto) ========================
async function deriveKeyFromRoomCode(roomCode, saltBytes) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(roomCode), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function encryptMessage(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return {
        encryptedBase64: arrayBufferToBase64(encrypted),
        ivBase64: arrayBufferToBase64(iv)
    };
}

async function decryptMessage(encryptedBase64, ivBase64, key) {
    const encrypted = base64ToArrayBuffer(encryptedBase64);
    const iv = base64ToArrayBuffer(ivBase64);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
}

// Генерация соли (16 байт)
function generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
}

// ======================== ЗАГРУЗКА И ОТОБРАЖЕНИЕ СООБЩЕНИЙ ========================
async function loadRoomAndDecrypt(roomCode) {
    try {
        const { data, sha } = await fetchDB();
        currentSha = sha;
        const room = data.rooms[roomCode];
        if (!room || !room.salt) {
            // Новая комната: соли нет, сообщений нет
            currentSalt = null;
            currentKey = null;
            messagesList = [];
            renderMessages();
            return;
        }
        // Восстанавливаем соль
        const saltBytes = base64ToArrayBuffer(room.salt);
        currentSalt = new Uint8Array(saltBytes);
        currentKey = await deriveKeyFromRoomCode(roomCode, currentSalt);
        
        // Расшифровываем сообщения
        const decryptedMessages = [];
        for (const msg of room.messages) {
            try {
                const text = await decryptMessage(msg.encryptedText, msg.iv, currentKey);
                decryptedMessages.push({
                    id: msg.id,
                    text: text,
                    timestamp: msg.timestamp,
                    edited: msg.edited || false,
                    editedAt: msg.editedAt || null,
                    senderId: msg.senderId
                });
            } catch (e) {
                console.warn('Ошибка расшифровки', e);
                decryptedMessages.push({ id: msg.id, text: '⚠️ [ошибка расшифровки]', timestamp: msg.timestamp, edited: false, senderId: msg.senderId });
            }
        }
        messagesList = decryptedMessages.sort((a,b) => a.timestamp - b.timestamp);
        renderMessages();
    } catch (err) {
        console.error(err);
        setStatus('Ошибка загрузки комнаты', true);
    }
}

// Отрисовка сообщений
function renderMessages() {
    if (!messagesContainer) return;
    if (messagesList.length === 0) {
        messagesContainer.innerHTML = '<div class="empty-chat-placeholder">💬 Нет сообщений. Напишите первое!</div>';
        return;
    }
    messagesContainer.innerHTML = '';
    for (const msg of messagesList) {
        const isOwn = (msg.senderId === senderId);
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isOwn ? 'own' : 'other'}`;
        if (!isOwn) {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'avatar';
            avatarDiv.textContent = '👤';
            msgDiv.appendChild(avatarDiv);
        }
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'bubble';
        const textSpan = document.createElement('div');
        textSpan.textContent = msg.text;
        bubbleDiv.appendChild(textSpan);
        const timeSpan = document.createElement('div');
        timeSpan.className = 'message-time';
        const date = new Date(msg.timestamp);
        timeSpan.textContent = date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        if (msg.edited) {
            const editedSpan = document.createElement('span');
            editedSpan.className = 'message-edited';
            editedSpan.textContent = '(изменено)';
            timeSpan.appendChild(editedSpan);
        }
        bubbleDiv.appendChild(timeSpan);
        msgDiv.appendChild(bubbleDiv);
        
        // Добавляем контекстное меню (правый клик) для своих сообщений
        if (isOwn) {
            msgDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                startEditingMessage(msg.id);
            });
            // Для мобильных: долгое нажатие
            let touchTimer;
            msgDiv.addEventListener('touchstart', () => {
                touchTimer = setTimeout(() => startEditingMessage(msg.id), 500);
            });
            msgDiv.addEventListener('touchend', () => clearTimeout(touchTimer));
            msgDiv.addEventListener('touchmove', () => clearTimeout(touchTimer));
        }
        messagesContainer.appendChild(msgDiv);
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Редактирование: подставить текст в поле ввода
function startEditingMessage(msgId) {
    const msg = messagesList.find(m => m.id === msgId);
    if (!msg || msg.senderId !== senderId) return;
    isEditing = true;
    editingMsgId = msgId;
    messageInput.value = msg.text;
    messageInput.focus();
    sendBtn.textContent = '✎';
    setStatus('Редактирование сообщения...');
}

// Отправка нового или редактирование
async function sendOrEditMessage() {
    let text = messageInput.value.trim();
    if (!text) return;
    if (!currentRoom) return;
    
    // Убедимся, что у нас есть соль и ключ (для новой комнаты)
    if (!currentKey || !currentSalt) {
        // Генерируем соль для новой комнаты (первое сообщение)
        const newSalt = generateSalt();
        currentSalt = newSalt;
        currentKey = await deriveKeyFromRoomCode(currentRoom, currentSalt);
    }
    
    const encrypted = await encryptMessage(text, currentKey);
    const newMsg = {
        id: isEditing && editingMsgId ? editingMsgId : crypto.randomUUID(),
        encryptedText: encrypted.encryptedBase64,
        iv: encrypted.ivBase64,
        timestamp: Date.now(),
        edited: isEditing ? true : false,
        editedAt: isEditing ? Date.now() : null,
        senderId: senderId
    };
    
    // Оптимистичное обновление UI
    if (isEditing && editingMsgId) {
        const index = messagesList.findIndex(m => m.id === editingMsgId);
        if (index !== -1) {
            messagesList[index] = { ...messagesList[index], text: text, timestamp: Date.now(), edited: true, editedAt: Date.now() };
        }
    } else {
        messagesList.push({
            id: newMsg.id,
            text: text,
            timestamp: newMsg.timestamp,
            edited: false,
            editedAt: null,
            senderId: senderId
        });
    }
    renderMessages();
    messageInput.value = '';
    sendBtn.textContent = '➤';
    isEditing = false;
    editingMsgId = null;
    
    // Сохраняем в базу GitHub
    try {
        const { data, sha } = await fetchDB();
        currentSha = sha;
        if (!data.rooms[currentRoom]) {
            data.rooms[currentRoom] = { salt: arrayBufferToBase64(currentSalt), messages: [] };
        }
        const roomData = data.rooms[currentRoom];
        // Обновляем массив зашифрованных сообщений
        if (isEditing && editingMsgId) {
            const idx = roomData.messages.findIndex(m => m.id === editingMsgId);
            if (idx !== -1) roomData.messages[idx] = newMsg;
        } else {
            roomData.messages.push(newMsg);
        }
        // Убедимся, что соль правильная
        roomData.salt = arrayBufferToBase64(currentSalt);
        await putDB(data, currentSha);
        setStatus('Сохранено');
    } catch (err) {
        setStatus('Ошибка сохранения, но сообщение осталось локально', true);
        console.error(err);
        // Откат UI не делаем, но при следующем poll данные перезатрутся.
    }
}

// ======================== POLLING & ENTER ROOM ========================
async function pollChanges() {
    if (!currentRoom) return;
    try {
        const { data, sha } = await fetchDB();
        if (sha !== currentSha) {
            currentSha = sha;
            const room = data.rooms[currentRoom];
            if (room && room.salt) {
                // Обновляем ключ и сообщения если соль та же (или могла поменяться только при создании)
                const newSaltBytes = base64ToArrayBuffer(room.salt);
                if (!currentSalt || JSON.stringify(currentSalt) !== JSON.stringify(new Uint8Array(newSaltBytes))) {
                    currentSalt = new Uint8Array(newSaltBytes);
                    currentKey = await deriveKeyFromRoomCode(currentRoom, currentSalt);
                }
                // Расшифровываем заново
                const newMessages = [];
                for (const msg of room.messages) {
                    try {
                        const text = await decryptMessage(msg.encryptedText, msg.iv, currentKey);
                        newMessages.push({ id: msg.id, text, timestamp: msg.timestamp, edited: msg.edited, editedAt: msg.editedAt, senderId: msg.senderId });
                    } catch(e) { newMessages.push({ id: msg.id, text: '⚠️ ошибка', timestamp: msg.timestamp, edited: false, senderId: msg.senderId }); }
                }
                messagesList = newMessages.sort((a,b)=>a.timestamp-b.timestamp);
                renderMessages();
            } else if (room && !room.salt) {
                // Пустая комната без сообщений
                messagesList = [];
                renderMessages();
            }
        }
    } catch (err) {
        console.warn('poll error', err);
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(pollChanges, 4000);
}

function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
}

async function enterRoom(roomCode, isNew = false) {
    currentRoom = roomCode;
    localStorage.setItem('lastRoom', roomCode);
    roomCodeDisplay.textContent = roomCode;
    startScreen.classList.remove('active');
    chatScreen.classList.add('active');
    messageInput.value = '';
    sendBtn.textContent = '➤';
    isEditing = false;
    editingMsgId = null;
    
    setStatus('Загрузка комнаты...');
    await loadRoomAndDecrypt(roomCode);
    startPolling();
}

function exitToStart() {
    stopPolling();
    currentRoom = null;
    currentKey = null;
    currentSalt = null;
    messagesList = [];
    startScreen.classList.add('active');
    chatScreen.classList.remove('active');
    roomCodeInput.value = '';
    setStatus('');
}

// Создание новой комнаты
async function createNewRoom() {
    let newCode = generateRoomCode();
    // Проверка уникальности (простая)
    const { data } = await fetchDB();
    while (data.rooms[newCode]) {
        newCode = generateRoomCode();
    }
    copyToClipboard(newCode);
    await enterRoom(newCode, true);
    // При первом входе соль ещё не создана, она появится при первом сообщении
    showToast(`Комната ${newCode} создана! Код скопирован.`);
}

// Обработчики
joinBtn.onclick = async () => {
    let code = roomCodeInput.value.trim().toUpperCase();
    if (!code) { startError.textContent = 'Введите код комнаты'; startError.classList.remove('hidden'); return; }
    startError.classList.add('hidden');
    try {
        const { data } = await fetchDB();
        if (!data.rooms[code]) {
            // комната не существует, но войти можно (пустая)
            await enterRoom(code);
        } else {
            await enterRoom(code);
        }
    } catch(e) { startError.textContent = 'Ошибка входа'; startError.classList.remove('hidden'); }
};

createBtn.onclick = createNewRoom;
exitBtn.onclick = exitToStart;
copyCodeBtn.onclick = () => copyToClipboard(currentRoom);
sendBtn.onclick = sendOrEditMessage;
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendOrEditMessage();
    }
});

// Восстановление последней комнаты при загрузке
window.onload = async () => {
    if (lastStoredRoom) {
        roomCodeInput.value = lastStoredRoom;
        joinBtn.click();
    }
};