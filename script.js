(function() {
    // Состояние
    let myPeer = null;
    let conn = null;
    let messages = [];
    const localProfile = {
        name: 'Вы',
        status: '',
        avatar: ''
    };
    let remoteProfile = { name: 'Собеседник', avatar: '' };
    let currentPeerId = null;
    let chatActive = false; // true когда соединение установлено

    // Загрузка локального профиля
    function loadProfile() {
        const saved = localStorage.getItem('simplechat_profile');
        if (saved) {
            try {
                const p = JSON.parse(saved);
                localProfile.name = p.name || 'Вы';
                localProfile.status = p.status || '';
                localProfile.avatar = p.avatar || '';
            } catch(e) {}
        }
    }
    loadProfile();

    // DOM элементы
    const joinScreen = document.getElementById('join-screen');
    const chatScreen = document.getElementById('chat-screen');
    const createBtn = document.getElementById('create-btn');
    const connectBtn = document.getElementById('connect-btn');
    const remoteIdInput = document.getElementById('remote-id-input');
    const statusMsg = document.getElementById('status-msg');
    const backBtn = document.getElementById('back-btn');
    const messagesContainer = document.getElementById('messages-container');
    const waitingMsg = document.getElementById('waiting-msg');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const fileInput = document.getElementById('file-input');
    const profileBtnJoin = document.getElementById('profile-btn-join');
    const profileBtnChat = document.getElementById('profile-btn-chat');
    const profileModal = document.getElementById('profile-modal');
    const closeModal = document.querySelector('.close');
    const profileAvatarPreview = document.getElementById('profile-avatar-preview');
    const avatarInput = document.getElementById('avatar-input');
    const profileName = document.getElementById('profile-name');
    const profileStatus = document.getElementById('profile-status');
    const saveProfileBtn = document.getElementById('save-profile-btn');
    const partnerAvatar = document.getElementById('partner-avatar');
    const partnerName = document.getElementById('partner-name');
    const myCodeInChat = document.getElementById('my-code-in-chat');
    const myCodeText = document.getElementById('my-code-text');
    const copyCodeInChatBtn = document.getElementById('copy-code-in-chat-btn');

    // Отключение/включение элементов ввода
    function setInputEnabled(enabled) {
        messageInput.contentEditable = enabled;
        sendBtn.disabled = !enabled;
        fileInput.disabled = !enabled;
        if (!enabled) {
            messageInput.innerText = '';
        }
    }

    // Инициализация Peer с индикацией статуса
    function initPeer(callback) {
        if (myPeer && myPeer.id) {
            if (callback) callback(myPeer.id);
            return;
        }
        // Если Peer уже создаётся, подождём
        if (myPeer && !myPeer.id) {
            myPeer.on('open', (id) => {
                if (callback) callback(id);
            });
            return;
        }

        statusMsg.classList.remove('hidden');
        statusMsg.textContent = 'Подключение к сети...';
        myPeer = new Peer();

        myPeer.on('open', (id) => {
            currentPeerId = id;
            statusMsg.textContent = 'Сеть готова';
            setTimeout(() => statusMsg.classList.add('hidden'), 2000);
            if (callback) callback(id);
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
            statusMsg.classList.remove('hidden');
            statusMsg.textContent = 'Ошибка: ' + err.message;
            console.error('Peer error:', err);
        });
    }

    // Настройка соединения
    function setupConnection() {
        conn.on('open', () => {
            console.log('Соединение установлено');
            chatActive = true;
            waitingMsg.classList.add('hidden');
            myCodeInChat.classList.add('hidden');
            setInputEnabled(true);
            loadMessageHistory(conn.peer);
            sendProfile();
            partnerName.textContent = 'Подключение...';
        });
        conn.on('data', handleData);
        conn.on('close', () => {
            alert('Собеседник отключился');
            resetChat();
        });
        conn.on('error', (err) => {
            alert('Ошибка соединения: ' + err);
            resetChat();
        });
    }

    function resetChat() {
        if (conn) conn.close();
        conn = null;
        chatActive = false;
        messages = [];
        renderMessages();
        chatScreen.classList.add('hidden');
        joinScreen.classList.remove('hidden');
        myCodeInChat.classList.add('hidden');
        remoteProfile = { name: 'Собеседник', avatar: '' };
        partnerAvatar.src = '';
        partnerName.textContent = 'Собеседник';
        setInputEnabled(false);
    }

    function sendProfile() {
        if (!conn || !chatActive) return;
        conn.send({
            type: 'profile',
            profile: localProfile
        });
    }

    // Обработка входящих данных
    function handleData(data) {
        if (data.type === 'profile') {
            remoteProfile = data.profile;
            partnerName.textContent = remoteProfile.name || 'Собеседник';
            partnerAvatar.src = remoteProfile.avatar || '';
        }
        else if (data.type === 'message') {
            const msg = {
                id: data.id,
                text: data.text,
                sender: 'peer',
                timestamp: data.timestamp
            };
            addMessage(msg);
        }
        else if (data.type === 'image') {
            const msg = {
                id: data.id,
                image: data.image,
                sender: 'peer',
                timestamp: data.timestamp
            };
            addMessage(msg);
        }
        else if (data.type === 'edit') {
            const msg = messages.find(m => m.id === data.id);
            if (msg) {
                msg.text = data.text;
                msg.edited = true;
                renderMessages();
                saveMessageHistory();
            }
        }
    }

    function addMessage(msg) {
        messages.push(msg);
        renderMessages();
        saveMessageHistory();
    }

    function renderMessages() {
        // Очищаем только сообщения, сохраняя системные блоки
        const oldSystem = document.querySelector('.system-message');
        messagesContainer.innerHTML = '';
        if (oldSystem) messagesContainer.appendChild(oldSystem);
        messages.forEach(msg => {
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper ${msg.sender}`;
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            if (msg.image) {
                const img = document.createElement('img');
                img.src = msg.image;
                bubble.appendChild(img);
            } else {
                bubble.textContent = msg.text;
            }
            wrapper.appendChild(bubble);
            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            timeDiv.textContent = time;
            wrapper.appendChild(timeDiv);
            if (msg.sender === 'own') {
                const editButton = document.createElement('button');
                editButton.className = 'edit-btn';
                editButton.textContent = '✎';
                editButton.onclick = () => startEdit(msg.id);
                wrapper.appendChild(editButton);
            }
            messagesContainer.appendChild(wrapper);
        });
        scrollToBottom();
    }

    function startEdit(msgId) {
        const msg = messages.find(m => m.id === msgId);
        if (!msg || msg.image) return;
        const wrapper = Array.from(messagesContainer.children).find(el =>
            el.querySelector('.edit-btn')?.onclick?.toString().includes(msgId)
        );
        if (!wrapper) return;
        const bubble = wrapper.querySelector('.message-bubble');
        bubble.innerHTML = '';
        const input = document.createElement('input');
        input.value = msg.text;
        input.style.width = '100%';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '✓';
        saveBtn.className = 'btn small';
        saveBtn.onclick = () => finishEdit(msgId, input.value);
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✕';
        cancelBtn.className = 'btn small';
        cancelBtn.onclick = () => renderMessages();
        const editArea = document.createElement('div');
        editArea.className = 'edit-area';
        editArea.appendChild(input);
        editArea.appendChild(saveBtn);
        editArea.appendChild(cancelBtn);
        bubble.appendChild(editArea);
    }

    function finishEdit(msgId, newText) {
        const msg = messages.find(m => m.id === msgId);
        if (!msg) return;
        msg.text = newText;
        msg.edited = true;
        if (conn && chatActive) {
            conn.send({
                type: 'edit',
                id: msgId,
                text: newText
            });
        }
        renderMessages();
        saveMessageHistory();
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
        conn.send({
            type: 'message',
            id: msg.id,
            text: msg.text,
            timestamp: msg.timestamp
        });
        addMessage(msg);
        messageInput.innerText = '';
    }

    function sendImage(file) {
        if (!conn || !chatActive) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const msg = {
                id: Date.now() + Math.random().toString(36),
                image: e.target.result,
                sender: 'own',
                timestamp: Date.now()
            };
            conn.send({
                type: 'image',
                id: msg.id,
                image: msg.image,
                timestamp: msg.timestamp
            });
            addMessage(msg);
        };
        reader.readAsDataURL(file);
    }

    function saveMessageHistory() {
        if (!conn) return;
        localStorage.setItem('chat_history_' + conn.peer, JSON.stringify(messages));
    }

    function loadMessageHistory(peerId) {
        const saved = localStorage.getItem('chat_history_' + peerId);
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

    // Функция открытия чата после генерации кода
    function openChatWithCode(code) {
        joinScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        myCodeInChat.classList.remove('hidden');
        myCodeText.textContent = code;
        waitingMsg.textContent = 'Ожидаем подключения собеседника...';
        waitingMsg.classList.remove('hidden');
        setInputEnabled(false);
    }

    // UI действия
    createBtn.addEventListener('click', () => {
        initPeer((id) => {
            openChatWithCode(id);
        });
    });

    connectBtn.addEventListener('click', () => {
        const remoteId = remoteIdInput.value.trim();
        if (!remoteId) return;
        initPeer(() => {
            if (conn) {
                alert('Уже подключены');
                return;
            }
            conn = myPeer.connect(remoteId, { reliable: true });
            // Открываем чат сразу, но без активации
            joinScreen.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            myCodeInChat.classList.add('hidden');
            waitingMsg.textContent = 'Подключаемся...';
            waitingMsg.classList.remove('hidden');
            setInputEnabled(false);
            setupConnection();
        });
    });

    copyCodeInChatBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentPeerId).then(() => {
            copyCodeInChatBtn.textContent = 'Скопировано!';
            setTimeout(() => copyCodeInChatBtn.textContent = 'Копировать', 2000);
        });
    });

    backBtn.addEventListener('click', () => {
        resetChat();
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            sendImage(e.target.files[0]);
            fileInput.value = '';
        }
    });

    // Профиль
    function openProfileModal() {
        profileName.value = localProfile.name;
        profileStatus.value = localProfile.status;
        profileAvatarPreview.src = localProfile.avatar || '';
        profileModal.classList.remove('hidden');
    }

    profileBtnJoin.addEventListener('click', openProfileModal);
    profileBtnChat.addEventListener('click', openProfileModal);
    closeModal.addEventListener('click', () => profileModal.classList.add('hidden'));
    window.addEventListener('click', (e) => {
        if (e.target === profileModal) profileModal.classList.add('hidden');
    });

    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            localProfile.avatar = ev.target.result;
            profileAvatarPreview.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    saveProfileBtn.addEventListener('click', () => {
        localProfile.name = profileName.value.trim() || 'Вы';
        localProfile.status = profileStatus.value.trim();
        localStorage.setItem('simplechat_profile', JSON.stringify(localProfile));
        profileModal.classList.add('hidden');
        if (conn && chatActive) sendProfile();
    });

})();