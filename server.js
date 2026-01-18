const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8
});

app.use(cors());
app.use(express.static('public'));

// Store connected clients with their audio channel assignments
const connectedClients = new Map();
let audioMode = 'stereo'; // 'stereo' or 'mono'

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

function assignAudioChannel() {
  const clients = Array.from(connectedClients.values());
  
  // If mono mode, everyone gets 'both'
  if (audioMode === 'mono') {
    return 'both';
  }
  
  // For stereo mode
  const leftCount = clients.filter(c => c.channel === 'left').length;
  const rightCount = clients.filter(c => c.channel === 'right').length;
  
  // Auto-assign to balance left/right
  if (leftCount <= rightCount) {
    return 'left';
  } else {
    return 'right';
  }
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register-client', (data) => {
    const channel = assignAudioChannel();
    
    connectedClients.set(socket.id, {
      id: socket.id,
      name: data.name || 'Unknown Device',
      volume: data.volume || 100,
      channel: channel,
      timestamp: Date.now()
    });
    
    console.log(`✓ Client registered: ${data.name} (${socket.id}) - Channel: ${channel}`);
    
    // Send channel assignment to the client
    socket.emit('channel-assigned', {
      channel: channel,
      mode: audioMode
    });
    
    // Broadcast updated client list to all clients
    broadcastClientList();
    
    // Notify server page that a new client is ready for WebRTC
    socket.broadcast.emit('client-ready', {
      clientId: socket.id,
      name: data.name,
      channel: channel
    });
  });

  socket.on('change-channel', (newChannel) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      client.channel = newChannel;
      console.log(`Channel changed for ${client.name}: ${newChannel}`);
      
      socket.emit('channel-assigned', {
        channel: newChannel,
        mode: audioMode
      });
      
      broadcastClientList();
      
      // Notify server to update WebRTC connection
      socket.broadcast.emit('client-channel-changed', {
        clientId: socket.id,
        channel: newChannel
      });
    }
  });

  socket.on('set-audio-mode', (mode) => {
    audioMode = mode;
    console.log(`Audio mode changed to: ${mode}`);
    
    // Update all clients
    connectedClients.forEach((client, id) => {
      if (mode === 'mono') {
        client.channel = 'both';
      } else {
        // Reassign channels for stereo
        client.channel = assignAudioChannel();
      }
      
      io.to(id).emit('channel-assigned', {
        channel: client.channel,
        mode: audioMode
      });
    });
    
    broadcastClientList();
    io.emit('audio-mode-changed', { mode: audioMode });
  });

  socket.on('volume-change', (volume) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      client.volume = volume;
      broadcastClientList();
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.targetId || 'all clients'}`);
    
    if (data.targetId) {
      io.to(data.targetId).emit('offer', {
        offer: data.offer,
        senderId: socket.id,
        channel: data.channel
      });
    } else {
      socket.broadcast.emit('offer', {
        offer: data.offer,
        senderId: socket.id,
        channel: data.channel
      });
    }
  });

  socket.on('answer', (data) => {
    console.log(`Answer from ${socket.id} to ${data.targetId}`);
    io.to(data.targetId).emit('answer', {
      answer: data.answer,
      senderId: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    if (data.targetId) {
      io.to(data.targetId).emit('ice-candidate', {
        candidate: data.candidate,
        senderId: socket.id
      });
    } else {
      socket.broadcast.emit('ice-candidate', {
        candidate: data.candidate,
        senderId: socket.id
      });
    }
  });

  socket.on('disconnect', () => {
    const client = connectedClients.get(socket.id);
    if (client) {
      console.log(`✗ Client disconnected: ${client.name} (${socket.id})`);
    }
    connectedClients.delete(socket.id);
    broadcastClientList();
  });
});

function broadcastClientList() {
  io.emit('clients-update', {
    clients: Array.from(connectedClients.values()),
    mode: audioMode
  });
}

const PORT = process.env.PORT || 3000;
const localIP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n================================');
  console.log('🎵 Audio Streaming Server Started');
  console.log('================================');
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://${localIP}:${PORT}`);
  console.log('\nShare the Network URL with your mobile devices!');
  console.log('================================\n');
});