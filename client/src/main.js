import { io } from 'socket.io-client';
import { initEngine, onWindowResize } from './engine/engine.js';
import { initFullscreenUI } from './ui/fullscreen.js';

const socket = io(); // Connects to the host that served the page (which Vite proxies to the backend)

// Initialize Fullscreen Toggle for mobile and responsive phone displays
initFullscreenUI(onWindowResize);


// --- UI Elements ---
const lobbyOverlay = document.getElementById('lobby-container');
const mainMenu = document.getElementById('main-menu');
const createRoomForm = document.getElementById('create-room-form');
const joinPrivateForm = document.getElementById('join-private-form');
const publicRoomList = document.getElementById('public-room-list');

// Buttons
const btnPlayNow = document.getElementById('btn-play-now');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinPrivate = document.getElementById('btn-join-private');
const btnSubmitCreate = document.getElementById('btn-submit-create');
const btnCancelCreate = document.getElementById('btn-cancel-create');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const btnCancelJoin = document.getElementById('btn-cancel-join');

// Inputs
const inputVisibility = document.getElementById('room-visibility');
const passwordGroup = document.getElementById('password-group');
const botCount = document.getElementById('bot-count');
const botCountLabel = document.getElementById('bot-count-label');

// State
let currentRoomId = null;

// --- Event Listeners ---

// Reliable Tap & Click Listener Helper for Mobile and Desktop
function attachButtonListener(element, callback) {
  if (!element) return;
  let lastFired = 0;
  const trigger = (e) => {
    const now = Date.now();
    if (now - lastFired < 350) return; // Prevent double-trigger from touchend + click
    lastFired = now;
    callback(e);
  };
  element.addEventListener('click', trigger);
  element.addEventListener('touchend', (e) => {
    e.preventDefault();
    trigger(e);
  }, { passive: false });
}

// Navigation
attachButtonListener(btnCreateRoom, () => {
  mainMenu.classList.add('hidden');
  createRoomForm.classList.remove('hidden');
});

attachButtonListener(btnJoinPrivate, () => {
  mainMenu.classList.add('hidden');
  joinPrivateForm.classList.remove('hidden');
});

attachButtonListener(btnCancelCreate, () => {
  createRoomForm.classList.add('hidden');
  mainMenu.classList.remove('hidden');
});

attachButtonListener(btnCancelJoin, () => {
  joinPrivateForm.classList.add('hidden');
  mainMenu.classList.remove('hidden');
});

// Form Logic
inputVisibility.addEventListener('change', (e) => {
  if (e.target.value === 'private') {
    passwordGroup.classList.remove('hidden');
  } else {
    passwordGroup.classList.add('hidden');
  }
});

botCount.addEventListener('input', (e) => {
  botCountLabel.innerText = e.target.value;
});

// Socket.io Client Logic
// Socket Connection State Handling
socket.on('connect', () => {
  console.log('Connected to game server. Socket ID:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err.message);
});

socket.on('disconnect', (reason) => {
  console.warn('Socket disconnected:', reason);
});

socket.on('publicRooms', (rooms) => {
  publicRoomList.innerHTML = '';
  if (!rooms || rooms.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.textContent = 'No public rooms available.';
    publicRoomList.appendChild(emptyLi);
    return;
  }
  
  rooms.forEach(room => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `Room: ${room.id} (${room.playersCount} players, Map: ${room.mapSize})`;

    const btn = document.createElement('button');
    btn.className = 'btn primary join-btn';
    btn.setAttribute('data-id', room.id);
    btn.textContent = 'Join';
    attachButtonListener(btn, () => {
      joinRoom(room.id, '');
    });

    li.appendChild(span);
    li.appendChild(btn);
    publicRoomList.appendChild(li);
  });
});

// Actions
attachButtonListener(btnPlayNow, () => {
  if (!socket.connected) {
    alert('Connecting to server... Please wait a moment and try again.');
    socket.connect();
    return;
  }

  const originalText = btnPlayNow.innerText;
  btnPlayNow.innerText = 'Joining...';
  btnPlayNow.disabled = true;

  const timeout = setTimeout(() => {
    btnPlayNow.innerText = originalText;
    btnPlayNow.disabled = false;
    alert('Server took too long to respond. Please try again.');
  }, 6000);

  socket.emit('joinPublic', {}, (response) => {
    clearTimeout(timeout);
    btnPlayNow.innerText = originalText;
    btnPlayNow.disabled = false;

    if (response && response.success) {
      startGame(response.roomId, response.mapSize, response.mapBoxes);
    } else {
      alert((response && response.message) || 'Failed to join public room');
    }
  });
});

attachButtonListener(btnSubmitCreate, () => {
  if (!socket.connected) {
    alert('Connecting to server... Please wait a moment and try again.');
    socket.connect();
    return;
  }

  const mapSize = document.getElementById('map-size').value;
  const botCountVal = parseInt(botCount.value, 10);
  const visibility = inputVisibility.value;
  const password = document.getElementById('room-password').value;

  const originalText = btnSubmitCreate.innerText;
  btnSubmitCreate.innerText = 'Creating...';
  btnSubmitCreate.disabled = true;

  const timeout = setTimeout(() => {
    btnSubmitCreate.innerText = originalText;
    btnSubmitCreate.disabled = false;
    alert('Server took too long to respond. Please try again.');
  }, 6000);

  socket.emit('createRoom', { mapSize, botCount: botCountVal, visibility, password }, (response) => {
    clearTimeout(timeout);
    btnSubmitCreate.innerText = originalText;
    btnSubmitCreate.disabled = false;

    if (response && response.success) {
      startGame(response.roomId, mapSize, response.mapBoxes);
    } else {
      alert((response && response.message) || 'Failed to create room.');
    }
  });
});

attachButtonListener(btnSubmitJoin, () => {
  const roomId = document.getElementById('join-room-id').value;
  const password = document.getElementById('join-room-password').value;
  joinRoom(roomId, password);
});

function joinRoom(roomId, password) {
  if (!socket.connected) {
    alert('Connecting to server... Please wait a moment and try again.');
    socket.connect();
    return;
  }

  socket.emit('joinRoom', { roomId, password }, (response) => {
    if (response && response.success) {
      startGame(response.roomId, response.mapSize, response.mapBoxes);
    } else {
      alert((response && response.message) || 'Failed to join room.');
    }
  });
}

// Start Game
function startGame(roomId, mapSize, mapBoxes) {
  currentRoomId = roomId;
  console.log(`Starting game in room: ${roomId}, Map Size: ${mapSize}`);
  
  // Hide lobby, show HUD
  lobbyOverlay.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');

  // Trigger phase 2 engine init safely
  try {
    initEngine(socket, roomId, mapSize, mapBoxes);
  } catch (err) {
    console.error('Failed to initialize 3D engine:', err);
    alert('Error initializing 3D game: ' + err.message);
    lobbyOverlay.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }
}


