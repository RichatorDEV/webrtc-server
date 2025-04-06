const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permitir todas las conexiones (ajusta según tu dominio de GitHub Pages)
    methods: ["GET", "POST"]
  }
});
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

async function initializeDatabase() {
  try {
    const userCount = await prisma.$queryRaw`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'User'`;
    if (userCount[0].count == 0) {
      console.log('La tabla User no existe, aplicando migración...');
      await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "User" (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
      console.log('Tabla User creada exitosamente.');
    } else {
      console.log('La tabla User ya existe, no se requiere acción.');
    }
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

initializeDatabase().then(() => {
  console.log('Inicialización de la base de datos completada.');
});

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

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (user && await bcrypt.compare(password, user.password)) {
    res.json({ message: 'Sesión iniciada', username });
  } else {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

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
