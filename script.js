(function() {
    let myPeer = null;
    let conn = null;
    let messages = [];
    let chatActive = false;

    // DOM
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const remoteIdInput = document.getElementById('remote-id-input');
    const connectBtn = document.getElementById('connect-btn');
    const myCodeSpan = document.getElementById('my-code');
    const statusText = document.getElementById('status-text');
    const connectionPanel = document.getElementById('connection-panel');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const newChatBtn = document.getElementById('new-chat-btn');

    // Блокировка / разблокировка ввода
    function setInputEnabled(enabled) {
        messageInput.contentEditable = enabled;
        sendBtn.disabled = !enabled;
        if (!enabled) messageInput.innerText = '';
    }

    // Очистка и создание нового Peer
    function createNewPeer() {
        if (myPeer) {
            myPeer.destroy();
        }
        if (conn) {
            conn.close();
            conn = null;
        }
        chatActive = false;
        messages = [];
        renderMessages();
        connectionPanel.style.display = 'block';
        statusText.textContent = 'Генерация нового кода...';
        setInputEnabled(false);
        myCodeSpan.textContent = '—';
        initPeer();
    }

    function initPeer() {
        myPeer = new Peer();

        myPeer.on('open', (id) => {
            myCodeSpan.textContent = id;
            statusText.textContent = 'Ожидайте подключения собеседника';
        });

        myPeer.on('connection', (incomingConn) => {
            if (conn) {
                incomingConn.close();
                return;
            }
            conn = incomingConn;
            setupConnection();
        });

        myPeer.on('error', (err) => {
            statusText.textContent = 'Ошибка: ' + err.message;
        });
    }

    function setupConnection() {
        conn.on('open', () => {
            chatActive = true;
            connectionPanel.style.display = 'none';
            setInputEnabled(true);
            addSystemMessage('Собеседник подключился');
            loadHistory();
        });

        conn.on('data', (data) => {
            if (data.type === 'message') {
                const msg = {
                    id: data.id,
                    text: data.text,
                    sender: 'peer',
                    timestamp: data.timestamp
                };
                addMessage(msg);
            }
        });

        conn.on('close', () => {
            addSystemMessage('Собеседник отключился');
            resetChat();
        });

        conn.on('error', () => {
            addSystemMessage('Ошибка соединения');
            resetChat();
        });
    }

    function resetChat() {
        if (conn) conn.close();
        conn = null;
        chatActive = false;
        messages = [];
        renderMessages();
        connectionPanel.style.display = 'block';
        statusText.textContent = 'Соединение разорвано. Можете начать новый чат.';
        setInputEnabled(false);
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = text;
        messagesContainer.appendChild(div);
        scrollToBottom();
    }

    function addMessage(msg) {
        messages.push(msg);
        renderMessages();
        saveHistory();
    }

    function renderMessages() {
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper ${msg.sender}`;
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.textContent = msg.text;
            wrapper.appendChild(bubble);
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            const time = new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            timeDiv.textContent = time;
            wrapper.appendChild(timeDiv);
            messagesContainer.appendChild(wrapper);
        });
        scrollToBottom();
    }

    function sendMessage() {
        const text = messageInput.innerText.trim();
        if (!text || !conn || !chatActive) return;
        const msg = {
            id: Date.now() + Math.random().toString(36),
            text: text,
            sender: 'own',
            timestamp: Date.now()
        };
        conn.send({ type: 'message', ...msg });
        addMessage(msg);
        messageInput.innerText = '';
    }

    function saveHistory() {
        if (!conn) return;
        localStorage.setItem('chat_history_' + conn.peer, JSON.stringify(messages));
    }

    function loadHistory() {
        if (!conn) return;
        const saved = localStorage.getItem('chat_history_' + conn.peer);
        if (saved) {
            try {
                messages = JSON.parse(saved);
                renderMessages();
            } catch(e) {}
        }
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Обработчики
    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) return;
        if (conn) {
            alert('Вы уже подключены. Начните новый чат, чтобы сменить собеседника.');
            return;
        }
        conn = myPeer.connect(remoteId, { reliable: true });
        setupConnection();
    });

    copyCodeBtn.addEventListener('click', () => {
        const code = myCodeSpan.textContent;
        if (!code || code === '—') return;
        navigator.clipboard.writeText(code).then(() => {
            copyCodeBtn.textContent = '✅';
            setTimeout(() => { copyCodeBtn.textContent = '📋'; }, 1500);
        });
    });

    newChatBtn.addEventListener('click', () => {
        if (confirm('Начать новый чат? Текущее соединение будет разорвано.')) {
            createNewPeer();
        }
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Старт
    setInputEnabled(false);
    initPeer();
})();