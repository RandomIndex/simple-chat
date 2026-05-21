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

    // Функция отключения/включения ввода
    function setInputEnabled(enabled) {
        messageInput.contentEditable = enabled;
        sendBtn.disabled = !enabled;
        if (!enabled) messageInput.innerText = '';
    }

    // Инициализация Peer сразу при загрузке
    function initPeer() {
        statusText.textContent = 'Подключение к сети...';
        myPeer = new Peer();

        myPeer.on('open', (id) => {
            myCodeSpan.textContent = id;
            statusText.textContent = 'Ожидание собеседника';
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
            connectionPanel.style.display = 'none'; // скрываем панель подключения
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

        conn.on('error', (err) => {
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
        statusText.textContent = 'Ожидание собеседника';
        setInputEnabled(false);
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = text;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

    // Обработчики
    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) return;
        if (conn) {
            alert('Уже подключены');
            return;
        }
        conn = myPeer.connect(remoteId, { reliable: true });
        setupConnection();
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Старт
    setInputEnabled(false); // поле ввода заблокировано до подключения
    initPeer();
})();