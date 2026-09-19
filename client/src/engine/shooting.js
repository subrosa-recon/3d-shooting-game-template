import * as THREE from 'three';
import { collidableMeshes } from './environment.js';
import { otherPlayers } from '../network/network.js';

let scene;
let socket;
let currentRoomId;

// Bullet line object pooling
const maxBullets = 20;
const bulletPool = [];
let bulletIndex = 0;
let ammo = 30;

let isReloading = false;
let lastLocalShotTime = 0;
const CLIENT_FIRE_RATE_MS = 110; // Enforce fire rate on both desktop and mobile

export function initShooting(sc, s, roomId) {
  scene = sc;
  socket = s;
  currentRoomId = roomId;
  ammo = 30;
  isReloading = false;
  lastLocalShotTime = 0;
  const ammoBar = document.getElementById('ammo-bar');
  if (ammoBar) ammoBar.innerText = `Ammo: ${ammo} / 30`;

  // Only initialize bullet pool once to avoid scene leaks
  if (bulletPool.length === 0) {
    const material = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    for (let i = 0; i < maxBullets; i++) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
      ]);
      const line = new THREE.Line(geometry, material);
      line.visible = false;
      scene.add(line);
      bulletPool.push(line);
    }
  } else {
    // Re-attach existing pool to the active scene if needed
    for (let i = 0; i < bulletPool.length; i++) {
      const line = bulletPool[i];
      line.visible = false;
      if (!scene.children.includes(line)) {
        scene.add(line);
      }
    }
  }
}

export function shoot(camera) {
  if (!socket || !scene || isReloading) return;

  const now = performance.now();
  if (now - lastLocalShotTime < CLIENT_FIRE_RATE_MS) {
    return; // Rate limited
  }

  if (ammo <= 0) {
    isReloading = true;
    const ammoBar = document.getElementById('ammo-bar');
    if (ammoBar) ammoBar.innerText = 'Reloading...';
    setTimeout(() => {
      ammo = 30;
      isReloading = false;
      if (ammoBar) ammoBar.innerText = `Ammo: ${ammo} / 30`;
    }, 1000); // 1 second reload
    return;
  }

  lastLocalShotTime = now;
  ammo--;
  const ammoBar = document.getElementById('ammo-bar');
  if (ammoBar) ammoBar.innerText = `Ammo: ${ammo} / 30`;

  // Set up Raycaster from center of screen
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  const startPos = camera.position.clone();
  startPos.y -= 0.1; // adjust starting slightly down to look like it comes from weapon

  // Test against environment
  const envIntersects = raycaster.intersectObjects(collidableMeshes, true);
  
  // Test against players
  const playerMeshes = Array.from(otherPlayers.values());
  const playerIntersects = raycaster.intersectObjects(playerMeshes, true);

  let hitPoint = raycaster.ray.at(100, new THREE.Vector3()); // default distance 100
  let hitPlayerId = null;

  // Determine closest hit
  let closestDist = Infinity;

  if (envIntersects.length > 0) {
    closestDist = envIntersects[0].distance;
    hitPoint.copy(envIntersects[0].point);
  }

  if (playerIntersects.length > 0) {
    if (playerIntersects[0].distance < closestDist) {
      closestDist = playerIntersects[0].distance;
      hitPoint.copy(playerIntersects[0].point);
      
      // Find which player we hit
      for (const [id, mesh] of otherPlayers.entries()) {
        if (mesh === playerIntersects[0].object || (mesh.children && mesh.children.includes(playerIntersects[0].object))) {
          hitPlayerId = id;
          break;
        }
      }
    }
  }

  // Draw tracer locally
  drawBulletTracer(startPos, hitPoint);

  // Send event
  socket.emit('shoot', {
    roomId: currentRoomId,
    hitPoint: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
    hitPlayerId
  });
}

export function drawBulletTracer(start, end) {
  if (bulletPool.length === 0) return;
  const line = bulletPool[bulletIndex];
  bulletIndex = (bulletIndex + 1) % maxBullets;

  const positions = line.geometry.attributes.position.array;
  positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
  positions[3] = end.x;   positions[4] = end.y;   positions[5] = end.z;
  
  line.geometry.attributes.position.needsUpdate = true;
  line.geometry.computeBoundingSphere(); // Important for frustum culling
  line.visible = true;

  // Hide after a short time
  setTimeout(() => {
    line.visible = false;
  }, 100);
}
