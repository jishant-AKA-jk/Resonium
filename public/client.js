let socket;
let audioContext;
let localStream;
let peerConnections = new Map();
let currentRole = 'client';
let isConnected = false;
let audioElement;
let wakeLock = null;
let myChannel = 'both'; // 'left', 'right', or 'both'
let audioMode = 'stereo'; // 'stereo' or 'mono'
let splitterNode = null;
let leftGainNode = null;
let rightGainNode = null;

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

  socket.on('clients-update', (data) => {
    updateClientList(data.clients, data.mode);
    if (currentRole === 'server') {
      updateAudioModeUI(data.mode);
    }
  });

  socket.on('channel-assigned', (data) => {
    myChannel = data.channel;
    audioMode = data.mode;
    console.log(`✓ Channel assigned: ${myChannel} (${audioMode} mode)`);
    updateChannelDisplay();
  });

  socket.on('audio-mode-changed', (data) => {
    audioMode = data.mode;
    console.log(`Audio mode changed to: ${audioMode}`);
  });

  socket.on('client-ready', async (data) => {
    if (currentRole === 'server' && localStream) {
      console.log(`New client ready: ${data.name}, creating peer connection...`);
      await createPeerConnectionForClient(data.clientId, data.channel);
    }
  });

  socket.on('client-channel-changed', async (data) => {
    if (currentRole === 'server') {
      console.log(`Client channel changed: ${data.clientId} -> ${data.channel}`);
      // Recreate peer connection with new channel configuration
      const pc = peerConnections.get(data.clientId);
      if (pc) {
        pc.close();
        peerConnections.delete(data.clientId);
      }
      await createPeerConnectionForClient(data.clientId, data.channel);
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

    await requestWakeLock();

    socket.emit('register-client', {
      name: deviceName,
      volume: 80
    });

    isConnected = true;
    document.getElementById('client-setup').style.display = 'none';
    document.getElementById('client-connected').style.display = 'block';

    console.log('✓ Client registered, waiting for audio stream...');
    
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
    setupStereoAudio(event.streams[0]);
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

function setupStereoAudio(stream) {
  // Create audio element if doesn't exist
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.autoplay = true;
  }
  
  // For basic playback without processing (when both channels)
  if (myChannel === 'both') {
    audioElement.srcObject = stream;
    audioElement.volume = document.getElementById('volumeSlider').value / 100;
    
    audioElement.play()
      .then(() => {
        console.log('✓ Stereo audio playback started!');
      })
      .catch(error => {
        console.warn('⚠ Auto-play blocked, tap screen to start:', error);
        showPlayButton();
      });
    return;
  }

  // For stereo separation (left/right channel isolation)
  const source = audioContext.createMediaStreamSource(stream);
  
  // Create stereo splitter
  splitterNode = audioContext.createChannelSplitter(2);
  
  // Create gain nodes for left and right
  leftGainNode = audioContext.createGain();
  rightGainNode = audioContext.createGain();
  
  // Create merger to combine back
  const merger = audioContext.createChannelMerger(2);
  
  // Set gains based on channel assignment
  if (myChannel === 'left') {
    leftGainNode.gain.value = 1.0;  // Full left channel
    rightGainNode.gain.value = 0.0; // Mute right channel
  } else if (myChannel === 'right') {
    leftGainNode.gain.value = 0.0;  // Mute left channel
    rightGainNode.gain.value = 1.0; // Full right channel
  }
  
  // Volume control
  const volumeGain = audioContext.createGain();
  volumeGain.gain.value = document.getElementById('volumeSlider').value / 100;
  
  // Connect the audio graph
  source.connect(splitterNode);
  splitterNode.connect(leftGainNode, 0);   // Left channel
  splitterNode.connect(rightGainNode, 1);  // Right channel
  leftGainNode.connect(merger, 0, 0);
  rightGainNode.connect(merger, 0, 1);
  merger.connect(volumeGain);
  volumeGain.connect(audioContext.destination);
  
  console.log(`✓ ${myChannel.toUpperCase()} channel audio configured!`);
  
  // Store volume node for updates
  window.volumeGainNode = volumeGain;
}

function updateChannelDisplay() {
  const channelIndicator = document.getElementById('channelIndicator');
  if (!channelIndicator) return;
  
  const channelInfo = document.getElementById('channelInfo');
  const channelBadge = document.getElementById('channelBadge');
  
  if (myChannel === 'both') {
    channelBadge.textContent = '🔊 BOTH (Mono)';
    channelBadge.className = 'channel-badge mono';
    channelInfo.textContent = 'Playing full stereo audio';
  } else if (myChannel === 'left') {
    channelBadge.textContent = '◀️ LEFT';
    channelBadge.className = 'channel-badge left';
    channelInfo.textContent = 'Left channel only';
  } else if (myChannel === 'right') {
    channelBadge.textContent = '▶️ RIGHT';
    channelBadge.className = 'channel-badge right';
    channelInfo.textContent = 'Right channel only';
  }
  
  channelIndicator.style.display = 'block';
}

function changeMyChannel(newChannel) {
  socket.emit('change-channel', newChannel);
}

function showPlayButton() {
  const existingBtn = document.getElementById('playButton');
  if (existingBtn) return;
  
  const btn = document.createElement('button');
  btn.id = 'playButton';
  btn.textContent = '▶ TAP TO START AUDIO';
  btn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 40px;font-size:18px;z-index:1000;background:#667eea;color:white;border:none;border-radius:10px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
  
  btn.onclick = () => {
    if (audioElement) {
      audioElement.play()
        .then(() => {
          console.log('✓ Audio started after user interaction');
          btn.remove();
        })
        .catch(e => console.error('Still cannot play:', e));
    }
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  };
  
  document.body.appendChild(btn);
}

function updateVolume(value) {
  document.getElementById('volumeValue').textContent = value + '%';
  
  if (audioElement) {
    audioElement.volume = value / 100;
  }
  
  if (window.volumeGainNode) {
    window.volumeGainNode.gain.value = value / 100;
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
  
  if (splitterNode) {
    splitterNode.disconnect();
    splitterNode = null;
  }
  
  if (leftGainNode) {
    leftGainNode.disconnect();
    leftGainNode = null;
  }
  
  if (rightGainNode) {
    rightGainNode.disconnect();
    rightGainNode = null;
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  
  releaseWakeLock();
  removeBackgroundAudioHandlers();
  
  document.getElementById('client-setup').style.display = 'block';
  document.getElementById('client-connected').style.display = 'none';
  document.getElementById('deviceName').value = '';
  
  const channelIndicator = document.getElementById('channelIndicator');
  if (channelIndicator) {
    channelIndicator.style.display = 'none';
  }
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
        channelCount: 2  // Stereo
      } 
    });

    console.log('✓ Stereo audio stream captured:', localStream.getAudioTracks());

    document.getElementById('server-setup').style.display = 'none';
    document.getElementById('server-active').style.display = 'block';
    
    const serverUrl = window.location.origin;
    document.getElementById('serverUrl').textContent = serverUrl;

    isConnected = true;
    
    console.log('✓ Server ready! Waiting for clients to connect...');
  } catch (error) {
    console.error('❌ Error starting server:', error);
    alert('Failed to access audio input.\n\nPlease check:\n1. Microphone permission is granted\n2. CABLE Output is set as default recording device\n3. Make sure it supports stereo (2 channels)');
  }
}

async function createPeerConnectionForClient(clientId, channel) {
  console.log(`Creating WebRTC connection for client: ${clientId} (${channel})`);
  
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
      targetId: clientId,
      channel: channel
    });
    
    console.log('✓ Offer sent to client:', clientId);
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

function setAudioMode(mode) {
  socket.emit('set-audio-mode', mode);
}

function updateAudioModeUI(mode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = mode === 'stereo' ? 
    document.getElementById('stereoModeBtn') : 
    document.getElementById('monoModeBtn');
  
  if (activeBtn) {
    activeBtn.classList.add('active');
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

function updateClientList(clients, mode) {
  const listElement = document.getElementById('clientList');
  if (!listElement) return;

  if (clients.length === 0) {
    listElement.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No clients connected</p>';
    return;
  }

  listElement.innerHTML = clients.map(client => {
    let channelIcon = '🔊';
    let channelClass = 'both';
    let channelText = 'Both';
    
    if (client.channel === 'left') {
      channelIcon = '◀️';
      channelClass = 'left';
      channelText = 'LEFT';
    } else if (client.channel === 'right') {
      channelIcon = '▶️';
      channelClass = 'right';
      channelText = 'RIGHT';
    }
    
    return `
      <div class="client-item">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <strong style="font-size: 15px;">${client.name}</strong>
            <span class="channel-badge-mini ${channelClass}">${channelIcon} ${channelText}</span>
          </div>
          <small style="color: #999; font-size: 12px;">${client.id.substring(0, 8)}...</small>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 14px;">🔊 ${client.volume}%</span>
        </div>
      </div>
    `;
  }).join('');
}

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
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);
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
    
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('✓ Audio context resumed in background');
      });
    }
    
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

// Initialize on page load
window.addEventListener('load', () => {
  initSocket();
  
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