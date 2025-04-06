const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const prisma = new PrismaClient();

app.use(express.static(path.join(__dirname, '../client')));
app.use(express.json());

// Registro de usuario
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { username, password: hashedPassword },
    });
    res.json({ message: 'Usuario registrado', username: user.username });
  } catch (error) {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

// Inicio de sesión
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (user && await bcrypt.compare(password, user.password)) {
    res.json({ message: 'Sesión iniciada', username });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

// WebRTC Signaling
io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('join', (username) => {
    socket.join(username);
    socket.username = username;
    io.emit('userList', Object.keys(io.sockets.sockets).map(id => io.sockets.sockets[id].username).filter(Boolean));
  });

  socket.on('offer', ({ offer, to }) => {
    io.to(to).emit('offer', { offer, from: socket.username });
  });

  socket.on('answer', ({ answer, to }) => {
    io.to(to).emit('answer', { answer, from: socket.username });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    io.to(to).emit('ice-candidate', { candidate, from: socket.username });
  });

  socket.on('disconnect', () => {
    io.emit('userList', Object.keys(io.sockets.sockets).map(id => io.sockets.sockets[id].username).filter(Boolean));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));