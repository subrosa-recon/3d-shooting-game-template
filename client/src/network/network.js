import * as THREE from 'three';
import { resetPlayerPosition } from '../engine/controls.js';
import { drawBulletTracer } from '../engine/shooting.js';

export let socket;
let scene;
let currentRoomId;
export const otherPlayers = new Map();

// Capsule Geometry for other players and bots
const geometry = new THREE.CapsuleGeometry(0.5, 1.6, 4, 8);
const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const botMaterial = new THREE.MeshStandardMaterial({ color: 0x2244ff }); // Vibrant blue for bots

function createBotMesh() {
  const mesh = new THREE.Mesh(geometry, botMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Red glowing tactical eye/visor facing forward (-Z)
  const visorGeom = new THREE.BoxGeometry(0.44, 0.14, 0.2);
  const visorMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  const visor = new THREE.Mesh(visorGeom, visorMat);
  visor.position.set(0, 0.42, -0.42);
  mesh.add(visor);

  // Bot Weapon pointing forward along -Z
  const gunGeom = new THREE.BoxGeometry(0.12, 0.14, 0.65);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f1f2e, metalness: 0.7, roughness: 0.3 });
  const gun = new THREE.Mesh(gunGeom, gunMat);
  gun.position.set(0.32, 0.0, -0.45);
  mesh.add(gun);

  return mesh;
}

function createPlayerMesh() {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Cyan glowing visor facing forward (-Z)
  const visorGeom = new THREE.BoxGeometry(0.44, 0.14, 0.2);
  const visorMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
  const visor = new THREE.Mesh(visorGeom, visorMat);
  visor.position.set(0, 0.42, -0.42);
  mesh.add(visor);

  // Weapon pointing forward along -Z
  const gunGeom = new THREE.BoxGeometry(0.12, 0.14, 0.65);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f1f2e, metalness: 0.7, roughness: 0.3 });
  const gun = new THREE.Mesh(gunGeom, gunMat);
  gun.position.set(0.32, 0.0, -0.45);
  mesh.add(gun);

  return mesh;
}

export function initNetwork(s, sc, roomId) {
  socket = s;
  scene = sc;
  currentRoomId = roomId;

  // Clean up any stale player meshes from prior session
  for (const mesh of otherPlayers.values()) {
    if (scene) scene.remove(mesh);
  }
  otherPlayers.clear();

  // Clear previous listeners to prevent duplicates
  socket.off('gameState');
  socket.off('respawn');
  socket.off('botShoot');
  socket.off('playerShoot');

  // Listen for state updates from the server
  socket.on('gameState', (state) => {
    if (!state || !state.players) return;
    const activeIds = new Set();

    // Sync Players
    for (const [id, data] of Object.entries(state.players)) {
      if (id === socket.id) continue; // Skip self
      activeIds.add(id);

      if (!otherPlayers.has(id)) {
        const mesh = createPlayerMesh();
        scene.add(mesh);
        otherPlayers.set(id, mesh);
      }

      // Update position and rotation
      const mesh = otherPlayers.get(id);
      if (data.position && data.quaternion) {
        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
      }
    }

    // Sync Bots
    for (const [id, data] of Object.entries(state.bots || {})) {
      activeIds.add(id);

      if (!otherPlayers.has(id)) {
        const mesh = createBotMesh();
        scene.add(mesh);
        otherPlayers.set(id, mesh);
      }

      const mesh = otherPlayers.get(id);
      if (data.position && data.quaternion) {
        mesh.position.set(data.position.x, data.position.y, data.position.z);
        mesh.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
      }
    }

    // Remove players/bots that disconnected/died
    for (const id of otherPlayers.keys()) {
      if (!activeIds.has(id)) {
        scene.remove(otherPlayers.get(id));
        otherPlayers.delete(id);
      }
    }

    // Update local HUD based on our own state
    const me = state.players[socket.id];
    if (me) {
      const healthBar = document.getElementById('health-bar');
      if (healthBar) healthBar.innerText = `Health: ${me.health}`;
    }
  });

  socket.on('respawn', (pos) => {
    resetPlayerPosition(pos);
  });

  socket.on('botShoot', (data) => {
    if (!data) return;
    const { botId, targetPos } = data;
    const botMesh = otherPlayers.get(botId);
    if (botMesh && targetPos) {
      const startPos = botMesh.position.clone();
      startPos.y += 0.5; // From mid-height
      drawBulletTracer(startPos, new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z));
    }
  });

  // Render other human player bullet tracers
  socket.on('playerShoot', (data) => {
    if (!data || data.shooterId === socket.id) return; // Self is drawn immediately on client
    const shooterMesh = otherPlayers.get(data.shooterId);
    if (shooterMesh && data.hitPoint) {
      const startPos = shooterMesh.position.clone();
      startPos.y += 0.5;
      drawBulletTracer(startPos, new THREE.Vector3(data.hitPoint.x, data.hitPoint.y, data.hitPoint.z));
    }
  });
}

// Called every frame from engine.js
export function sendPlayerState(position, quaternion) {
  if (!socket || !currentRoomId) return;

  socket.emit('playerState', {
    roomId: currentRoomId,
    position: { x: position.x, y: position.y, z: position.z },
    quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }
  });
}
