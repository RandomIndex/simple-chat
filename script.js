// Simple Chat – E2E шифрованный чат 1-на-1 через WebRTC (PeerJS)
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 12; // длина генерируемого кода
const PBKDF2_ITERATIONS = 200000;
const SALT = new TextEncoder().encode('SimpleChatSalt_v1');

// DOM элементы
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const joinCodeInput = document.getElementById('join-code');
const loginError = document.getElementById('login-error');
const btnBack = document.getElementById('btn-back');
const btnCopyCode = document.getElementById('btn-copy-code');
const currentCodeSpan = document.getElementById('current-code');
const messagesList = document.getElementById('messages-list');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');
const editBanner = document.getElementById('edit-banner');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

// Состояние
let peer = null;          // PeerJS объект
let conn = null;          // DataConnection
let cryptoKey = null;     // CryptoKey для AES-GCM
let roomCode = '';        // код комнаты (он же peerId)
let myPeerId = '';
let isConnected = false;
let editingMsgId = null;  // id редактируемого сообщения
let messageIdCounter = 0; // локальный счётчик id

// ----- Генерация кода -----
function generateCode() {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
    }
    return code;
}

// ----- Генерация id сообщения -----
function generateMsgId() {
    return `${myPeerId}-${Date.now()}-${messageIdCounter++}`;
}

// ----- Производные ключи из кода -----
async function deriveKey(code) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(code),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: SALT,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// ----- Шифрование / дешифрование -----
async function encryptMessage(plainText) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        enc.encode(plainText)
    );
    return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

async function decryptMessage(ivArray, ciphertextArray) {
    const iv = new Uint8Array(ivArray);
    const ciphertext = new Uint8Array(ciphertextArray);
    const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        ciphertext
    );
    return new TextDecoder().decode(plainBuf);
}

// ----- Отображение сообщения -----
function appendMessage({ id, text, own, edited = false }) {
    const div = document.createElement('div');
    div.className = `message ${own ? 'own' : ''}`;
    div.dataset.msgId = id;
    div.innerHTML = `
        <div class="message-bubble">
            <div class="text">${escapeHtml(text)}</div>
            <div class="meta">
                ${own ? '<button class="edit-btn" data-id="' + id + '">✎</button>' : ''}
                ${edited ? '<span class="edited-mark">изменено</span>' : ''}
            </div>
        </div>
    `;
    messagesList.appendChild(div);
    scrollToBottom();

    // Навешиваем обработчик редактирования
    if (own) {
        div.querySelector('.edit-btn')?.addEventListener('click', (e) => {
            const msgId = e.target.dataset.id;
            startEdit(msgId);
        });
    }
    return div;
}

function updateMessageText(id, newText) {
    const el = document.querySelector(`.message[data-msg-id="${id}"]`);
    if (!el) return;
    const textEl = el.querySelector('.text');
    if (textEl) textEl.textContent = newText;
    const meta = el.querySelector('.meta');
    if (meta && !meta.querySelector('.edited-mark')) {
        const mark = document.createElement('span');
        mark.className = 'edited-mark';
        mark.textContent = 'изменено';
        meta.appendChild(mark);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// ----- Редактирование -----
function startEdit(msgId) {
    // Найти текст
    const el = document.querySelector(`.message[data-msg-id="${msgId}"] .text`);
    if (!el) return;
    editingMsgId = msgId;
    messageInput.value = el.textContent;
    messageInput.focus();
    editBanner.classList.remove('hidden');
    btnSend.textContent = '✎';
}

function cancelEdit() {
    editingMsgId = null;
    messageInput.value = '';
    editBanner.classList.add('hidden');
    btnSend.textContent = '➤';
}

// ----- Отправка сообщения / редактирования -----
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !conn || !cryptoKey) return;

    if (editingMsgId) {
        // Отправляем пакет редактирования
        const payload = { type: 'edit', id: editingMsgId, text };
        const encrypted = await encryptMessage(JSON.stringify(payload));
        conn.send(encrypted);
        updateMessageText(editingMsgId, text);
        cancelEdit();
    } else {
        const id = generateMsgId();
        const payload = { type: 'message', id, text };
        const encrypted = await encryptMessage(JSON.stringify(payload));
        conn.send(encrypted);
        appendMessage({ id, text, own: true });
    }
    messageInput.value = '';
}

// ----- Обработка входящих данных -----
async function handleData(data) {
    try {
        const plainText = await decryptMessage(data.iv, data.ciphertext);
        const obj = JSON.parse(plainText);
        if (obj.type === 'message') {
            appendMessage({ id: obj.id, text: obj.text, own: false });
        } else if (obj.type === 'edit') {
            updateMessageText(obj.id, obj.text);
        }
    } catch (err) {
        console.error('Ошибка расшифровки:', err);
    }
}

// ----- PeerJS подключение -----
function initPeer(id) {
    peer = new Peer(id, {
        // debug: 2, // можно включить для отладки
    });
    myPeerId = id;

    peer.on('open', (pid) => {
        console.log('Peer открыт:', pid);
        if (roomCode && !isConnected) {
            // Если мы создатель – ждём входящего соединения
            // Если присоединились – уже вызвали connectToRoom, тут ничего
        }
    });

    peer.on('connection', (incomingConn) => {
        if (conn && conn.open) {
            incomingConn.close();
            return;
        }
        setupConnection(incomingConn);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (loginScreen.classList.contains('active')) {
            loginError.textContent = 'Ошибка соединения. Попробуйте другой код.';
        }
    });

    peer.on('disconnected', () => {
        // Пытаемся переподключиться
        peer.reconnect();
    });
}

function connectToRoom(remoteId) {
    if (!peer) return;
    const newConn = peer.connect(remoteId, { reliable: true });
    setupConnection(newConn);
}

function setupConnection(connection) {
    conn = connection;
    conn.on('open', () => {
        isConnected = true;
        console.log('Соединение установлено');
        // Очищаем сообщения
        messagesList.innerHTML = '';
        // Если мы присоединились (remote peer), показываем чат
        showChatScreen();
    });

    conn.on('data', (data) => {
        handleData(data);
    });

    conn.on('close', () => {
        isConnected = false;
        conn = null;
        // Возвращаем на экран входа?
        appendSystemMessage('Собеседник отключился.');
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        appendSystemMessage('Ошибка соединения.');
    });
}

function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    div.style.color = '#72767d';
    div.style.fontSize = '12px';
    div.style.margin = '8px 0';
    div.textContent = text;
    messagesList.appendChild(div);
    scrollToBottom();
}

function showChatScreen() {
    loginScreen.classList.remove('active');
    chatScreen.classList.add('active');
    currentCodeSpan.textContent = roomCode;
    messageInput.focus();
}

function showLoginScreen() {
    chatScreen.classList.remove('active');
    loginScreen.classList.add('active');
    // Закрыть соединения
    if (conn) {
        conn.close();
        conn = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    isConnected = false;
    roomCode = '';
    cryptoKey = null;
    joinCodeInput.value = '';
    loginError.textContent = '';
}

// ----- Обработчики UI -----
btnCreate.addEventListener('click', async () => {
    loginError.textContent = '';
    const code = generateCode();
    roomCode = code;
    cryptoKey = await deriveKey(code);
    initPeer(code); // peerId = code
    showChatScreen();
});

btnJoin.addEventListener('click', async () => {
    loginError.textContent = '';
    const code = joinCodeInput.value.trim();
    if (!code) {
        loginError.textContent = 'Введите код комнаты';
        return;
    }
    roomCode = code;
    cryptoKey = await deriveKey(code);
    // Генерируем себе случайный peerId, чтобы не совпадать с кодом (код - id создателя)
    const randomId = generateCode() + '-guest';
    initPeer(randomId);
    // Чуть подождём открытия peer и подключимся
    setTimeout(() => {
        if (peer && peer.id) {
            connectToRoom(code);
        } else {
            loginError.textContent = 'Не удалось инициализировать peer';
        }
    }, 600);
});

btnBack.addEventListener('click', showLoginScreen);

btnCopyCode.addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).then(() => {
        alert('Код скопирован!');
    }).catch(() => {
        prompt('Код комнаты (скопируйте вручную):', roomCode);
    });
});

btnSend.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

btnCancelEdit.addEventListener('click', cancelEdit);

// Автоувеличение высоты textarea
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});