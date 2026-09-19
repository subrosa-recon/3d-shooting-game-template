# 3D Multiplayer WebGL FPS Game

A real-time, browser-based 3D Multiplayer First-Person Shooter built with **Three.js**, **Cannon-es** physics, **Socket.io**, and **Vite**. Features tactical AI enemy bots, cross-platform mobile touch controls, full-screen phone support, and internet multiplayer via Cloudflare Quick Tunnels.

---

## 🎮 Features

- **Real-Time Multiplayer:** Instant room-based multiplayer powered by Socket.io with public lobbies and password-protected private rooms.
- **Smart Tactical AI Bots:** Autonomous server-authoritative AI opponents featuring:
  - 3D height-aware line-of-sight target detection.
  - Multi-state behaviors: *Wander*, *Investigate* (tracking last known player locations), and *Combat* (tactical circle-strafing, spacing, and burst firing).
  - Squad alert system: bots alert nearby squad members when attacked.
- **Cross-Platform Controls:**
  - **PC / Desktop:** Standard WASD movement, mouse look with Pointer Lock API, and left-click fire.
  - **Mobile Phones & Tablets:** Dual-zone on-screen touch controls (floating joystick, look zone, dedicated FIRE button with drag-to-aim, and JUMP button).
- **Mobile Fullscreen & Responsive Display:** One-tap Fullscreen Toggle supporting native Fullscreen API (Android/Desktop) and Virtual Fullscreen fallback (iOS Safari / WebViews) with automatic screen adjustment.
- **Fair Air Physics:** Realistic momentum conservation while airborne prevents instant mid-air direction snapping and eliminates bunny-hop wall-climb glitches.
- **Visible Multiplayer Bullet Tracers:** Weapon tracers rendered in real time for both players and bots.
- **Map Boundaries:** Procedurally generated cover with invisible perimeter boundaries to keep combat contained.
- **Hardened Security & Stability:**
  - Server-authoritative combat validation and fire-rate throttling (anti-cheat).
  - Safe payload parsing to prevent unhandled crash vectors (DoS protection).
  - Sanitized DOM rendering in lobby (Stored XSS mitigation).
  - DNS rebinding prevention and memory leak elimination across game sessions.

---

## 🕹️ Controls Guide

### Desktop Controls
| Input | Action |
| :--- | :--- |
| **W, A, S, D** | Move Forward / Left / Backward / Right |
| **Spacebar** | Jump |
| **Mouse Move** | Aim / Look (click screen to lock cursor) |
| **Left Click** | Shoot weapon |
| **Esc** | Unlock mouse cursor |

### Mobile Touch Controls
| Control | Action |
| :--- | :--- |
| **Left Screen Zone** | Floating dynamic virtual movement joystick |
| **Right Screen Zone** | Drag to look around and aim |
| **FIRE Button** | Tap for single shot, hold to spray, drag to aim while firing |
| **JUMP Button** | Jump |
| **Fullscreen Icon** | Enter / exit full screen (top-right corner) |

---

## 📋 Requirements

- [Node.js](https://nodejs.org/) (v18+ recommended, v16+ minimum)
- npm (bundled with Node.js)

---

## 🚀 How to Run Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development environment:**
   ```bash
   npm run dev
   ```
   *This starts the Node.js game server (`port 3001`), the Vite frontend dev server (`port 3000`), and Cloudflare Quick Tunnels concurrently.*

3. **Play in your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## 🌐 Playing with Friends over the Internet (Cloudflare Tunnels)

The project includes built-in support for Cloudflare Quick Tunnels, allowing you to host multiplayer matches without port forwarding:

1. Place the official `cloudflared` binary (`cloudflared.exe` on Windows) in the project root directory (or install it via package manager: `winget install Cloudflare.cloudflared` / `brew install cloudflared`).
2. Run:
   ```bash
   npm run dev
   ```
3. Look at your terminal output for the public tunnel URL (e.g., `https://xyz.trycloudflare.com`).
4. Share the URL with friends—they can join directly from their desktop or mobile browsers.

---

## 🛠️ Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs server, client, and tunnel concurrently |
| `npm run dev:server` | Starts the Node.js backend server with hot-reload (`nodemon`) |
| `npm run dev:client` | Starts the Vite client dev server (`http://localhost:3000`) |
| `npm run dev:tunnel` | Starts only the Cloudflare Quick Tunnel |
| `npm run build` | Builds optimized production bundle in `/dist` |

---

## 🏗️ Project Architecture

```
├── client/
│   ├── index.html            # Main HTML with HUD, Lobby, and Mobile Touch UI
│   ├── style.css             # Responsive styling & HUD themes
│   └── src/
│       ├── main.js           # Lobby UI, room management, and game start logic
│       ├── engine/
│       │   ├── engine.js     # Three.js scene, Cannon-es physics loop, renderer
│       │   ├── controls.js   # Desktop & touch input handlers, momentum physics
│       │   ├── shooting.js   # Weapon firing, raycasting, bullet tracer pooling
│       │   └── environment.js# Procedural crates and boundary walls
│       ├── network/
│       │   └── network.js    # Multiplayer state synchronization & tracers
│       └── ui/
│           └── fullscreen.js # Responsive fullscreen & orientation manager
├── server/
│   └── server.js             # Authoritative Socket.io server & Smart AI bot loop
├── vite.config.js            # Vite config with WebSocket proxy and host security
└── package.json              # Project dependencies and startup scripts
```
