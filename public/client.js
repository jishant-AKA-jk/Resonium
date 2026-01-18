let socket;
let audioContext;
let localStream;
let peerConnections = new Map(); // Store multiple peer connections
let currentRole = 'client';
let isConnected = false;
let audioElement;
let wakeLock = null; // Screen wake lock

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize socket connection
function initSocket() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('✓ Connected to server');
  });

  socket.on('clients-update', (clients) => {
    updateClientList(clients);
  });

  // Server receives this when a client is ready
  socket.on('client-ready', async (data) => {
    if (currentRole === 'server' && localStream) {
      console.log(`New client ready: ${data.name}, creating peer connection...`);
      await createPeerConnectionForClient(data.clientId);
    }
  });

  socket.on('offer', async (data) => {
    if (currentRole === 'client') {
      console.log('📥 Received offer from server');
      await handleOffer(data);
    }
  });

  socket.on('answer', async (data) => {
    if (currentRole === 'server') {
      console.log('📥 Received answer from client');
      const pc = peerConnections.get(data.senderId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('✓ Remote description set');
      }
    }
  });

  socket.on('ice-candidate', async (data) => {
    const pc = currentRole === 'server' 
      ? peerConnections.get(data.senderId)
      : peerConnections.get('server');
      
    if (pc && data.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('✓ ICE candidate added');
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  });
}

// Switch between client and server roles
function switchRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
  document.getElementById(`${role}-section`).classList.add('active');
}

// ========== CLIENT FUNCTIONS ==========

async function connectAsClient() {
  const deviceName = document.getElementById('deviceName').value.trim();
  if (!deviceName) {
    alert('Please enter a device name');
    return;
  }

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Request wake lock to keep screen on
    await requestWakeLock();

    socket.emit('register-client', {
      name: deviceName,
      volume: 80
    });

    isConnected = true;
    document.getElementById('client-setup').style.display = 'none';
    document.getElementById('client-connected').style.display = 'block';

    console.log('✓ Client registered, waiting for audio stream...');
    
    // Set up visibility change handler
    setupBackgroundAudioHandlers();
  } catch (error) {
    console.error('Error connecting:', error);
    alert('Failed to connect: ' + error.message);
  }
}

async function handleOffer(data) {
  console.log('Creating peer connection for server stream...');
  
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set('server', pc);

  pc.ontrack = (event) => {
    console.log('🎵 AUDIO TRACK RECEIVED!', event);
    
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.autoplay = true;
    }
    
    audioElement.srcObject = event.streams[0];
    audioElement.volume = document.getElementById('volumeSlider').value / 100;
    
    audioElement.play()
      .then(() => {
        console.log('✓ Audio playback started!');
      })
      .catch(error => {
        console.warn('⚠ Auto-play blocked, tap screen to start:', error);
        showPlayButton();
      });
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        targetId: data.senderId
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('ICE State:', pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection State:', pc.connectionState);
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('answer', {
      answer: answer,
      targetId: data.senderId
    });
    
    console.log('✓ Answer sent to server');
  } catch (error) {
    console.error('Error handling offer:', error);
  }
}

function showPlayButton() {
  const existingBtn = document.getElementById('playButton');
  if (existingBtn) return;
  
  const btn = document.createElement('button');
  btn.id = 'playButton';
  btn.textContent = '▶ TAP TO START AUDIO';
  btn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 40px;font-size:18px;z-index:1000;background:#667eea;color:white;border:none;border-radius:10px;cursor:pointer;';
  
  btn.onclick = () => {
    if (audioElement) {
      audioElement.play()
        .then(() => {
          console.log('✓ Audio started after user interaction');
          btn.remove();
        })
        .catch(e => console.error('Still cannot play:', e));
    }
  };
  
  document.body.appendChild(btn);
}

function updateVolume(value) {
  document.getElementById('volumeValue').textContent = value + '%';
  
  if (audioElement) {
    audioElement.volume = value / 100;
  }

  socket.emit('volume-change', parseInt(value));
}

function disconnectClient() {
  isConnected = false;
  
  if (audioElement) {
    audioElement.pause();
    audioElement.srcObject = null;
    audioElement = null;
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  // Release wake lock
  releaseWakeLock();
  
  // Remove background handlers
  removeBackgroundAudioHandlers();
  
  document.getElementById('client-setup').style.display = 'block';
  document.getElementById('client-connected').style.display = 'none';
  document.getElementById('deviceName').value = '';
}

// ========== SERVER FUNCTIONS ==========

async function startServer() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
        channelCount: 2
      } 
    });

    console.log('✓ Audio stream captured:', localStream.getAudioTracks());

    document.getElementById('server-setup').style.display = 'none';
    document.getElementById('server-active').style.display = 'block';
    
    const serverUrl = window.location.origin;
    document.getElementById('serverUrl').textContent = serverUrl;

    isConnected = true;
    
    console.log('✓ Server ready! Waiting for clients to connect...');
  } catch (error) {
    console.error('❌ Error starting server:', error);
    alert('Failed to access audio input.\n\nPlease check:\n1. Microphone permission is granted\n2. Windows Sound Settings > Recording tab\n3. "CABLE Output" should be visible and enabled\n4. Right-click it > Set as Default Device');
  }
}

async function createPeerConnectionForClient(clientId) {
  console.log(`Creating WebRTC connection for client: ${clientId}`);
  
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(clientId, pc);
  
  // Add local audio stream tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    console.log('✓ Added audio track to peer connection');
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        candidate: event.candidate,
        targetId: clientId
      });
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`ICE State (${clientId}):`, pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection State (${clientId}):`, pc.connectionState);
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
      offer: offer,
      targetId: clientId
    });
    
    console.log('✓ Offer sent to client:', clientId);
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

function stopServer() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();

  isConnected = false;
  document.getElementById('server-setup').style.display = 'block';
  document.getElementById('server-active').style.display = 'none';
}

function updateClientList(clients) {
  const listElement = document.getElementById('clientList');
  if (!listElement) return;

  if (clients.length === 0) {
    listElement.innerHTML = '<p style="text-align: center; color: #666;">No clients connected</p>';
    return;
  }

  listElement.innerHTML = clients.map(client => `
    <div class="client-item">
      <div>
        <strong>${client.name}</strong><br>
        <small style="color: #666;">${client.id.substring(0, 8)}...</small>
      </div>
      <div>
        <span>🔊 ${client.volume}%</span>
      </div>
    </div>
  `).join('');
}

// Initialize on page load
window.addEventListener('load', () => {
  initSocket();
  
  // Register service worker for background support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('✓ Service Worker registered:', registration);
      })
      .catch(err => {
        console.log('Service Worker registration failed:', err);
      });
  }
});

// ========== BACKGROUND AUDIO & WAKE LOCK FUNCTIONS ==========

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('✓ Wake Lock acquired - screen will stay on');
      
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
    } else {
      console.warn('⚠ Wake Lock API not supported on this device');
    }
  } catch (err) {
    console.error('Wake Lock error:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release()
      .then(() => {
        wakeLock = null;
        console.log('✓ Wake Lock manually released');
      });
  }
}

function setupBackgroundAudioHandlers() {
  // Handle visibility change (app backgrounded)
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // Handle page unload warning
  window.addEventListener('beforeunload', handleBeforeUnload);
  
  // Re-acquire wake lock when page becomes visible
  document.addEventListener('visibilitychange', reacquireWakeLock);
  
  console.log('✓ Background audio handlers set up');
}

function removeBackgroundAudioHandlers() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.removeEventListener('visibilitychange', reacquireWakeLock);
}

function handleVisibilityChange() {
  if (document.hidden) {
    console.log('📱 App backgrounded - keeping audio alive');
    
    // Resume audio context if suspended
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('✓ Audio context resumed in background');
      });
    }
    
    // Ensure audio element keeps playing
    if (audioElement && audioElement.paused) {
      audioElement.play().catch(e => console.log('Background play prevented:', e));
    }
  } else {
    console.log('📱 App foregrounded');
  }
}

function handleBeforeUnload(e) {
  if (isConnected) {
    e.preventDefault();
    e.returnValue = 'Audio streaming is active. Are you sure you want to leave?';
    return e.returnValue;
  }
}

async function reacquireWakeLock() {
  if (!document.hidden && isConnected && wakeLock === null) {
    await requestWakeLock();
  }
}