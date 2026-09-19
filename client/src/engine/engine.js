import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { setupControls, updateControls, startGameControls } from './controls.js';
import { initNetwork, sendPlayerState, socket } from '../network/network.js';
import { generateMap, collidableMeshes } from './environment.js';
import { initShooting } from './shooting.js';

export let scene, camera, renderer, world;
let lastTime;
let animFrameId = null;
let listenersInitialized = false;

export function initEngine(sock, roomId, mapSize, mapBoxes) {
  console.log('Initializing Three.js and Cannon-es engine...');

  // Cancel any running animation loop
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // --- Three.js Setup ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Sky blue
  scene.fog = new THREE.Fog(0x87ceeb, 0, 150);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  
  // Reuse existing WebGLRenderer or create a single canvas
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);
  } else {
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(100, 100, 50);
  directionalLight.castShadow = true;
  directionalLight.shadow.camera.left = -50;
  directionalLight.shadow.camera.right = 50;
  directionalLight.shadow.camera.top = 50;
  directionalLight.shadow.camera.bottom = -50;
  scene.add(directionalLight);

  // --- Cannon-es Setup ---
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  world.defaultContactMaterial.friction = 0.0;

  // Ground Material (to prevent sliding/bouncing issues later)
  const physicsMaterial = new CANNON.Material('standard');
  const physicsContactMaterial = new CANNON.ContactMaterial(
    physicsMaterial,
    physicsMaterial,
    { friction: 0.0, restitution: 0.0 }
  );
  world.addContactMaterial(physicsContactMaterial);

  // --- Ground Plane ---
  // Three.js visual ground
  const groundGeo = new THREE.PlaneGeometry(300, 300);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Cannon-es physical ground
  const groundBody = new CANNON.Body({
    mass: 0, // static
    shape: new CANNON.Plane(),
    material: physicsMaterial
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // --- Environment Map & Boundaries ---
  generateMap(scene, world, mapSize, mapBoxes);

  // --- Player Setup ---
  setupControls(camera, world, scene);

  // --- Network Setup ---
  initNetwork(sock, scene, roomId);
  initShooting(scene, sock, roomId);

  // Handle Resize and Fullscreen/Orientation changes (attached once)
  if (!listenersInitialized) {
    listenersInitialized = true;
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(onWindowResize, 100);
      setTimeout(onWindowResize, 300);
    });
    document.addEventListener('fullscreenchange', () => {
      setTimeout(onWindowResize, 50);
      setTimeout(onWindowResize, 200);
    });
    document.addEventListener('webkitfullscreenchange', () => {
      setTimeout(onWindowResize, 50);
      setTimeout(onWindowResize, 200);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onWindowResize);
    }
  }

  // Start Loop
  lastTime = performance.now();
  animFrameId = requestAnimationFrame(animate);

  // Start controls
  startGameControls();
}

export function onWindowResize() {
  if (!camera || !renderer) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function animate(time) {
  animFrameId = requestAnimationFrame(animate);

  const delta = Math.min((time - lastTime) / 1000, 0.1); // Cap delta to prevent physics explosion on tab-switch
  lastTime = time;

  // Step physics world
  if (world) {
    world.step(1 / 60, delta, 3);
  }

  // Update controls/player physics
  updateControls(delta);

  // Sync state to network
  if (camera) {
    sendPlayerState(camera.position, camera.quaternion);
  }

  // Render scene
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}
