# 💊 PharmaFast — Medicine Delivery App

Full-stack medicine delivery system with Customer UI, Delivery Boy Dashboard, REST API, and real-time Socket.io updates.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
# or for development with auto-restart:
npx nodemon server.js
```

### 3. Open the apps
- **Customer UI** → http://localhost:3000/index.html
- **Rider Dashboard** → http://localhost:3000/delivery.html

---

## 🌍 Deployment (Render)

This project is ready to be hosted on **Render**.

1. **Push to GitHub**: Initialize a git repo and push your code.
2. **Connect to Render**:
   - Create a new **Web Service** on Render.
   - Connect your GitHub repository.
   - Render will automatically detect the `render.yaml` file and configure the service.
3. **Manual Setup** (if not using `render.yaml`):
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment Variables**:
     - `PHARMAFAST_SECRET`: A long random string for JWT.
     - `NODE_ENV`: `production`

> [!CAUTION]
> **Ephemeral Storage**: Render's free tier uses ephemeral storage. Uploaded prescriptions and order data will be reset on restarts. For production, consider using a database like MongoDB and cloud storage like Cloudinary.

---

## 👥 Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Customer | customer@demo.com | demo123 |
| Delivery Boy | rider@demo.com | demo123 |

These are seeded automatically on first run.

---

## 🏗️ Tech Stack

- **Backend**: Node.js, Express.js, Socket.io, JWT, bcryptjs
- **Storage**: JSON flat-file (`db.json`) — no database setup needed
- **Frontend**: Vanilla HTML/CSS/JS + Socket.io client

---

## 📁 File Structure

```
pharmafast/
├── server.js         # Express + Socket.io backend
├── index.html        # Customer-facing app
├── delivery.html     # Rider dashboard
├── db.json           # Auto-generated database
├── package.json
└── README.md
```

---

## 🔄 Order Flow

```
Customer places order
       ↓
[pending] → Delivery boy sees it in Available Orders
       ↓
[accepted] → Rider accepts → Customer notified via Socket.io
       ↓
[picked_up] → Rider marks picked up
       ↓
[on_the_way] → Rider is en route
       ↓
[delivered] → Done! Rider earns ₹40
```

---

## 🔌 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register (role: customer or delivery_boy) |
| POST | /api/auth/login | Login → returns JWT token |
| GET | /api/auth/me | Get current user |

### Orders
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | /api/orders | Customer | Place a new order |
| GET | /api/orders/my | Customer | Get my orders |
| GET | /api/orders/available | Delivery Boy | Get pending orders |
| GET | /api/orders/mine | Delivery Boy | Get my accepted/delivered orders |
| PUT | /api/orders/:id/accept | Delivery Boy | Accept an order |
| PUT | /api/orders/:id/status | Delivery Boy | Update: picked_up → on_the_way → delivered |
| GET | /api/orders/:id | Both | Get single order |

---

## ⚡ Real-time Events (Socket.io)

| Event | Direction | Description |
|-------|-----------|-------------|
| order:new | Server → Riders | New order placed |
| order:taken | Server → Riders | Order accepted by another rider |
| order:accepted | Server → Customer | Rider accepted their order |
| order:statusUpdate | Server → Customer | Status changed |

---

## 🔐 Auth Headers

All protected routes require:
```
Authorization: Bearer <jwt_token>
```
