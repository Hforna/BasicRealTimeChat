import * as signalR from "@microsoft/signalr";

// DOM elements
const statusText = document.getElementById('status-text');
const usernameDisplay = document.getElementById('username-display');
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const setUsernameBtn = document.getElementById('set-username-btn');
const groupnameInput = document.getElementById('groupname-input') as HTMLInputElement;
const createGroupBtn = document.getElementById('create-group-btn');
const refreshGroupsBtn = document.getElementById('refresh-groups-btn');
const groupsList = document.getElementById('groups-list');
const currentGroupDisplay = document.getElementById('current-group');
const groupInfo = document.getElementById('group-info');
const messagesContainer = document.getElementById('messages-container') as HTMLInputElement;
const messageInput = document.getElementById('message-input') as HTMLInputElement;
const sendMessageBtn = document.getElementById('send-message-btn') as HTMLInputElement;
const leaveGroupBtn = document.getElementById('leave-group-btn') as HTMLInputElement;
const errorAlert = document.getElementById('error-alert');
const successAlert = document.getElementById('success-alert');

let connection = null;
let currentGroup = null;
let username = '';

// Initialize SignalR connection
function initConnection() {
    connection = new signalR.HubConnectionBuilder()
        .withUrl('/hub/chat')
        .configureLogging(signalR.LogLevel.Information)
        .withAutomaticReconnect()
        .build();

    // Connection event handlers
    connection.onclose(() => {
        updateConnectionStatus(false);
        showError('Connection lost. Trying to reconnect...');
    });

    connection.onreconnecting(() => {
        updateConnectionStatus(false);
        showError('Connection lost. Reconnecting...');
    });

    connection.onreconnected(() => {
        updateConnectionStatus(true);
        showSuccess('Connection restored');
        if (username) {
            setUsername(username);
        }
        if (currentGroup) {
            joinGroup(currentGroup);
        }
    });

    // Hub methods
    connection.on("ReceiveGroupMessage", (message) => {
        addMessageToChat(message);
    });

    connection.on("UserLeaved", (groupInfos) => {
        showSuccess(`A user left the group. Total users: ${groupInfos.totalUsers}`);
        updateGroupInfo(groupInfos);
    });

    connection.on("GroupCreated", (groupInfos) => {
        showSuccess(`New group created: ${groupInfos.owner}'s group`);
        getAvailableGroups();
    });

    // Start connection
    connection.start()
        .then(() => {
            updateConnectionStatus(true);
            showSuccess('Connected to server');
            getAvailableGroups(); // <-- chama aqui, seguro
        })
        .catch(err => {
            console.error(normalizeErrorException(err));
            showError('Connection failed: ' + normalizeErrorException(err));
        });

}

// Update connection status UI
function updateConnectionStatus(isConnected) {
    const statusDot = document.querySelector('.status-dot');
    if (isConnected) {
        statusText.textContent = 'Connected';
        document.querySelector('.connection-status').classList.add('connected');
    } else {
        statusText.textContent = 'Disconnected';
        document.querySelector('.connection-status').classList.remove('connected');
    }
}

// Show error message
function showError(message) {
    errorAlert.textContent = message;
    errorAlert.style.display = 'block';
    setTimeout(() => {
        errorAlert.style.display = 'none';
    }, 5000);
}

// Show success message
function showSuccess(message) {
    successAlert.textContent = message;
    successAlert.style.display = 'block';
    setTimeout(() => {
        successAlert.style.display = 'none';
    }, 3000);
}

// Set username
async function setUsername(name) {
    try {
        await connection.invoke('SetUserName', name);
        username = name;
        usernameDisplay.textContent = name;
        usernameInput.value = '';
        showSuccess(`Username set to ${name}`);
    } catch (err) {
        showError('Error setting username: ' + normalizeErrorException(err));
    }
}

// Get available groups
async function getAvailableGroups() {
    try {
        const groups = await connection.invoke('GetAvaliableGroups');
        renderGroupsList(groups);
    } catch (err) {
        showError('Error getting groups: ' + normalizeErrorException(err));
    }
}

// Create a new group
async function createGroup(name) {
    try {
        await connection.invoke('CreateGroup', name);
        groupnameInput.value = '';
        showSuccess(`Group "${name}" created successfully`);
        getAvailableGroups();
    } catch (err) {
        showError('Error creating group: ' + normalizeErrorException(err));

    }
}

// Join a group
async function joinGroup(name) {
    try {
        await connection.invoke('JoinGroup', name);
        currentGroup = name;
        currentGroupDisplay.textContent = name;

        // Enable message input and leave button
        messageInput.disabled = false;
        sendMessageBtn.disabled = false;
        leaveGroupBtn.disabled = false;

        // Get group info
        const groupInfoData = await connection.invoke('GetGroupInfos', name);
        updateGroupInfo(groupInfoData);

        // Get group messages
        const messages = await connection.invoke('GetAllGroupMessages', name);
        renderMessages(messages);

        showSuccess(`Joined group "${name}"`);
        getAvailableGroups();
    } catch (err) {
        showError('Error joining group: ' + normalizeErrorException(err));
    }
}

// Leave current group
async function leaveGroup() {
    if (!currentGroup) return;

    try {
        await connection.invoke('LeaveGroup', currentGroup);
        showSuccess(`Left group "${currentGroup}"`);

        // Reset UI
        currentGroup = null;
        currentGroupDisplay.textContent = 'None';
        groupInfo.innerHTML = '<p>Select a group to view information and messages</p>';
        messagesContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comment"></i>
                <p>Join a group to start messaging</p>
            </div>
        `;

        // Disable message input and leave button
        messageInput.disabled = true;
        sendMessageBtn.disabled = true;
        leaveGroupBtn.disabled = true;

        getAvailableGroups();
    } catch (err) {
        showError('Error leaving group: ' + normalizeErrorException(err));
    }
}

// Send a message
async function sendMessage() {
    if (!currentGroup || !messageInput.value.trim()) return;

    try {
        await connection.invoke('SendGroupMessage', messageInput.value.trim(), currentGroup);
        messageInput.value = '';
    } catch (err) {
        showError('Error sending message: ' + normalizeErrorException(err));
    }
}

// Render groups list
function renderGroupsList(groups) {
    groupsList.innerHTML = '';

    if (groups.length === 0) {
        groupsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>No groups available yet</p>
            </div>
        `;
        return;
    }

    groups.forEach(group => {
        const li = document.createElement('li');
        li.className = 'group-item';

        const groupNameSpan = document.createElement('span');
        groupNameSpan.textContent = group;
        groupNameSpan.style.fontWeight = '600';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'group-actions';

        const joinBtn = document.createElement('button');
        joinBtn.className = 'group-btn btn-success';
        joinBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Join';
        joinBtn.onclick = () => joinGroup(group);

        const infoBtn = document.createElement('button');
        infoBtn.className = 'group-btn btn-secondary';
        infoBtn.innerHTML = '<i class="fas fa-info"></i> Info';
        infoBtn.onclick = () => getGroupInfo(group);

        actionsDiv.appendChild(joinBtn);
        actionsDiv.appendChild(infoBtn);

        // If user is in this group, add leave button
        if (currentGroup === group) {
            const leaveBtn = document.createElement('button');
            leaveBtn.className = 'group-btn btn-danger';
            leaveBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Leave';
            leaveBtn.onclick = leaveGroup;
            actionsDiv.appendChild(leaveBtn);
        }

        li.appendChild(groupNameSpan);
        li.appendChild(actionsDiv);

        groupsList.appendChild(li);
    });
}

// Get group info
async function getGroupInfo(groupName) {
    try {
        const info = await connection.invoke('GetGroupInfos', groupName);
        showGroupInfo(info, groupName);
    } catch (err) {
        showError('Error getting group info: ' + normalizeErrorException(err));
    }
}

// Display group info
function showGroupInfo(info, groupName) {
    groupInfo.innerHTML = `
        <h3>Group: ${groupName}</h3>
        <div class="info-item">
            <span class="info-label">Owner:</span>
            <span>${info.owner}</span>
        </div>
        <div class="info-item">
            <span class="info-label">Total Users:</span>
            <span>${info.totalUsers}</span>
        </div>
        <div class="info-item">
            <span class="info-label">Online:</span>
            <span>${info.online}</span>
        </div>
    `;
}

// Update group info
function updateGroupInfo(info) {
    if (!currentGroup) return;

    const groupName = currentGroup;
    groupInfo.innerHTML = `
        <h3>Group: ${groupName}</h3>
        <div class="info-item">
            <span class="info-label">Owner:</span>
            <span>${info.owner}</span>
        </div>
        <div class="info-item">
            <span class="info-label">Total Users:</span>
            <span>${info.totalUsers}</span>
        </div>
        <div class="info-item">
            <span class="info-label">Online:</span>
            <span>${info.online}</span>
        </div>
    `;
}

// Render messages
function renderMessages(messages) {
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comment-slash"></i>
                <p>No messages yet. Be the first to send one!</p>
            </div>
        `;
        return;
    }

    messages.forEach(message => {
        addMessageToChat(message);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add a message to the chat
function addMessageToChat(message) {
    // Remove empty state if it exists
    if (messagesContainer.querySelector('.empty-state')) {
        messagesContainer.innerHTML = '';
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.userName === username ? 'my-message' : ''}`;

    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';

    const senderSpan = document.createElement('span');
    senderSpan.className = 'message-sender';
    senderSpan.textContent = message.userName;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = new Date(message.sentAt).toLocaleTimeString();

    messageHeader.appendChild(senderSpan);
    messageHeader.appendChild(timeSpan);

    const messageText = document.createElement('div');
    messageText.className = 'message-text';
    messageText.textContent = message.text;

    messageEl.appendChild(messageHeader);
    messageEl.appendChild(messageText);

    messagesContainer.appendChild(messageEl);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Initialize connection
    initConnection();

    // Set username
    setUsernameBtn.addEventListener('click', () => {
        const name = usernameInput.value.trim();
        if (name) {
            setUsername(name);
        } else {
            showError('Please enter a username');
        }
    });

    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const name = usernameInput.value.trim();
            if (name) {
                setUsername(name);
            }
        }
    });

    // Create group
    createGroupBtn.addEventListener('click', () => {
        const name = groupnameInput.value.trim();
        if (name) {
            createGroup(name);
        } else {
            showError('Please enter a group name');
        }
    });

    groupnameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const name = groupnameInput.value.trim();
            if (name) {
                createGroup(name);
            }
        }
    });

    // Refresh groups
    refreshGroupsBtn.addEventListener('click', getAvailableGroups);

    // Send message
    sendMessageBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Leave group
    leaveGroupBtn.addEventListener('click', leaveGroup);
});

function normalizeErrorException(err: any): string {
    if (!err) return 'Unknown error';

    // SignalR lança um objeto Error ou HubException
    let message = '';

    if (err instanceof Error) {
        message = err.message;
    } else if (typeof err === 'string') {
        message = err;
    } else {
        message = JSON.stringify(err);
    }

    // Tenta limpar o prefixo padrão do SignalR
    const hubExceptionIndex = message.indexOf('HubException:');
    if (hubExceptionIndex >= 0) {
        return message.substring(hubExceptionIndex + 'HubException:'.length).trim();
    }

    return message;
}

