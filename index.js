const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const prisma = new PrismaClient();

// Configurar multer para almacenar archivos
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, `${req.body.username}-${Date.now()}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Servir archivos subidos

// Crear directorio uploads si no existe
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}

async function initializeDatabase() {
  try {
    // Verificar y crear tabla User
    const userCount = await prisma.$queryRaw`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'User'`;
    if (userCount[0].count == 0) {
      console.log('Creando tabla User...');
      await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "User" (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    }

    // Verificar y crear tabla Ringtone
    const ringtoneCount = await prisma.$queryRaw`SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'Ringtone'`;
    if (ringtoneCount[0].count == 0) {
      console.log('Creando tabla Ringtone...');
      await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "Ringtone" (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER UNIQUE NOT NULL,
        "filePath" VARCHAR(255) NOT NULL,
        FOREIGN KEY ("userId") REFERENCES "User"(id)
      )`;
    }
    console.log('Base de datos inicializada.');
  } catch (error) {
    console.error('Error al inicializar la base de datos:', error);
  } finally {
    await prisma.$disconnect();
  }
}

initializeDatabase().then(() => console.log('Inicialización completada.'));

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

app.post('/upload-ringtone', upload.single('ringtone'), async (req, res) => {
  const { username } = req.body;
  const filePath = `/uploads/${req.file.filename}`;

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await prisma.ringtone.upsert({
      where: { userId: user.id },
      update: { filePath },
      create: { userId: user.id, filePath }
    });
    res.json({ message: 'Tono guardado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al guardar el tono' });
  }
});

app.get('/get-ringtone', async (req, res) => {
  const { username } = req.query;
  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { ringtone: true }
    });
    if (!user || !user.ringtone) {
      return res.status(404).send('Tono no encontrado');
    }
    res.sendFile(path.join(__dirname, user.ringtone.filePath));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el tono' });
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

  socket.on('reject', ({ to }) => {
    io.to(to).emit('reject');
  });

  socket.on('disconnect', () => {
    io.emit('userList', Object.keys(io.sockets.sockets).map(id => io.sockets.sockets[id].username).filter(Boolean));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
