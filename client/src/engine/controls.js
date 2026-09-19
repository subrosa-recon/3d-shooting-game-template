import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { shoot } from './shooting.js';

// State
let camera, world, playerBody, scene;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false;
let isLocked = false;
let isGameActive = false;
let controlsInitialized = false;

// Config
const speed = 15;
const jumpForce = 8;
const playerRadius = 0.5;
const playerHeight = 1.6;

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const inputVelocity = new THREE.Vector3();

// --- Mobile state ---
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let touchMoveId = null;
let touchLookId = null;
let touchShootId = null;
let touchMoveOrigin = { x: 0, y: 0 };
let touchMoveVector = { x: 0, y: 0 }; 
let lastTouchLook = { x: 0, y: 0 };
let lastTouchShoot = { x: 0, y: 0 };
let shootInterval = null;
const FIRE_RATE_MS = 130;

function startFiring() {
  if (!isGameActive) return;
  shoot(camera);
  if (!shootInterval) {
    shootInterval = setInterval(() => {
      if (isGameActive) {
        shoot(camera);
      } else {
        stopFiring();
      }
    }, FIRE_RATE_MS);
  }
}

function stopFiring() {
  if (shootInterval) {
    clearInterval(shootInterval);
    shootInterval = null;
  }
}

window.addEventListener('blur', () => {
  if (touchShootId !== null) {
    touchShootId = null;
    const btnShoot = document.getElementById('btn-shoot');
    if (btnShoot) btnShoot.classList.remove('firing');
    stopFiring();
  }
});

export function setupControls(cam, physicsWorld, threeScene) {
  camera = cam;
  world = physicsWorld;
  scene = threeScene;

  // Clean up any old body
  if (playerBody && world && world.bodies.includes(playerBody)) {
    world.removeBody(playerBody);
  }

  // --- Player Physics Body ---
  const shape = new CANNON.Cylinder(playerRadius, playerRadius, playerHeight, 12);
  playerBody = new CANNON.Body({ mass: 75 });
  playerBody.addShape(shape);
  playerBody.position.set(0, 5, 0); 
  playerBody.fixedRotation = true;
  playerBody.updateMassProperties();
  world.addBody(playerBody);

  // Initialize input handlers once
  if (!controlsInitialized) {
    controlsInitialized = true;
    setupDesktopControls();
    setupTouchControls();
  }
}

function setupDesktopControls() {
  const clickHandler = () => {
    if (isGameActive && !isLocked) {
      document.body.requestPointerLock();
    }
  };
  
  document.body.addEventListener('click', clickHandler);

  document.addEventListener('mousedown', (e) => {
    if (isGameActive && isLocked && e.button === 0) shoot(camera);
  });

  document.addEventListener('pointerlockchange', () => {
    isLocked = (document.pointerLockElement === document.body);
  });

  document.addEventListener('mousemove', (event) => {
    if (!isLocked) return;
    handleCameraRotation(event.movementX || 0, event.movementY || 0);
  });

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': moveForward = true; break;
      case 'KeyS': moveBackward = true; break;
      case 'KeyA': moveLeft = true; break;
      case 'KeyD': moveRight = true; break;
      case 'Space': triggerJump(); break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': moveForward = false; break;
      case 'KeyS': moveBackward = false; break;
      case 'KeyA': moveLeft = false; break;
      case 'KeyD': moveRight = false; break;
    }
  });
}

function handleCameraRotation(movementX, movementY, sensitivity = 0.002) {
  euler.setFromQuaternion(camera.quaternion);
  euler.y -= movementX * sensitivity;
  euler.x -= movementY * sensitivity;
  euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
  camera.quaternion.setFromEuler(euler);
}

function triggerJump() {
  if (canJump) {
    playerBody.velocity.y = jumpForce;
    canJump = false;
  }
}

function setupTouchControls() {
  const moveZone = document.getElementById('touch-move-zone');
  const lookZone = document.getElementById('touch-look-zone');
  const btnJump = document.getElementById('btn-jump');
  const btnShoot = document.getElementById('btn-shoot');
  const joystickBase = document.getElementById('joystick-move');
  const joystickThumb = joystickBase ? joystickBase.querySelector('.joystick-thumb') : null;

  // --- Shoot Button (Tap, Hold to Spray, Drag to Aim) ---
  if (btnShoot) {
    btnShoot.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (touchShootId !== null) return;

      const touch = e.changedTouches[0];
      touchShootId = touch.identifier;
      lastTouchShoot = { x: touch.clientX, y: touch.clientY };
      btnShoot.classList.add('firing');
      startFiring();
    }, { passive: false });

    // Desktop/Testing mouse support for the shoot button
    btnShoot.addEventListener('mousedown', (e) => {
      e.preventDefault();
      btnShoot.classList.add('firing');
      startFiring();

      const onMouseMove = (moveEvt) => {
        handleCameraRotation(moveEvt.movementX, moveEvt.movementY, 0.003);
      };

      const onMouseUp = () => {
        btnShoot.classList.remove('firing');
        stopFiring();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // Window-level tracking for Shoot Drag-to-Aim & Release
  window.addEventListener('touchmove', (e) => {
    if (touchShootId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === touchShootId) {
        const deltaX = touch.clientX - lastTouchShoot.x;
        const deltaY = touch.clientY - lastTouchShoot.y;
        lastTouchShoot = { x: touch.clientX, y: touch.clientY };
        handleCameraRotation(deltaX, deltaY, 0.005);
      }
    }
  }, { passive: false });

  const endShootTouch = (e) => {
    if (touchShootId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchShootId) {
        touchShootId = null;
        if (btnShoot) btnShoot.classList.remove('firing');
        stopFiring();
      }
    }
  };
  window.addEventListener('touchend', endShootTouch);
  window.addEventListener('touchcancel', endShootTouch);

  // Jump Button
  if (btnJump) {
    btnJump.addEventListener('touchstart', (e) => {
      e.preventDefault();
      triggerJump();
    }, { passive: false });

    btnJump.addEventListener('mousedown', (e) => {
      e.preventDefault();
      triggerJump();
    });
  }

  // Move Zone (Left)
  if (moveZone && joystickBase && joystickThumb) {
    moveZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchMoveId !== null) return; 
      
      const touch = e.changedTouches[0];
      touchMoveId = touch.identifier;
      touchMoveOrigin = { x: touch.clientX, y: touch.clientY };
      
      joystickBase.classList.remove('hidden');
      joystickBase.style.left = `${touch.clientX}px`;
      joystickBase.style.top = `${touch.clientY}px`;
      joystickThumb.style.transform = `translate(-50%, -50%)`;
    }, { passive: false });

    moveZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (touchMoveId === null) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchMoveId) {
          const deltaX = touch.clientX - touchMoveOrigin.x;
          const deltaY = touch.clientY - touchMoveOrigin.y;
          
          // Max radius for joystick
          const maxRadius = 40;
          const distance = Math.min(Math.hypot(deltaX, deltaY), maxRadius);
          const angle = Math.atan2(deltaY, deltaX);
          
          const clampedX = Math.cos(angle) * distance;
          const clampedY = Math.sin(angle) * distance;
          
          joystickThumb.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
          
          touchMoveVector.x = clampedX / maxRadius;
          touchMoveVector.y = clampedY / maxRadius; 
        }
      }
    }, { passive: false });

    const resetMoveZone = (e) => {
      if (touchMoveId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchMoveId) {
          touchMoveId = null;
          touchMoveVector = { x: 0, y: 0 };
          joystickBase.classList.add('hidden');
        }
      }
    };
    moveZone.addEventListener('touchend', resetMoveZone);
    moveZone.addEventListener('touchcancel', resetMoveZone);
  }

  // Look Zone (Right)
  if (lookZone) {
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (touchLookId !== null) return; 
      
      const touch = e.changedTouches[0];
      touchLookId = touch.identifier;
      lastTouchLook = { x: touch.clientX, y: touch.clientY };
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (touchLookId === null) return;

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchLookId) {
          const deltaX = touch.clientX - lastTouchLook.x;
          const deltaY = touch.clientY - lastTouchLook.y;
          lastTouchLook = { x: touch.clientX, y: touch.clientY };
          
          handleCameraRotation(deltaX, deltaY, 0.005); 
        }
      }
    }, { passive: false });

    const resetLookZone = (e) => {
      if (touchLookId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchLookId) {
          touchLookId = null;
        }
      }
    };
    lookZone.addEventListener('touchend', resetLookZone);
    lookZone.addEventListener('touchcancel', resetLookZone);
  }
}

export function updateControls(delta) {
  if (!playerBody || !camera) return;

  inputVelocity.set(0, 0, 0);
  
  if (isMobile && (touchMoveVector.x !== 0 || touchMoveVector.y !== 0)) {
    inputVelocity.x = touchMoveVector.x;
    inputVelocity.z = touchMoveVector.y; 
  } else {
    if (moveForward) inputVelocity.z -= 1;
    if (moveBackward) inputVelocity.z += 1;
    if (moveLeft) inputVelocity.x -= 1;
    if (moveRight) inputVelocity.x += 1;
  }

  // Normalize input velocity to prevent faster diagonal movement
  if (inputVelocity.lengthSq() > 0) {
    if (!isMobile) {
      inputVelocity.normalize();
    } else {
      if (inputVelocity.lengthSq() > 1) {
        inputVelocity.normalize();
      }
    }
    inputVelocity.multiplyScalar(speed);
  }

  // Apply camera rotation (Y axis only) to movement
  const currentEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  currentEuler.setFromQuaternion(camera.quaternion);
  const cameraRotation = new THREE.Euler(0, currentEuler.y, 0, 'YXZ');
  inputVelocity.applyEuler(cameraRotation);

  // Check if player is currently grounded via strict vertical normal check
  let isGrounded = false;
  if (world && world.contacts) {
    for (let i = 0; i < world.contacts.length; i++) {
      const c = world.contacts[i];
      // Require surface normal to be strictly upward (greater than 0.75) to prevent wall-climbing
      if (c.bi === playerBody && c.ni.y < -0.75) {
        isGrounded = true;
        break;
      } else if (c.bj === playerBody && c.ni.y > 0.75) {
        isGrounded = true;
        break;
      }
    }
  }

  // Update canJump: only allow jump if firmly grounded and not in an upward ascent
  if (isGrounded && Math.abs(playerBody.velocity.y) <= 0.25) {
    canJump = true;
  } else {
    canJump = false;
  }

  // Handle velocity: direct control on ground, momentum conservation with gentle nudge in air
  if (isGrounded) {
    playerBody.velocity.x = inputVelocity.x;
    playerBody.velocity.z = inputVelocity.z;
  } else {
    // Fair Air Physics: in the air, preserve momentum and prevent instant direction change
    const hasInput = inputVelocity.lengthSq() > 0.01;
    if (hasInput) {
      const airSteerRate = 1.5;
      const steerFactor = Math.min(1, delta * airSteerRate);
      playerBody.velocity.x += (inputVelocity.x - playerBody.velocity.x) * steerFactor;
      playerBody.velocity.z += (inputVelocity.z - playerBody.velocity.z) * steerFactor;
    } else {
      const airDrag = Math.min(1, delta * 0.15);
      playerBody.velocity.x -= playerBody.velocity.x * airDrag;
      playerBody.velocity.z -= playerBody.velocity.z * airDrag;
    }
  }

  camera.position.copy(playerBody.position);
  camera.position.y += playerHeight / 2 - 0.1; 
}

export function startGameControls() {
  isGameActive = true;
  const isTouch = isMobile || 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 900;
  if (isTouch) {
    const mobileControls = document.getElementById('mobile-controls');
    if (mobileControls) mobileControls.classList.remove('hidden');
  }
  if (!isMobile) {
    try {
      const lockPromise = document.body.requestPointerLock();
      if (lockPromise && typeof lockPromise.catch === 'function') {
        lockPromise.catch(() => {});
      }
    } catch (e) {}
  }
}

export function stopGameControls() {
  isGameActive = false;
  touchShootId = null;
  stopFiring();
  const btnShoot = document.getElementById('btn-shoot');
  if (btnShoot) btnShoot.classList.remove('firing');
}

export function resetPlayerPosition(pos) {
  if (playerBody) {
    playerBody.position.set(pos.x, pos.y, pos.z);
    playerBody.velocity.set(0, 0, 0);
  }
}
