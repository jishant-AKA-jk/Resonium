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

// Store connected clients
const connectedClients = new Map();

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

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register-client', (data) => {
    connectedClients.set(socket.id, {
      id: socket.id,
      name: data.name || 'Unknown Device',
      volume: data.volume || 100,
      timestamp: Date.now()
    });
    
    console.log(`✓ Client registered: ${data.name} (${socket.id})`);
    
    // Broadcast updated client list to all clients
    io.emit('clients-update', Array.from(connectedClients.values()));
    
    // Notify server page that a new client is ready for WebRTC
    socket.broadcast.emit('client-ready', {
      clientId: socket.id,
      name: data.name
    });
  });

  socket.on('volume-change', (volume) => {
    const client = connectedClients.get(socket.id);
    if (client) {
      client.volume = volume;
      io.emit('clients-update', Array.from(connectedClients.values()));
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    console.log(`Offer from ${socket.id} to ${data.targetId || 'all clients'}`);
    
    if (data.targetId) {
      // Send to specific client
      io.to(data.targetId).emit('offer', {
        offer: data.offer,
        senderId: socket.id
      });
    } else {
      // Broadcast to all clients except sender
      socket.broadcast.emit('offer', {
        offer: data.offer,
        senderId: socket.id
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
    io.emit('clients-update', Array.from(connectedClients.values()));
  });
});

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