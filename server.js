const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.PHARMAFAST_SECRET || 'pharmafast_dev_secret_2026';
const DB_PATH = path.join(__dirname, 'db.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// ─── Multer Config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'rx-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Only images (jpg, png, webp) and PDFs are allowed'));
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve HTML files
app.use('/uploads', express.static(UPLOADS_DIR)); // serve uploaded prescriptions

// ─── DB Helpers ──────────────────────────────────────────────────────────────
function readDB() {
  if (!fs.existsSync(DB_PATH)) return { users: [], orders: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function seedDB() {
  const db = readDB();
  if (db.users.length === 0) {
    const salt = bcrypt.genSaltSync(10);
    db.users.push(
      { id: uuidv4(), name: 'Demo Customer', email: 'customer@demo.com', phone: '+91 98765 43210', passwordHash: bcrypt.hashSync('demo123', salt), address: '14/B, Near KS Hospital, Pampady, Kerala 686502', role: 'customer', createdAt: new Date().toISOString() },
      { id: uuidv4(), name: 'Rajan Kumar', email: 'rider@demo.com', phone: '+91 91234 56789', passwordHash: bcrypt.hashSync('demo123', salt), address: 'Pampady Main Road, Kerala', role: 'delivery_boy', createdAt: new Date().toISOString() }
    );
    writeDB(db);
    console.log('✅ Seeded demo accounts: customer@demo.com / demo123 | rider@demo.com / demo123');
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, phone, email, password, address, role } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'Missing fields' });
  if (!['customer', 'delivery_boy'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const db = readDB();
  if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });

  const salt = await bcrypt.genSalt(10);
  const user = {
    id: uuidv4(), name, email, phone: phone || '', address: address || '',
    passwordHash: await bcrypt.hash(password, salt),
    role, createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDB(db);

  const { passwordHash, ...safeUser } = user;
  const token = jwt.sign({ id: user.id, email, role, name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'Invalid credentials' });

  const { passwordHash, ...safeUser } = user;
  const token = jwt.sign({ id: user.id, email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

// ─── Upload Routes ────────────────────────────────────────────────────────────
app.post('/api/upload-prescription', authMiddleware, requireRole('customer'), upload.single('prescription'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

// ─── Order Routes ─────────────────────────────────────────────────────────────
// Customer: place order
app.post('/api/orders', authMiddleware, requireRole('customer'), (req, res) => {
  const { items, total, address, prescriptionRequired, prescriptionPath, paymentMode } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items' });

  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  const order = {
    id: uuidv4(),
    shortId: 'PF-' + Math.floor(1000 + Math.random() * 9000),
    customerId: req.user.id,
    customerName: req.user.name,
    customerPhone: user?.phone || '',
    items,
    total: total || 0,
    address: address || user?.address || '',
    prescriptionRequired: !!prescriptionRequired,
    prescriptionPath: prescriptionPath || null,
    paymentMode: paymentMode || 'Cash on Delivery',
    status: 'pending',
    deliveryBoyId: null,
    deliveryBoyName: null,
    deliveryBoyPhone: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusHistory: [{ status: 'pending', time: new Date().toISOString() }]
  };
  db.orders.push(order);
  writeDB(db);

  // Notify all delivery boys in real-time
  io.to('delivery_boys').emit('order:new', order);
  res.json(order);
});

// Customer: cancel order
app.post('/api/orders/:id/cancel', authMiddleware, requireRole('customer'), (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.customerId !== req.user.id) return res.status(403).json({ error: 'Not your order' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Can only cancel pending orders' });

  order.status = 'cancelled';
  order.updatedAt = new Date().toISOString();
  order.statusHistory.push({ status: 'cancelled', time: new Date().toISOString() });
  writeDB(db);

  io.to('delivery_boys').emit('order:taken', { orderId: order.id }); // Remove from available
  res.json(order);
});

// Customer: get their orders
app.get('/api/orders/my', authMiddleware, requireRole('customer'), (req, res) => {
  const db = readDB();
  const orders = db.orders.filter(o => o.customerId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

// Delivery boy: get pending orders
app.get('/api/orders/available', authMiddleware, requireRole('delivery_boy'), (req, res) => {
  const db = readDB();
  const orders = db.orders.filter(o => o.status === 'pending').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

// Delivery boy: get their active/history orders
app.get('/api/orders/mine', authMiddleware, requireRole('delivery_boy'), (req, res) => {
  const db = readDB();
  const orders = db.orders.filter(o => o.deliveryBoyId === req.user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(orders);
});

// Delivery boy: accept order
app.put('/api/orders/:id/accept', authMiddleware, requireRole('delivery_boy'), (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Order no longer available' });

  // Check if this rider already has an active order
  const hasActive = db.orders.find(o => o.deliveryBoyId === req.user.id && !['delivered', 'pending'].includes(o.status));
  if (hasActive) return res.status(400).json({ error: 'You already have an active order' });

  const riderUser = db.users.find(u => u.id === req.user.id);
  order.status = 'accepted';
  order.deliveryBoyId = req.user.id;
  order.deliveryBoyName = req.user.name;
  order.deliveryBoyPhone = riderUser?.phone || '';
  order.updatedAt = new Date().toISOString();
  order.statusHistory.push({ status: 'accepted', time: new Date().toISOString() });
  writeDB(db);

  // Notify customer + remove from available for other riders
  io.to(`customer:${order.customerId}`).emit('order:accepted', order);
  io.to('delivery_boys').emit('order:taken', { orderId: order.id });
  res.json(order);
});

// Delivery boy: update status
app.put('/api/orders/:id/status', authMiddleware, requireRole('delivery_boy'), (req, res) => {
  const { status } = req.body;
  const validStatuses = ['picked_up', 'on_the_way', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.deliveryBoyId !== req.user.id) return res.status(403).json({ error: 'Not your order' });

  order.status = status;
  order.updatedAt = new Date().toISOString();
  order.statusHistory.push({ status, time: new Date().toISOString() });
  writeDB(db);

  io.to(`customer:${order.customerId}`).emit('order:statusUpdate', order);
  res.json(order);
});

// Get single order
app.get('/api/orders/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', ({ role, userId }) => {
    if (role === 'delivery_boy') socket.join('delivery_boys');
    if (role === 'customer' && userId) socket.join(`customer:${userId}`);
  });
  socket.on('disconnect', () => {});
});

// ─── Start ────────────────────────────────────────────────────────────────────
seedDB();
server.listen(PORT, () => {
  console.log(`\n🚀 PharmaFast backend running on port ${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   Local Customer UI  → http://localhost:${PORT}/index.html`);
    console.log(`   Local Delivery Dashboard → http://localhost:${PORT}/delivery.html\n`);
  }
});
