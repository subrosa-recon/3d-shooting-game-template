import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow local development, self origin, and Cloudflare tunnels
      if (!origin || 
          origin.includes('localhost') || 
          origin.includes('127.0.0.1') || 
          origin.endsWith('.trycloudflare.com')) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev, but origin-checked
      }
    },
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3001;
const MAX_ROOMS = 50;

function generateMapBoxes(sizeStr) {
  let count = 50;
  let spread = 40;

  if (sizeStr === 'large') {
    count = 150;
    spread = 100;
  } else if (sizeStr === 'small') {
    count = 20;
    spread = 20;
  }
  
  const mapBoxes = [];
  for (let i = 0; i < count; i++) {
    mapBoxes.push({
      x: (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * spread,
      rotationY: Math.random() * Math.PI
    });
  }
  return mapBoxes;
}

function checkCollision(x, z, mapBoxes) {
  const botRadius = 0.5;
  for (const box of mapBoxes) {
    const dx = x - box.x;
    const dz = z - box.z;
    const localX = dx * Math.cos(box.rotationY) + dz * Math.sin(box.rotationY);
    const localZ = -dx * Math.sin(box.rotationY) + dz * Math.cos(box.rotationY);
    if (Math.abs(localX) < 1.0 + botRadius && Math.abs(localZ) < 1.0 + botRadius) {
      return true;
    }
  }
  return false;
}

// Convert yaw angle (radians) to Quaternion for Three.js
function eulerYToQuaternion(angleY) {
  return {
    x: 0,
    y: Math.sin(angleY / 2),
    z: 0,
    w: Math.cos(angleY / 2)
  };
}

// 3D Oriented Bounding Box line segment intersection test (Liang-Barsky slab method with height check)
function lineIntersectsBox(p1, p2, box) {
  const dx1 = p1.x - box.x;
  const dz1 = p1.z - box.z;
  const dx2 = p2.x - box.x;
  const dz2 = p2.z - box.z;

  const cos = Math.cos(box.rotationY);
  const sin = Math.sin(box.rotationY);

  const lx1 = dx1 * cos + dz1 * sin;
  const lz1 = -dx1 * sin + dz1 * cos;
  const lx2 = dx2 * cos + dz2 * sin;
  const lz2 = -dx2 * sin + dz2 * cos;

  const half = 1.05; // 2x2 crate with 0.05 margin
  let t0 = 0.0;
  let t1 = 1.0;
  const dX = lx2 - lx1;
  const dZ = lz2 - lz1;

  if (Math.abs(dX) < 1e-6) {
    if (lx1 < -half || lx1 > half) return false;
  } else {
    let tMin = (-half - lx1) / dX;
    let tMax = (half - lx1) / dX;
    if (tMin > tMax) {
      const tmp = tMin; tMin = tMax; tMax = tmp;
    }
    t0 = Math.max(t0, tMin);
    t1 = Math.min(t1, tMax);
    if (t0 > t1) return false;
  }

  if (Math.abs(dZ) < 1e-6) {
    if (lz1 < -half || lz1 > half) return false;
  } else {
    let tMin = (-half - lz1) / dZ;
    let tMax = (half - lz1) / dZ;
    if (tMin > tMax) {
      const tmp = tMin; tMin = tMax; tMax = tmp;
    }
    t0 = Math.max(t0, tMin);
    t1 = Math.min(t1, tMax);
    if (t0 > t1) return false;
  }

  // 3D Height Check: crates are 2m high on ground (Y from 0.0 to 2.05)
  const y1 = p1.y !== undefined ? p1.y : 1.3;
  const y2 = p2.y !== undefined ? p2.y : 1.3;
  const yAtT0 = y1 + t0 * (y2 - y1);
  const yAtT1 = y1 + t1 * (y2 - y1);
  const minY = Math.min(yAtT0, yAtT1);
  const maxY = Math.max(yAtT0, yAtT1);

  // If ray passes strictly above the crate or below ground, line of sight is clear
  if (minY > 2.05 || maxY < 0.0) {
    return false;
  }

  return true;
}

// Line of sight test between two points in 3D
function hasLineOfSight(p1, p2, mapBoxes) {
  for (let i = 0; i < mapBoxes.length; i++) {
    if (lineIntersectsBox(p1, p2, mapBoxes[i])) {
      return false;
    }
  }
  return true;
}

// Candidate feeler angles (in radians) to probe around obstacles
const PROBE_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.2, -2.2];

function steerWithObstacleAvoidance(bot, targetX, targetZ, speed, dt, mapBoxes, preferAngleOffset = 0) {
  const dx = targetX - bot.position.x;
  const dz = targetZ - bot.position.z;
  const directDist = Math.hypot(dx, dz);
  if (directDist < 0.1) return false;

  // Base desired direction angle (-Z is forward in Three.js coordinates)
  const baseAngle = Math.atan2(-dx, -dz) + preferAngleOffset;
  const stepLen = speed * dt;
  const probeDist = Math.max(0.9, stepLen * 3.5);

  let chosenAngle = null;
  let chosenStepX = 0;
  let chosenStepZ = 0;

  for (let i = 0; i < PROBE_ANGLES.length; i++) {
    const candidateAngle = baseAngle + PROBE_ANGLES[i];
    const candStepX = -Math.sin(candidateAngle) * stepLen;
    const candStepZ = -Math.cos(candidateAngle) * stepLen;

    const nextX = bot.position.x + candStepX;
    const nextZ = bot.position.z + candStepZ;

    // Intermediate probe position ahead
    const probeX = bot.position.x - Math.sin(candidateAngle) * probeDist;
    const probeZ = bot.position.z - Math.cos(candidateAngle) * probeDist;

    if (!checkCollision(nextX, nextZ, mapBoxes) && !checkCollision(probeX, probeZ, mapBoxes)) {
      chosenAngle = candidateAngle;
      chosenStepX = candStepX;
      chosenStepZ = candStepZ;
      break;
    }
  }

  if (chosenAngle !== null) {
    bot.position.x += chosenStepX;
    bot.position.z += chosenStepZ;
    bot.facingAngle = chosenAngle;
    bot.stuckTicks = 0;
    return true;
  } else {
    // All direct probes blocked: increment stuck ticks and attempt tangential escape
    bot.stuckTicks = (bot.stuckTicks || 0) + 1;
    if (bot.stuckTicks > 6) {
      const escapeAngle = baseAngle + (Math.random() < 0.5 ? 1.57 : -1.57);
      const escStepX = -Math.sin(escapeAngle) * stepLen;
      const escStepZ = -Math.cos(escapeAngle) * stepLen;
      if (!checkCollision(bot.position.x + escStepX, bot.position.z + escStepZ, mapBoxes)) {
        bot.position.x += escStepX;
        bot.position.z += escStepZ;
        bot.facingAngle = escapeAngle;
      }
      bot.stuckTicks = 0;
    }
    return false;
  }
}

// Validation helpers
function isValidVector3(v) {
  return v && typeof v === 'object' &&
    typeof v.x === 'number' && Number.isFinite(v.x) &&
    typeof v.y === 'number' && Number.isFinite(v.y) &&
    typeof v.z === 'number' && Number.isFinite(v.z);
}

function isValidQuaternion(q) {
  return q && typeof q === 'object' &&
    typeof q.x === 'number' && Number.isFinite(q.x) &&
    typeof q.y === 'number' && Number.isFinite(q.y) &&
    typeof q.z === 'number' && Number.isFinite(q.z) &&
    typeof q.w === 'number' && Number.isFinite(q.w);
}

// In-memory data structures
const rooms = new Map(); // roomId -> { id, isPrivate, password, mapSize, maxBots, players: Map(), bots: Map() }
const socketFailedAttempts = new Map(); // socket.id -> count

// Broadcast available public rooms
const broadcastPublicRooms = () => {
  const publicRooms = [];
  for (const [id, room] of rooms.entries()) {
    if (!room.isPrivate) {
      publicRooms.push({
        id: room.id,
        mapSize: room.mapSize,
        playersCount: room.players.size,
        maxBots: room.maxBots
      });
    }
  }
  io.emit('publicRooms', publicRooms);
};

// Clean up socket from any previous room to avoid ghost players
function leaveCurrentRooms(socket) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.has(socket.id)) {
      room.players.delete(socket.id);
      socket.leave(roomId);
      if (room.players.size === 0) {
        rooms.delete(roomId);
      }
    }
  }
  broadcastPublicRooms();
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socketFailedAttempts.set(socket.id, 0);

  // Send rooms on initial connection
  broadcastPublicRooms();

  socket.on('createRoom', (data, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    if (!data || typeof data !== 'object') {
      return cb({ success: false, message: 'Invalid request data.' });
    }

    if (rooms.size >= MAX_ROOMS) {
      return cb({ success: false, message: 'Server room capacity reached. Please join an existing room.' });
    }

    // Leave any existing room first
    leaveCurrentRooms(socket);

    const allowedSizes = ['small', 'medium', 'large'];
    const mapSize = allowedSizes.includes(data.mapSize) ? data.mapSize : 'medium';
    const botCount = Math.min(20, Math.max(0, parseInt(data.botCount, 10) || 5));
    const isPrivate = data.visibility === 'private';
    const password = typeof data.password === 'string' ? data.password.substring(0, 32) : '';

    const roomId = uuidv4().substring(0, 8);
    const newRoom = {
      id: roomId,
      isPrivate,
      password,
      mapSize,
      maxBots: botCount,
      mapBoxes: generateMapBoxes(mapSize),
      players: new Map(),
      bots: new Map()
    };
    rooms.set(roomId, newRoom);
    
    // Join the creator
    socket.join(roomId);
    newRoom.players.set(socket.id, { 
      id: socket.id, 
      ready: false,
      health: 100,
      position: { x: 0, y: 5, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      lastShotTime: 0
    });
    
    broadcastPublicRooms();
    cb({ success: true, roomId, mapSize: newRoom.mapSize, mapBoxes: newRoom.mapBoxes });
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  socket.on('joinRoom', (data, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};
    if (!data || typeof data !== 'object') {
      return cb({ success: false, message: 'Invalid request data.' });
    }

    const { roomId, password } = data;
    const room = rooms.get(roomId);

    if (!room) {
      return cb({ success: false, message: 'Room not found.' });
    }

    // Brute-force protection
    const attempts = socketFailedAttempts.get(socket.id) || 0;
    if (attempts >= 5) {
      return cb({ success: false, message: 'Too many incorrect attempts. Connection throttled.' });
    }

    if (room.isPrivate) {
      const providedPass = String(password || '');
      if (room.password !== providedPass) {
        socketFailedAttempts.set(socket.id, attempts + 1);
        return cb({ success: false, message: 'Invalid password.' });
      }
    }

    // Clear failed attempts on success
    socketFailedAttempts.set(socket.id, 0);

    // Leave any existing room first
    leaveCurrentRooms(socket);

    socket.join(roomId);
    room.players.set(socket.id, { 
      id: socket.id, 
      ready: false,
      health: 100,
      position: { x: 0, y: 5, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      lastShotTime: 0
    });
    
    broadcastPublicRooms();
    cb({ success: true, roomId, mapSize: room.mapSize, mapBoxes: room.mapBoxes });
    console.log(`Client ${socket.id} joined room: ${roomId}`);
  });

  socket.on('joinPublic', (data, callback) => {
    const cb = typeof callback === 'function' ? callback : () => {};

    // Leave any existing room first
    leaveCurrentRooms(socket);

    // Find first available public room with space
    let targetRoom = null;
    for (const [id, room] of rooms.entries()) {
      if (!room.isPrivate && room.players.size < 16) {
        targetRoom = room;
        break;
      }
    }

    if (targetRoom) {
      socket.join(targetRoom.id);
      targetRoom.players.set(socket.id, { 
        id: socket.id, 
        ready: false,
        health: 100,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        lastShotTime: 0
      });
      broadcastPublicRooms();
      cb({ success: true, roomId: targetRoom.id, mapSize: targetRoom.mapSize, mapBoxes: targetRoom.mapBoxes });
    } else {
      if (rooms.size >= MAX_ROOMS) {
        return cb({ success: false, message: 'Server room capacity reached.' });
      }

      const roomId = uuidv4().substring(0, 8);
      const newRoom = {
        id: roomId,
        isPrivate: false,
        password: '',
        mapSize: 'medium',
        maxBots: 5,
        mapBoxes: generateMapBoxes('medium'),
        players: new Map(),
        bots: new Map()
      };
      rooms.set(roomId, newRoom);
      socket.join(roomId);
      newRoom.players.set(socket.id, { 
        id: socket.id, 
        ready: false,
        health: 100,
        position: { x: 0, y: 5, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        lastShotTime: 0
      });
      broadcastPublicRooms();
      cb({ success: true, roomId, mapSize: newRoom.mapSize, mapBoxes: newRoom.mapBoxes });
    }
  });

  socket.on('playerState', (data) => {
    if (!data || typeof data !== 'object') return;
    const { roomId, position, quaternion } = data;
    if (!isValidVector3(position) || !isValidQuaternion(quaternion)) return;

    const room = rooms.get(roomId);
    if (room && room.players.has(socket.id)) {
      const player = room.players.get(socket.id);
      player.position = position;
      player.quaternion = quaternion;
    }
  });

  socket.on('shoot', (data) => {
    if (!data || typeof data !== 'object') return;
    const { roomId, hitPlayerId, hitPoint } = data;
    const room = rooms.get(roomId);
    if (!room || !room.players.has(socket.id)) return;

    const shooter = room.players.get(socket.id);
    if (!shooter || shooter.health <= 0) return;

    // Server-side fire rate limit: minimum 90ms between shots (~11 shots/sec)
    const now = Date.now();
    if (shooter.lastShotTime && (now - shooter.lastShotTime < 90)) {
      return;
    }
    shooter.lastShotTime = now;

    // Broadcast player shot to ALL clients in the room so tracers render for everyone
    const validHitPoint = isValidVector3(hitPoint) ? hitPoint : null;
    io.to(roomId).emit('playerShoot', {
      shooterId: socket.id,
      hitPoint: validHitPoint
    });

    if (hitPlayerId) {
      if (room.players.has(hitPlayerId)) {
        const target = room.players.get(hitPlayerId);
        // Distance check: ensure target is within reasonable gunshot range (85m)
        const dist = Math.hypot(shooter.position.x - target.position.x, shooter.position.z - target.position.z);
        if (dist <= 85) {
          target.health -= 25;
          
          if (target.health <= 0) {
            target.health = 100;
            target.position = { x: (Math.random() - 0.5) * 20, y: 5, z: (Math.random() - 0.5) * 20 };
            io.to(target.id).emit('respawn', target.position);
          }
        }
      } else if (room.bots.has(hitPlayerId)) {
        const bot = room.bots.get(hitPlayerId);
        const dist = Math.hypot(shooter.position.x - bot.position.x, shooter.position.z - bot.position.z);
        if (dist <= 85) {
          bot.health -= 25;
          
          if (bot.health <= 0) {
            bot.health = 100;
            bot.position = { x: (Math.random() - 0.5) * 40, y: 1.3, z: (Math.random() - 0.5) * 40 };
            bot.state = 'wander';
            bot.targetPlayerId = null;
            bot.lastKnownPlayerPos = null;
          } else {
            // Retaliate against the shooter!
            bot.state = 'combat';
            bot.targetPlayerId = shooter.id;
            bot.lastKnownPlayerPos = { x: shooter.position.x, y: shooter.position.y, z: shooter.position.z };
            bot.reactionDelayUntil = 0;
            bot.strafeDir = Math.random() < 0.5 ? 1 : -1;

            // Alert nearby squad bots within 25m to converge on shooter
            for (const [otherId, otherBot] of room.bots.entries()) {
              if (otherId !== bot.id && otherBot.state === 'wander') {
                const d = Math.hypot(otherBot.position.x - bot.position.x, otherBot.position.z - bot.position.z);
                if (d < 25) {
                  otherBot.state = 'investigate';
                  otherBot.lastKnownPlayerPos = { x: shooter.position.x, y: shooter.position.y, z: shooter.position.z };
                }
              }
            }
          }
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    socketFailedAttempts.delete(socket.id);
    leaveCurrentRooms(socket);
  });
});

function updateBots(room) {
  const now = Date.now();
  const dt = 0.05; // 50ms per tick (20fps)

  // 1. Spawn bots if needed
  if (room.bots.size < room.maxBots) {
    const botId = `bot-${uuidv4().substring(0, 4)}`;
    const spawnX = (Math.random() - 0.5) * 40;
    const spawnZ = (Math.random() - 0.5) * 40;
    if (!checkCollision(spawnX, spawnZ, room.mapBoxes)) {
      room.bots.set(botId, {
        id: botId,
        health: 100,
        position: { x: spawnX, y: 1.3, z: spawnZ },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        state: 'wander',
        targetPos: null,
        targetPlayerId: null,
        lastKnownPlayerPos: null,
        investigateTimer: 0,
        lastShotTime: 0,
        reactionDelayUntil: 0,
        strafeDir: Math.random() < 0.5 ? 1 : -1,
        nextStrafeChange: now + 1500 + Math.random() * 2000,
        facingAngle: 0,
        stuckTicks: 0
      });
    }
  }

  // 2. Update each bot
  for (const [botId, bot] of room.bots.entries()) {
    let visiblePlayer = null;
    let closestPlayerDist = Infinity;

    // Scan for players with line of sight in 3D
    for (const [playerId, player] of room.players.entries()) {
      if (player.health <= 0) continue;
      const dx = player.position.x - bot.position.x;
      const dz = player.position.z - bot.position.z;
      const dist = Math.hypot(dx, dz);

      // Detection range 30m with 3D Line-of-Sight verification
      if (dist < 30 && hasLineOfSight(bot.position, player.position, room.mapBoxes)) {
        if (dist < closestPlayerDist) {
          closestPlayerDist = dist;
          visiblePlayer = player;
        }
      }
    }

    // State transitions
    if (visiblePlayer) {
      if (bot.state !== 'combat' || bot.targetPlayerId !== visiblePlayer.id) {
        bot.reactionDelayUntil = now + 350 + Math.random() * 250; // Human-like reaction delay
      }
      bot.state = 'combat';
      bot.targetPlayerId = visiblePlayer.id;
      bot.lastKnownPlayerPos = {
        x: visiblePlayer.position.x,
        y: visiblePlayer.position.y,
        z: visiblePlayer.position.z
      };
    } else {
      if (bot.state === 'combat') {
        // Player broke line of sight: stalk to last known position
        bot.state = 'investigate';
        bot.targetPlayerId = null;
        bot.investigateTimer = 0;
      }
    }

    // Execute state behavior
    if (bot.state === 'combat') {
      const targetPlayer = (bot.targetPlayerId ? room.players.get(bot.targetPlayerId) : null) || visiblePlayer;
      if (!targetPlayer || targetPlayer.health <= 0) {
        bot.state = 'wander';
        bot.targetPlayerId = null;
        continue;
      }

      const dx = targetPlayer.position.x - bot.position.x;
      const dz = targetPlayer.position.z - bot.position.z;
      const dist = Math.hypot(dx, dz);

      // Aiming: Orient bot to face the target player directly
      const aimAngle = Math.atan2(-dx, -dz);
      bot.facingAngle = aimAngle;
      bot.quaternion = eulerYToQuaternion(aimAngle);

      // Periodically switch strafe direction
      if (now > bot.nextStrafeChange) {
        bot.strafeDir *= -1;
        bot.nextStrafeChange = now + 1500 + Math.random() * 2000;
      }

      // Tactical combat spacing
      if (dist > 14) {
        // Close the distance using obstacle avoidance
        steerWithObstacleAvoidance(bot, targetPlayer.position.x, targetPlayer.position.z, 5.0, dt, room.mapBoxes, 0);
      } else if (dist < 5.0) {
        // Too close: back up away from player
        const retreatX = bot.position.x - dx;
        const retreatZ = bot.position.z - dz;
        steerWithObstacleAvoidance(bot, retreatX, retreatZ, 4.0, dt, room.mapBoxes, 0);
      } else {
        // Sweet spot (5m - 14m): Circle-strafe laterally
        const strafeOffset = bot.strafeDir * 1.35;
        steerWithObstacleAvoidance(bot, targetPlayer.position.x, targetPlayer.position.z, 4.2, dt, room.mapBoxes, strafeOffset);
      }
      bot.quaternion = eulerYToQuaternion(aimAngle);

      // Shooting logic (burst fire with distance falloff accuracy)
      const burstCadence = 600 + Math.random() * 400;
      if (now > bot.reactionDelayUntil && now - bot.lastShotTime > burstCadence) {
        if (hasLineOfSight(bot.position, targetPlayer.position, room.mapBoxes)) {
          bot.lastShotTime = now;

          const hitChance = Math.max(0.35, 0.85 - (dist / 30) * 0.45);
          const isHit = Math.random() < hitChance;

          let shootTargetPos;
          if (isHit) {
            const damage = Math.floor(10 + Math.random() * 6);
            targetPlayer.health -= damage;
            shootTargetPos = {
              x: targetPlayer.position.x,
              y: targetPlayer.position.y + 0.3,
              z: targetPlayer.position.z
            };

            if (targetPlayer.health <= 0) {
              targetPlayer.health = 100;
              targetPlayer.position = { x: (Math.random() - 0.5) * 20, y: 5, z: (Math.random() - 0.5) * 20 };
              io.to(targetPlayer.id).emit('respawn', targetPlayer.position);
            }
          } else {
            // Near-miss spread
            const missAngle = Math.random() * Math.PI * 2;
            const missDist = 1.2 + Math.random() * 1.4;
            shootTargetPos = {
              x: targetPlayer.position.x + Math.cos(missAngle) * missDist,
              y: targetPlayer.position.y + (Math.random() - 0.5) * 0.8,
              z: targetPlayer.position.z + Math.sin(missAngle) * missDist
            };
          }

          io.to(room.id).emit('botShoot', {
            botId: bot.id,
            targetId: targetPlayer.id,
            targetPos: shootTargetPos
          });
        }
      }

    } else if (bot.state === 'investigate') {
      if (!bot.lastKnownPlayerPos) {
        bot.state = 'wander';
        continue;
      }

      const distToLast = Math.hypot(
        bot.lastKnownPlayerPos.x - bot.position.x,
        bot.lastKnownPlayerPos.z - bot.position.z
      );

      if (distToLast > 2.0) {
        steerWithObstacleAvoidance(bot, bot.lastKnownPlayerPos.x, bot.lastKnownPlayerPos.z, 4.6, dt, room.mapBoxes, 0);
        bot.quaternion = eulerYToQuaternion(bot.facingAngle);
      } else {
        // Arrived at last known spot: scan around for 2.5s
        bot.investigateTimer += dt;
        const scanAngle = bot.investigateTimer * 2.8;
        bot.quaternion = eulerYToQuaternion(scanAngle);

        if (bot.investigateTimer > 2.5) {
          bot.state = 'wander';
          bot.lastKnownPlayerPos = null;
        }
      }

    } else if (bot.state === 'wander') {
      if (!bot.targetPos) {
        bot.targetPos = {
          x: (Math.random() - 0.5) * 40,
          z: (Math.random() - 0.5) * 40
        };
      }

      const distToTarget = Math.hypot(
        bot.targetPos.x - bot.position.x,
        bot.targetPos.z - bot.position.z
      );

      if (distToTarget < 1.5) {
        bot.targetPos = null;
      } else {
        const moved = steerWithObstacleAvoidance(bot, bot.targetPos.x, bot.targetPos.z, 3.2, dt, room.mapBoxes, 0);
        bot.quaternion = eulerYToQuaternion(bot.facingAngle);
        if (!moved) {
          bot.targetPos = null;
        }
      }
    }
  }
}

// Broadcast game state at 20fps
setInterval(() => {
  for (const [roomId, room] of rooms.entries()) {
    if (room.players.size > 0) {
      updateBots(room);
      const state = {
        players: Object.fromEntries(room.players),
        bots: Object.fromEntries(room.bots)
      };
      io.to(roomId).emit('gameState', state);
    }
  }
}, 50);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
