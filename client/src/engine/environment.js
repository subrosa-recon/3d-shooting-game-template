import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// We store the meshes/bodies so we can test raycasts against them
export const collidableMeshes = [];

export function generateMap(scene, world, sizeStr, mapBoxes) {
  // Clear previous meshes
  collidableMeshes.length = 0;

  const count = mapBoxes ? mapBoxes.length : (sizeStr === 'large' ? 150 : sizeStr === 'small' ? 20 : 50);

  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshLambertMaterial({ color: 0x888888 });
  
  // Use InstancedMesh for performance
  const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
  instancedMesh.castShadow = true;
  instancedMesh.receiveShadow = true;
  scene.add(instancedMesh);
  
  collidableMeshes.push(instancedMesh);

  const physicsMaterial = new CANNON.Material('standard');
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const x = mapBoxes ? mapBoxes[i].x : (Math.random() - 0.5) * 40;
    const z = mapBoxes ? mapBoxes[i].z : (Math.random() - 0.5) * 40;
    const rotY = mapBoxes ? mapBoxes[i].rotationY : Math.random() * Math.PI;
    const y = 1; // half of box height

    dummy.position.set(x, y, z);
    dummy.rotation.y = rotY;
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);

    // Create physics body
    const shape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
    const body = new CANNON.Body({ mass: 0, material: physicsMaterial });
    body.addShape(shape);
    body.position.set(x, y, z);
    body.quaternion.copy(dummy.quaternion);
    world.addBody(body);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;

  // --- Map Boundaries (Invisible perimeter walls) ---
  const boundDist = sizeStr === 'large' ? 65 : sizeStr === 'small' ? 25 : 35;
  const wallThickness = 2;
  const wallHeight = 15;
  const wallLength = boundDist * 2 + wallThickness * 2;

  const wallDefs = [
    { x: 0, z: boundDist, sx: wallLength, sz: wallThickness },  // North
    { x: 0, z: -boundDist, sx: wallLength, sz: wallThickness }, // South
    { x: boundDist, z: 0, sx: wallThickness, sz: wallLength },  // East
    { x: -boundDist, z: 0, sx: wallThickness, sz: wallLength }  // West
  ];

  wallDefs.forEach(w => {
    const wallShape = new CANNON.Box(new CANNON.Vec3(w.sx / 2, wallHeight / 2, w.sz / 2));
    const wallBody = new CANNON.Body({ mass: 0, material: physicsMaterial });
    wallBody.addShape(wallShape);
    wallBody.position.set(w.x, wallHeight / 2, w.z);
    world.addBody(wallBody);
  });
}
