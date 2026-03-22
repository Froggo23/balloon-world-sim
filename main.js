import * as THREE from "./libs/three.module.js";
import { PointerLockControls } from "./libs/PointerLockControls.js";
import { GLTFLoader } from "./libs/GLTFLoader.js";

const PLAYER_HEIGHT = 2.3;
const WALK_SPEED = 34;
const RUN_SPEED = 60;
const MOVE_RESPONSE = 12;
const HEIGHT_RESPONSE = 12;

const WORLD_SIZE = 38000;
const ROAD_LENGTH = 34000;
const ROAD_WIDTH = 16;

const START_Z = 1200;
const BALLOON_Z = -2200;

const LOBBY_HEIGHT = 8.2;
const LOBBY_RADIUS = 6;
const STAIR_WIDTH = 3.25;
const STAIR_TOP_Z = 7;
const STAIR_BOTTOM_Z = 39;

const LAUNCH_DURATION = 10;
const LAUNCH_ALTITUDE = 180;

const FALLBACK_LOOK_SENSITIVITY = 0.0018;
const FALLBACK_LOOK_RESPONSE = 14;

const CAR_COUNT = 44;
const CAR_LANE_OFFSET = 3.05;
const CAR_MIN_SPEED = 2.2;
const CAR_MAX_SPEED = 3.6;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8ec4ff, 1300, 7600);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 25000);
camera.position.set(0, PLAYER_HEIGHT, START_Z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const statusEl = document.getElementById("status");
const distanceEl = document.getElementById("distance");
const gameOverEl = document.getElementById("game-over");

const controls = new PointerLockControls(camera, document.body);
controls.pointerSpeed = 0.9;
scene.add(controls.getObject());

const clock = new THREE.Clock();
const moveVelocity = new THREE.Vector2(0, 0);
const moveTargetVelocity = new THREE.Vector2(0, 0);
const groundWindUniform = { value: 0 };

const keys = {
  KeyW: false,
  KeyA: false,
  KeyS: false,
  KeyD: false,
  ShiftLeft: false,
  ShiftRight: false,
};

let cloudLayer = null;
let balloon = null;

let launchStarted = false;
let launchProgress = 0;
let gameOver = false;

let usingFallbackLook = false;
let fallbackDragging = false;

const fallbackEuler = new THREE.Euler(0, 0, 0, "YXZ");
let fallbackYaw = 0;
let fallbackPitch = 0;
let fallbackYawTarget = 0;
let fallbackPitchTarget = 0;

const cars = [];
let carHeadingOffset = -Math.PI / 2;

overlay.addEventListener("click", () => {
  beginPlayInput();
});

controls.addEventListener("lock", () => {
  usingFallbackLook = false;
  fallbackDragging = false;
  renderer.domElement.style.cursor = "default";
  overlay.classList.add("hidden");

  if (!gameOver && !launchStarted) {
    statusEl.textContent = "Walk to the hot-air balloon in the distance.";
  }
});

controls.addEventListener("unlock", () => {
  renderer.domElement.style.cursor = "default";

  if (!gameOver && !usingFallbackLook) {
    overlay.classList.remove("hidden");
  }
});

document.addEventListener("pointerlockerror", () => {
  if (!gameOver) {
    enableFallbackLookMode();
  }
});

renderer.domElement.addEventListener("mousedown", (event) => {
  if (!usingFallbackLook || gameOver || event.button !== 0) {
    return;
  }

  fallbackDragging = true;
  renderer.domElement.style.cursor = "grabbing";
  event.preventDefault();
});

window.addEventListener("mouseup", () => {
  fallbackDragging = false;

  if (usingFallbackLook && !gameOver) {
    renderer.domElement.style.cursor = "grab";
  }
});

window.addEventListener("mousemove", (event) => {
  if (!usingFallbackLook || !fallbackDragging || gameOver) {
    return;
  }

  const dx = event.movementX || 0;
  const dy = event.movementY || 0;

  fallbackYawTarget -= dx * FALLBACK_LOOK_SENSITIVITY;
  fallbackPitchTarget -= dy * FALLBACK_LOOK_SENSITIVITY;
  fallbackPitchTarget = THREE.MathUtils.clamp(fallbackPitchTarget, -Math.PI * 0.5 + 0.05, Math.PI * 0.5 - 0.05);
});

window.addEventListener("keydown", (event) => {
  if (event.code in keys) {
    keys[event.code] = true;
  }

  if (event.code === "KeyT" && !gameOver) {
    teleportToBalloonFront();
  }

  if (gameOver && event.code === "KeyR") {
    window.location.reload();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code in keys) {
    keys[event.code] = false;
  }
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(createSkyDome());
cloudLayer = createCloudLayer();
scene.add(cloudLayer);

scene.add(new THREE.HemisphereLight(0xb9ddff, 0x617b3a, 0.95));

const sun = new THREE.DirectionalLight(0xffffff, 1.08);
sun.position.set(320, 500, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -800;
sun.shadow.camera.right = 800;
sun.shadow.camera.top = 800;
sun.shadow.camera.bottom = -800;
scene.add(sun);

scene.add(createGround());
scene.add(createRoad());

balloon = createBalloon();
balloon.position.set(0, 0, BALLOON_Z);
scene.add(balloon);

loadCarFleet();
animate();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  updateFallbackLook(delta);
  updateWorldMotion(delta);
  updateMovement(delta);
  updateCars(delta);
  updateBalloonSequence(delta);
  updateHud();

  renderer.render(scene, camera);
}

function beginPlayInput() {
  if (gameOver) {
    return;
  }

  // Always enter gameplay immediately, even if Pointer Lock is blocked.
  enableFallbackLookMode();
  overlay.classList.add("hidden");

  controls.lock();

  window.setTimeout(() => {
    if (!controls.isLocked && !gameOver) {
      enableFallbackLookMode();
      statusEl.textContent = "Pointer lock blocked: hold left mouse and drag to look around.";
    }
  }, 220);
}

function enableFallbackLookMode() {
  if (gameOver || usingFallbackLook) {
    return;
  }

  usingFallbackLook = true;
  fallbackDragging = false;
  syncFallbackAnglesFromCamera();
  renderer.domElement.style.cursor = "grab";
}

function syncFallbackAnglesFromCamera() {
  fallbackEuler.setFromQuaternion(camera.quaternion, "YXZ");
  fallbackYaw = fallbackEuler.y;
  fallbackPitch = fallbackEuler.x;
  fallbackYawTarget = fallbackYaw;
  fallbackPitchTarget = fallbackPitch;
}

function updateFallbackLook(delta) {
  if (!usingFallbackLook || gameOver) {
    return;
  }

  const blend = 1 - Math.exp(-FALLBACK_LOOK_RESPONSE * delta);
  fallbackYaw = THREE.MathUtils.lerp(fallbackYaw, fallbackYawTarget, blend);
  fallbackPitch = THREE.MathUtils.lerp(fallbackPitch, fallbackPitchTarget, blend);
  fallbackEuler.set(fallbackPitch, fallbackYaw, 0);
  camera.quaternion.setFromEuler(fallbackEuler);
}

function updateWorldMotion(delta) {
  groundWindUniform.value += delta;

  if (cloudLayer?.material?.map) {
    cloudLayer.material.map.offset.x += delta * 0.0019;
    cloudLayer.material.map.offset.y += delta * 0.00055;
    cloudLayer.rotation.y += delta * 0.0018;
  }
}

function updateMovement(delta) {
  const canMove = (controls.isLocked || usingFallbackLook) && !gameOver;

  let forward = 0;
  let strafe = 0;
  if (canMove) {
    forward = Number(keys.KeyW) - Number(keys.KeyS);
    strafe = Number(keys.KeyD) - Number(keys.KeyA);
  }

  const speed = (keys.ShiftLeft || keys.ShiftRight) && canMove ? RUN_SPEED : WALK_SPEED;
  moveTargetVelocity.set(strafe * speed, forward * speed);

  const moveBlend = 1 - Math.exp(-MOVE_RESPONSE * delta);
  moveVelocity.lerp(moveTargetVelocity, moveBlend);

  if (!canMove) {
    moveVelocity.multiplyScalar(Math.exp(-8 * delta));
  }

  controls.moveForward(moveVelocity.y * delta);
  controls.moveRight(moveVelocity.x * delta);

  const player = controls.getObject().position;
  const clampHalf = WORLD_SIZE * 0.5 - 30;
  player.x = THREE.MathUtils.clamp(player.x, -clampHalf, clampHalf);
  player.z = THREE.MathUtils.clamp(player.z, -clampHalf, clampHalf);

  const targetY = getSurfaceHeight(player.x, player.z) + PLAYER_HEIGHT;
  const verticalBlend = 1 - Math.exp(-HEIGHT_RESPONSE * delta);
  player.y = THREE.MathUtils.lerp(player.y, targetY, verticalBlend);
}

function updateBalloonSequence(delta) {
  const player = controls.getObject().position;

  if (!launchStarted) {
    const lx = player.x - balloon.position.x;
    const lz = player.z - balloon.position.z;
    const inLobby = Math.hypot(lx, lz) < 5.5 && player.y > LOBBY_HEIGHT + PLAYER_HEIGHT - 0.2;

    if (inLobby) {
      launchStarted = true;
      statusEl.textContent = "Lift-off initiated. The balloon is leaving...";
    }
  }

  if (launchStarted && !gameOver) {
    launchProgress = Math.min(1, launchProgress + delta / LAUNCH_DURATION);
    const eased = easeInOutCubic(launchProgress);
    balloon.position.y = eased * LAUNCH_ALTITUDE;

    if (launchProgress >= 1) {
      gameOver = true;
      usingFallbackLook = false;
      fallbackDragging = false;
      renderer.domElement.style.cursor = "default";
      controls.unlock();

      gameOverEl.classList.add("show");
      overlayTitle.textContent = "Game Over";
      overlay.querySelector("#overlay-card p").textContent = "The balloon left without you. Press R to restart.";
      overlay.classList.remove("hidden");

      statusEl.textContent = "The balloon departed.";
      distanceEl.textContent = "Press R to play again.";
    }
  }
}

function updateHud() {
  if (gameOver) {
    return;
  }

  const player = controls.getObject().position;

  if (!launchStarted) {
    const d = Math.round(Math.hypot(player.x - balloon.position.x, player.z - balloon.position.z));
    distanceEl.textContent = `Distance to balloon: ${d} m (Press T to teleport)`;
  } else {
    distanceEl.textContent = `Balloon altitude: ${Math.round(balloon.position.y)} m`;
  }
}

function teleportToBalloonFront() {
  const player = controls.getObject().position;
  player.x = 0;
  player.z = balloon.position.z + STAIR_BOTTOM_Z + 18;
  player.y = getSurfaceHeight(player.x, player.z) + PLAYER_HEIGHT;

  camera.lookAt(balloon.position.x, PLAYER_HEIGHT + 2.6, balloon.position.z);
  syncFallbackAnglesFromCamera();

  statusEl.textContent = "Teleported near balloon. Walk straight and take the stairs.";
}

function getSurfaceHeight(x, z) {
  let surface = 0;

  if (Math.abs(x) < ROAD_WIDTH * 0.5 + 0.45) {
    surface = 0.02;
  }

  if (launchStarted) {
    return surface;
  }

  const lx = x - balloon.position.x;
  const lz = z - balloon.position.z;

  if (Math.abs(lx) < STAIR_WIDTH && lz > STAIR_TOP_Z && lz < STAIR_BOTTOM_Z) {
    const t = (STAIR_BOTTOM_Z - lz) / (STAIR_BOTTOM_Z - STAIR_TOP_Z);
    surface = Math.max(surface, t * LOBBY_HEIGHT);
  }

  if (Math.hypot(lx, lz) < LOBBY_RADIUS) {
    surface = Math.max(surface, LOBBY_HEIGHT);
  }

  return surface;
}

function createGround() {
  const grassTexture = createGrassTexture();
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(720, 720);
  grassTexture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: grassTexture,
    roughness: 1,
    metalness: 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = groundWindUniform;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\\nuniform float uWindTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float waveA = sin(position.x * 0.010 + uWindTime * 1.7);
         float waveB = cos(position.y * 0.011 + uWindTime * 1.2);
         float gust = sin((position.x + position.y) * 0.0032 + uWindTime * 3.6);
         transformed.z += waveA * 0.11 + waveB * 0.08 + gust * 0.07;`
      );
  };

  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 280, 280);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.03;
  mesh.receiveShadow = true;
  return mesh;
}

function createRoad() {
  const group = new THREE.Group();

  const road = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_WIDTH, 0.08, ROAD_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0x303337, roughness: 0.9, metalness: 0.05 })
  );
  road.receiveShadow = true;
  group.add(road);

  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.7 });
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, ROAD_LENGTH), edgeMat);
  left.position.set(-ROAD_WIDTH * 0.5 + 0.8, 0.07, 0);
  const right = left.clone();
  right.position.x *= -1;
  group.add(left, right);

  const dashCount = Math.floor(ROAD_LENGTH / 14);
  const dashes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.45, 0.05, 5),
    new THREE.MeshStandardMaterial({ color: 0xf2c646, roughness: 0.6 }),
    dashCount
  );

  const dummy = new THREE.Object3D();
  for (let i = 0; i < dashCount; i += 1) {
    const z = -ROAD_LENGTH * 0.5 + i * 14 + 6;
    dummy.position.set(0, 0.08, z);
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  return group;
}

function createBalloon() {
  const group = new THREE.Group();

  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry(11, 36, 28),
    new THREE.MeshStandardMaterial({ map: createBalloonTexture(), roughness: 0.75, metalness: 0.05 })
  );
  envelope.position.y = 30;
  envelope.scale.y = 1.16;
  envelope.castShadow = true;
  group.add(envelope);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 3.8, 4.2, 20),
    new THREE.MeshStandardMaterial({ color: 0xe58a4e, roughness: 0.8 })
  );
  neck.position.y = 18.7;
  neck.castShadow = true;
  group.add(neck);

  const lobby = new THREE.Mesh(
    new THREE.CylinderGeometry(6.4, 6.4, 1.2, 30),
    new THREE.MeshStandardMaterial({ color: 0x744b2e, roughness: 0.92 })
  );
  lobby.position.y = LOBBY_HEIGHT;
  lobby.castShadow = true;
  lobby.receiveShadow = true;
  group.add(lobby);

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.2, 30),
    new THREE.MeshStandardMaterial({ color: 0xb17b4e, roughness: 0.86 })
  );
  top.position.y = LOBBY_HEIGHT + 0.72;
  group.add(top);

  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(5.95, 0.12, 12, 54),
    new THREE.MeshStandardMaterial({ color: 0x2d2117, roughness: 0.7 })
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = LOBBY_HEIGHT + 1.45;
  group.add(rail);

  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.45, 8),
      new THREE.MeshStandardMaterial({ color: 0x2d2117, roughness: 0.8 })
    );
    post.position.set(Math.cos(a) * 5.9, LOBBY_HEIGHT + 0.75, Math.sin(a) * 5.9);
    group.add(post);
  }

  const stairDepth = STAIR_BOTTOM_Z - STAIR_TOP_Z;
  const stairCount = 18;
  const stepDepth = stairDepth / stairCount;

  const stairs = new THREE.Group();
  for (let i = 0; i < stairCount; i += 1) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(5.8, 0.45, stepDepth + 0.05),
      new THREE.MeshStandardMaterial({ color: 0x866040, roughness: 0.9 })
    );

    const y = (i + 0.5) * (LOBBY_HEIGHT / stairCount);
    const z = STAIR_BOTTOM_Z - (i * stepDepth + stepDepth * 0.5);
    step.position.set(0, y, z);
    step.castShadow = true;
    step.receiveShadow = true;
    stairs.add(step);
  }

  const railLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.5, stairDepth),
    new THREE.MeshStandardMaterial({ color: 0x3a2b1d, roughness: 0.8 })
  );
  railLeft.position.set(-3.1, LOBBY_HEIGHT * 0.54, STAIR_TOP_Z + stairDepth * 0.5);
  const railRight = railLeft.clone();
  railRight.position.x *= -1;
  stairs.add(railLeft, railRight);
  group.add(stairs);

  const topAnchors = [
    new THREE.Vector3(5.5, 22.5, 0),
    new THREE.Vector3(-5.5, 22.5, 0),
    new THREE.Vector3(0, 22.5, 5.5),
    new THREE.Vector3(0, 22.5, -5.5),
  ];

  const lowAnchors = [
    new THREE.Vector3(4.8, LOBBY_HEIGHT + 1.4, 0),
    new THREE.Vector3(-4.8, LOBBY_HEIGHT + 1.4, 0),
    new THREE.Vector3(0, LOBBY_HEIGHT + 1.4, 4.8),
    new THREE.Vector3(0, LOBBY_HEIGHT + 1.4, -4.8),
  ];

  for (let i = 0; i < topAnchors.length; i += 1) {
    group.add(createCylinderBetween(topAnchors[i], lowAnchors[i], 0.07, 0x3b2f28));
  }

  return group;
}

function loadCarFleet() {
  const loader = new GLTFLoader();

  loader.load(
    "./assets/ToyCar.glb",
    (gltf) => {
      const prototype = prepareCarPrototype(gltf.scene);
      spawnCarsFromPrototype(prototype);
    },
    undefined,
    (error) => {
      console.error("Car model failed; using fallback cars:", error);
      spawnFallbackCars();
    }
  );
}

function prepareCarPrototype(modelRoot) {
  modelRoot.updateMatrixWorld(true);

  const initialBox = new THREE.Box3().setFromObject(modelRoot);
  const initialSize = new THREE.Vector3();
  initialBox.getSize(initialSize);

  carHeadingOffset = initialSize.x > initialSize.z ? -Math.PI / 2 : 0;

  const targetLength = 4.9;
  const sourceLength = Math.max(initialSize.x, initialSize.z, 0.001);
  modelRoot.scale.multiplyScalar(targetLength / sourceLength);
  modelRoot.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(modelRoot);
  const center = new THREE.Vector3();
  box.getCenter(center);
  modelRoot.position.sub(center);
  modelRoot.position.y -= box.min.y;

  modelRoot.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    node.castShadow = true;
    node.receiveShadow = true;

    if (Array.isArray(node.material)) {
      node.material = node.material.map((m) => m.clone());
    } else if (node.material) {
      node.material = node.material.clone();
    }
  });

  return modelRoot;
}

function spawnCarsFromPrototype(prototype) {
  const perLane = Math.ceil(CAR_COUNT / 2);
  const spacing = ROAD_LENGTH / perLane;

  const lanes = [
    { x: -CAR_LANE_OFFSET, direction: 1 },
    { x: CAR_LANE_OFFSET, direction: -1 },
  ];

  for (const lane of lanes) {
    for (let i = 0; i < perLane; i += 1) {
      const car = prototype.clone(true);
      const jitter = THREE.MathUtils.randFloat(-spacing * 0.38, spacing * 0.38);
      const z = -ROAD_LENGTH * 0.5 + spacing * i + jitter;

      car.position.set(lane.x, 0.08, z);
      car.rotation.y = (lane.direction > 0 ? Math.PI : 0) + carHeadingOffset;

      tintCar(car);
      scene.add(car);

      cars.push({
        mesh: car,
        direction: lane.direction,
        speed: THREE.MathUtils.randFloat(CAR_MIN_SPEED, CAR_MAX_SPEED),
      });
    }
  }
}

function tintCar(carRoot) {
  const hueShift = THREE.MathUtils.randFloatSpread(0.05);
  const satScale = THREE.MathUtils.randFloat(0.92, 1.08);
  const lightScale = THREE.MathUtils.randFloat(0.9, 1.06);

  carRoot.traverse((node) => {
    if (!node.isMesh || !node.material) {
      return;
    }

    const apply = (mat) => {
      if (!mat.color) {
        return;
      }

      const hsl = { h: 0, s: 0, l: 0 };
      mat.color.getHSL(hsl);
      hsl.h = (hsl.h + hueShift + 1) % 1;
      hsl.s = THREE.MathUtils.clamp(hsl.s * satScale, 0, 1);
      hsl.l = THREE.MathUtils.clamp(hsl.l * lightScale, 0, 1);
      mat.color.setHSL(hsl.h, hsl.s, hsl.l);
    };

    if (Array.isArray(node.material)) {
      node.material.forEach(apply);
    } else {
      apply(node.material);
    }
  });
}

function spawnFallbackCars() {
  const palette = [0x7f1d1d, 0x1f3b7f, 0x1f7f4f, 0x7f5b1f, 0x5d2a7f, 0x2f2f2f, 0xb83d2a, 0x2a5db8];
  const perLane = Math.ceil(CAR_COUNT / 2);
  const spacing = ROAD_LENGTH / perLane;

  for (let lane = 0; lane < 2; lane += 1) {
    const direction = lane === 0 ? 1 : -1;
    const laneX = direction > 0 ? -CAR_LANE_OFFSET : CAR_LANE_OFFSET;

    for (let i = 0; i < perLane; i += 1) {
      const car = buildFallbackCar(palette[(i + lane * 2) % palette.length]);
      const jitter = THREE.MathUtils.randFloat(-spacing * 0.38, spacing * 0.38);
      const z = -ROAD_LENGTH * 0.5 + spacing * i + jitter;

      car.position.set(laneX, 0.08, z);
      car.rotation.y = direction > 0 ? Math.PI : 0;

      scene.add(car);
      cars.push({
        mesh: car,
        direction,
        speed: THREE.MathUtils.randFloat(CAR_MIN_SPEED, CAR_MAX_SPEED),
      });
    }
  }
}

function buildFallbackCar(color) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 1.0, 5.1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12 })
  );
  body.position.y = 0.66;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.95, 2.3),
    new THREE.MeshStandardMaterial({ color: 0xbecad6, roughness: 0.45, metalness: 0.22 })
  );
  cabin.position.set(0, 1.35, -0.1);
  cabin.castShadow = true;
  g.add(cabin);

  for (const x of [-1.15, 1.15]) {
    for (const z of [-1.7, 1.7]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.44, 0.44, 0.5, 14),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, z);
      wheel.castShadow = true;
      g.add(wheel);
    }
  }

  return g;
}

function updateCars(delta) {
  for (const car of cars) {
    car.mesh.position.z += car.direction * car.speed * delta;

    if (car.direction > 0 && car.mesh.position.z > ROAD_LENGTH * 0.5 + 100) {
      car.mesh.position.z = -ROAD_LENGTH * 0.5 - 100;
    } else if (car.direction < 0 && car.mesh.position.z < -ROAD_LENGTH * 0.5 - 100) {
      car.mesh.position.z = ROAD_LENGTH * 0.5 + 100;
    }
  }
}

function createSkyDome() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x2b73f5) },
      bottomColor: { value: new THREE.Color(0xdcefff) },
      offset: { value: 120 },
      exponent: { value: 0.64 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }
    `,
    side: THREE.BackSide,
  });

  return new THREE.Mesh(new THREE.SphereGeometry(12000, 40, 24), material);
}

function createCloudLayer() {
  const texture = createCloudTexture();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.6, 1.5);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.BackSide,
  });

  return new THREE.Mesh(new THREE.SphereGeometry(10000, 36, 22), material);
}

function createGrassTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#92bc5f");
  bg.addColorStop(0.56, "#87b455");
  bg.addColorStop(1, "#799f48");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 43000; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const len = 1.4 + Math.random() * 4.2;
    const angle = THREE.MathUtils.randFloatSpread(Math.PI * 0.44);

    const shade = 70 + Math.floor(Math.random() * 48);
    const alpha = 0.13 + Math.random() * 0.24;
    ctx.strokeStyle = `rgba(${40 + shade}, ${82 + shade}, ${34 + Math.floor(shade * 0.3)}, ${alpha})`;
    ctx.lineWidth = Math.random() < 0.72 ? 1 : 1.4;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  for (let i = 0; i < 4200; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = THREE.MathUtils.randFloat(2, 5.2);
    ctx.fillStyle = `rgba(255,225,140,${THREE.MathUtils.randFloat(0.025, 0.08)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function createCloudTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 230; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * (canvas.height * 0.82);
    const rx = THREE.MathUtils.randFloat(36, 124);
    const ry = THREE.MathUtils.randFloat(16, 56);

    const g = ctx.createRadialGradient(x, y, 2, x, y, rx);
    const a = THREE.MathUtils.randFloat(0.08, 0.24);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.66, `rgba(255,255,255,${a * 0.4})`);
    g.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, THREE.MathUtils.randFloatSpread(0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

function createBalloonTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const colors = ["#f64d4d", "#f7a43b", "#f0dc46", "#f06b3f", "#d94f6e"];
  const stripe = canvas.width / 10;
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(i * stripe, 0, stripe + 1, canvas.height);
  }

  const radial = ctx.createRadialGradient(canvas.width * 0.55, canvas.height * 0.22, 40, canvas.width * 0.5, canvas.height * 0.5, 300);
  radial.addColorStop(0, "rgba(255,255,255,0.3)");
  radial.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return new THREE.CanvasTexture(canvas);
}

function createCylinderBetween(start, end, radius, color) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );

  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

function easeInOutCubic(t) {
  if (t < 0.5) {
    return 4 * t * t * t;
  }

  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}
