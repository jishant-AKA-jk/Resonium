let socket;
let audioContext;
let localStream;
let peerConnections = new Map();
let currentRole = 'client';
let isConnected = false;
let audioElement;
let wakeLock = null;
let myChannel = 'both';
let audioMode = 'stereo';
let audioWorkletNode = null;
let sourceNode = null;
let destinationNode = null;
let serverVolume = 100; // Volume controlled from server

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

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

  socket.on('server-volume-change', (volume) => {
    serverVolume = volume;
    console.log(`Server adjusted volume to: ${volume}%`);
    
    // Update local volume slider to reflect server control
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    if (volumeSlider && volumeValue) {
      volumeSlider.value = volume;
      volumeValue.textContent = volume + '%';
    }
    
    // Apply volume
    applyVolume();
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
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  });

  socket.on('sync-time', (data) => {
    // Basic time sync for audio synchronization
    const serverTime = data.time;
    const latency = Date.now() - data.clientSendTime;
    console.log(`Network latency: ${latency}ms`);
  });
}

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
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'playback',
      sampleRate: 48000
    });
    
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

  pc.ontrack = async (event) => {
    console.log('🎵 AUDIO TRACK RECEIVED!', event);
    await setupProperStereoAudio(event.streams[0]);
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

async function setupProperStereoAudio(stream) {
  console.log('Setting up PROPER stereo separation...');
  
  // Clean up previous nodes
  if (sourceNode) sourceNode.disconnect();
  if (destinationNode) destinationNode.disconnect();
  
  // Create source from stream
  sourceNode = audioContext.createMediaStreamSource(stream);
  
  // Create channel splitter (separates L and R)
  const splitter = audioContext.createChannelSplitter(2);
  
  // Create individual gain nodes for L and R
  const leftGain = audioContext.createGain();
  const rightGain = audioContext.createGain();
  
  // Create merger to recombine
  const merger = audioContext.createChannelMerger(2);
  
  // Master volume gain
  const masterGain = audioContext.createGain();
  masterGain.gain.value = serverVolume / 100;
  window.masterGainNode = masterGain;
  
  // Configure gains based on channel
  if (myChannel === 'left') {
    console.log('🔴 Configuring LEFT channel only');
    leftGain.gain.value = 1.0;   // Keep left
    rightGain.gain.value = 0.0;  // MUTE right completely
    
    // Output left channel to BOTH speakers for mono effect
    sourceNode.connect(splitter);
    splitter.connect(leftGain, 0);      // Get left channel
    splitter.connect(rightGain, 1);     // Get right (but muted)
    leftGain.connect(merger, 0, 0);     // Left -> Left output
    leftGain.connect(merger, 0, 1);     // Left -> Right output (duplicate)
    rightGain.connect(merger, 0, 0);    // Right muted
    
  } else if (myChannel === 'right') {
    console.log('🔵 Configuring RIGHT channel only');
    leftGain.gain.value = 0.0;   // MUTE left completely
    rightGain.gain.value = 1.0;  // Keep right
    
    // Output right channel to BOTH speakers for mono effect
    sourceNode.connect(splitter);
    splitter.connect(leftGain, 0);      // Get left (but muted)
    splitter.connect(rightGain, 1);     // Get right channel
    rightGain.connect(merger, 0, 0);    // Right -> Left output (duplicate)
    rightGain.connect(merger, 0, 1);    // Right -> Right output
    leftGain.connect(merger, 0, 1);     // Left muted
    
  } else {
    console.log('🟢 Configuring BOTH channels (stereo)');
    leftGain.gain.value = 1.0;   // Keep left
    rightGain.gain.value = 1.0;  // Keep right
    
    // Normal stereo output
    sourceNode.connect(splitter);
    splitter.connect(leftGain, 0);
    splitter.connect(rightGain, 1);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
  }
  
  // Connect to master gain and output
  merger.connect(masterGain);
  masterGain.connect(audioContext.destination);
  destinationNode = masterGain;
  
  console.log(`✓ Audio graph configured for ${myChannel.toUpperCase()} channel`);
  
  // Test the setup
  const tracks = stream.getAudioTracks();
  if (tracks.length > 0) {
    console.log('Audio track settings:', tracks[0].getSettings());
  }
  
  // Resume context if needed
  if (audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      console.log('✓ Audio context resumed');
    }).catch(e => {
      console.error('Failed to resume:', e);
      showPlayButton();
    });
  }
}

function applyVolume() {
  if (window.masterGainNode) {
    const localVolume = document.getElementById('volumeSlider').value / 100;
    const serverVolumeNormalized = serverVolume / 100;
    // Combine local and server volume
    window.masterGainNode.gain.value = localVolume * serverVolumeNormalized;
  }
}

function updateChannelDisplay() {
  const channelIndicator = document.getElementById('channelIndicator');
  if (!channelIndicator) return;
  
  const channelInfo = document.getElementById('channelInfo');
  const channelBadge = document.getElementById('channelBadge');
  
  if (myChannel === 'both') {
    channelBadge.textContent = '🔊 BOTH (Stereo)';
    channelBadge.className = 'channel-badge mono';
    channelInfo.textContent = 'Playing full stereo audio';
  } else if (myChannel === 'left') {
    channelBadge.textContent = '◀️ LEFT ONLY';
    channelBadge.className = 'channel-badge left';
    channelInfo.textContent = 'Left channel isolated (muted right)';
  } else if (myChannel === 'right') {
    channelBadge.textContent = '▶️ RIGHT ONLY';
    channelBadge.className = 'channel-badge right';
    channelInfo.textContent = 'Right channel isolated (muted left)';
  }
  
  channelIndicator.style.display = 'block';
}

function changeMyChannel(newChannel) {
  socket.emit('change-channel', newChannel);
  myChannel = newChannel;
  
  // Need to reconnect to apply new channel configuration
  console.log(`Channel changed to ${newChannel}, reconnecting...`);
  
  // Show temporary message
  const badge = document.getElementById('channelBadge');
  if (badge) {
    badge.textContent = '🔄 Switching...';
  }
}

function showPlayButton() {
  const existingBtn = document.getElementById('playButton');
  if (existingBtn) return;
  
  const btn = document.createElement('button');
  btn.id = 'playButton';
  btn.textContent = '▶ TAP TO START AUDIO';
  btn.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:20px 40px;font-size:18px;z-index:1000;background:#667eea;color:white;border:none;border-radius:10px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
  
  btn.onclick = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('✓ Audio started after user interaction');
        btn.remove();
      });
    }
  };
  
  document.body.appendChild(btn);
}

function updateVolume(value) {
  document.getElementById('volumeValue').textContent = value + '%';
  applyVolume();
  socket.emit('volume-change', parseInt(value));
}

function disconnectClient() {
  isConnected = false;
  
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  
  if (destinationNode) {
    destinationNode.disconnect();
    destinationNode = null;
  }
  
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
        channelCount: 2
      } 
    });

    const tracks = localStream.getAudioTracks();
    const settings = tracks[0].getSettings();
    console.log('✓ Audio captured:', settings);
    
    if (settings.channelCount !== 2) {
      alert('⚠️ WARNING: Audio source is not stereo!\n\nCurrent channels: ' + settings.channelCount + '\n\nPlease ensure:\n1. CABLE Output is set to stereo (2 channels)\n2. Recording device properties show "2 channel"');
    }

    document.getElementById('server-setup').style.display = 'none';
    document.getElementById('server-active').style.display = 'block';
    
    const serverUrl = window.location.origin;
    document.getElementById('serverUrl').textContent = serverUrl;

    isConnected = true;
    
    console.log('✓ Server ready! Waiting for clients...');
  } catch (error) {
    console.error('❌ Error starting server:', error);
    alert('Failed to access audio input.\n\nChecklist:\n✓ Microphone permission granted\n✓ CABLE Output set as default recording device\n✓ CABLE Output properties: 2 channel, 48000 Hz');
  }
}

async function createPeerConnectionForClient(clientId, channel) {
  console.log(`Creating WebRTC for client: ${clientId} (${channel})`);
  
  const pc = new RTCPeerConnection(iceServers);
  peerConnections.set(clientId, pc);
  
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
    console.log('✓ Added track:', track.kind, track.label);
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
    console.log(`ICE (${clientId}):`, pc.iceConnectionState);
  };

  try {
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });
    await pc.setLocalDescription(offer);
    
    socket.emit('offer', {
      offer: offer,
      targetId: clientId,
      channel: channel
    });
    
    console.log('✓ Offer sent');
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

function setClientVolume(clientId, volume) {
  socket.emit('set-client-volume', {
    clientId: clientId,
    volume: volume
  });
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
    let channelText = 'BOTH';
    
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
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <strong style="font-size: 15px;">${client.name}</strong>
            <span class="channel-badge-mini ${channelClass}">${channelIcon} ${channelText}</span>
          </div>
          <small style="color: #999; font-size: 11px;">${client.id.substring(0, 8)}...</small>
        </div>
        <div style="width: 180px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input 
              type="range" 
              min="0" 
              max="100" 
              value="${client.serverVolume || 100}" 
              oninput="setClientVolume('${client.id}', this.value)"
              style="flex: 1; height: 6px;"
            />
            <span style="font-size: 13px; min-width: 40px; text-align: right;" id="vol-${client.id}">${client.serverVolume || 100}%</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ========== BACKGROUND SUPPORT ==========

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('✓ Wake Lock acquired');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
    }
  } catch (err) {
    console.error('Wake Lock error:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => {
      wakeLock = null;
    });
  }
}

function setupBackgroundAudioHandlers() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('visibilitychange', reacquireWakeLock);
}

function removeBackgroundAudioHandlers() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.removeEventListener('visibilitychange', reacquireWakeLock);
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
    }
  }
}

function handleBeforeUnload(e) {
  if (isConnected) {
    e.preventDefault();
    e.returnValue = 'Audio streaming active. Leave?';
    return e.returnValue;
  }
}

async function reacquireWakeLock() {
  if (!document.hidden && isConnected && wakeLock === null) {
    await requestWakeLock();
  }
}

window.addEventListener('load', () => {
  initSocket();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => console.log('✓ Service Worker registered'))
      .catch(err => console.log('SW failed:', err));
  }
});