# TSG Chess Arena

A real-time multiplayer chess platform with WebSocket-based instant updates.

## Features

- ⚡ **Real-time Multiplayer Chess** - Instant move updates via WebSockets
- 🎯 **Matchmaking** - Automatic pairing by rating (Bullet, Blitz, Rapid)
- 💬 **In-Game Chat** - Real-time messaging between players
- 📊 **Rating System** - Elo-based rating with leaderboards
- 🤝 **Draw Offers** - Request and accept/decline draws

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, TypeScript, Vite, TailwindCSS |
| Backend | Node.js, Express, Socket.IO |
| Database | PostgreSQL |
| Cache | Redis |
| Deployment | Docker Compose |

---

## 🚀 Quick Start (Docker)

### Prerequisites
- Docker & Docker Compose

### Deploy Everything
```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your settings (especially for production)

# Build and start all services
docker-compose up -d --build

# Check status
docker-compose ps
```

This starts:
- **Frontend** on port `80` (nginx)
- **Backend** on port `3001` (Node.js)
- **PostgreSQL** (internal, port 5432)
- **Redis** (internal, port 6379)

Access the app at: **http://localhost**

### View Logs
```bash
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Stop
```bash
docker-compose down
```

### Reset Database
```bash
docker-compose down -v  # Removes volumes
docker-compose up -d --build
```

---

## 🛠️ Development Setup

For local development without Docker:

### 1. Start Databases Only
```bash
docker-compose up -d postgres redis
```

### 2. Start Backend
```bash
cd unified-backend
cp .env.example .env
npm install
npm run dev
```

### 3. Start Frontend
```bash
cd client
npm install
npm run dev
```

Access at: **http://localhost:8080**

---

## ⚙️ Environment Variables

### Root `.env` (for docker-compose)
```env
# Database
POSTGRES_USER=chess_user
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=chess_platform

# Security
JWT_SECRET=your_super_secret_jwt_key

# URLs (for frontend build)
VITE_API_BASE_URL=http://localhost:3001
VITE_WS_BASE_URL=http://localhost:3001

# CORS (comma-separated origins)
CORS_ORIGIN=http://localhost

# Ports
BACKEND_PORT=3001
FRONTEND_PORT=80
```

### Production Example
```env
POSTGRES_PASSWORD=super_secure_production_password
JWT_SECRET=super_secure_random_jwt_secret_at_least_32_chars
VITE_API_BASE_URL=https://api.chess.yourdomain.com
VITE_WS_BASE_URL=https://api.chess.yourdomain.com
CORS_ORIGIN=https://chess.yourdomain.com
```

---

## 📁 Project Structure

```
tsg-chess-app/
├── client/                 # React Frontend
│   ├── src/
│   │   ├── pages/         # Game, Matchmaking, Profile, Leaderboard
│   │   ├── components/    # ChessBoard, GamePanel, Sidebar
│   │   └── context/       # SocketContext (WebSocket)
│   ├── Dockerfile
│   └── nginx.conf
│
├── unified-backend/        # Node.js Backend
│   ├── src/
│   │   ├── routes/        # REST API endpoints
│   │   ├── services/      # Game logic, matchmaking, socket
│   │   └── repositories/  # PostgreSQL data access
│   ├── migrations/        # SQL schema (auto-loaded)
│   └── Dockerfile
│
├── docker-compose.yml      # Full stack deployment
└── .env.example           # Environment template
```

---

## 🔌 WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_game` | Client → Server | Join game room |
| `move` | Client → Server | Make a chess move |
| `move_made` | Server → Client | Move confirmed |
| `game_state` | Server → Client | Full game state |
| `game_over` | Server → Client | Game ended |
| `chat_message` | Bidirectional | In-game chat |
| `match_found` | Server → Client | Matchmaking success |

---

## 📊 Data Storage

| Data | Storage | Reason |
|------|---------|--------|
| Users, Ratings, History | PostgreSQL | Persistent |
| Active Games | Redis | Fast real-time |
| Matchmaking Queues | Redis | Ephemeral |
| Chat Messages | Redis (1hr TTL) | Temporary |

---

## License

MIT
