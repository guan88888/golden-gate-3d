import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A procedural architectural study. No network requests, images or model downloads.
const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const nightPreference = matchMedia('(prefers-color-scheme: dark)');
const clamp = THREE.MathUtils.clamp;
let renderer, scene, camera, controls, water, sky, sun, keyLight, ambient;
let mode = nightPreference.matches ? 'night' : 'sunset';
let fogAmount = .2;
let transition = null;
let autoRotate = false;
let contextLost = false;
let toastTimer;
let viewportWidth = innerWidth;
let paused = document.hidden;
const clock = new THREE.Clock();
const world = new THREE.Group();
const nightObjects = new THREE.Group();
const bucket = new Map();
const cars = [];
const boats = [];
const seagulls = [];
const clouds = [];
const trafficBatches = [];
const dummy = new THREE.Object3D();
const up = new THREE.Vector3(0, 1, 0);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 7);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const palettes = {
  day: { sky: '#d3e4df', horizon: '#e9eee0', water: '#4b8586', deep: '#315e69', fog: '#d4e2da', sun: '#fff9db', sunlight: '#fff2d9', intensity: 3.4, ambient: 2.2, exposure: 1.02 },
  sunset: { sky: '#e0e9e0', horizon: '#f1e6d2', water: '#3f8381', deep: '#245b66', fog: '#d5e1d6', sun: '#ffe6b1', sunlight: '#ffdab1', intensity: 3.8, ambient: 1.7, exposure: 1.0 },
  night: { sky: '#0c2430', horizon: '#34505a', water: '#1c454e', deep: '#102b3a', fog: '#243e49', sun: '#e6f0ed', sunlight: '#bdc9d8', intensity: 1.1, ambient: .95, exposure: .98 },
};

let seed = 23811;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function hash(x, z) { return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453123); }
function fract(n) { return n - Math.floor(n); }
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = fract(x), fz = fract(z);
  const a = fx * fx * (3 - 2 * fx), b = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), a), THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), a), b);
}
function fbm(x, z) { return .55 * noise(x, z) + .27 * noise(x * 2.1, z * 2.1) + .13 * noise(x * 4.3, z * 4.3) + .05 * noise(x * 8.5, z * 8.5); }

const materials = {
  orange: new THREE.MeshStandardMaterial({ color: '#bd482d', roughness: .57, metalness: .32 }),
  orangeLight: new THREE.MeshStandardMaterial({ color: '#d15b38', roughness: .52, metalness: .3 }),
  orangeDark: new THREE.MeshStandardMaterial({ color: '#843b2c', roughness: .67, metalness: .25 }),
  cable: new THREE.MeshStandardMaterial({ color: '#a7432b', roughness: .42, metalness: .45 }),
  asphalt: new THREE.MeshStandardMaterial({ color: '#444c4a', roughness: .95 }),
  concrete: new THREE.MeshStandardMaterial({ color: '#a39d85', roughness: .92 }),
  stripe: new THREE.MeshStandardMaterial({ color: '#e2dcc4', roughness: .8 }),
  yellow: new THREE.MeshStandardMaterial({ color: '#d6b364', roughness: .8 }),
  window: new THREE.MeshStandardMaterial({ color: '#34575c', roughness: .22, metalness: .4 }),
  silver: new THREE.MeshStandardMaterial({ color: '#b1b5ad', roughness: .5, metalness: .5 }),
  bark: new THREE.MeshStandardMaterial({ color: '#544f3d', roughness: 1 }),
  leaves: new THREE.MeshStandardMaterial({ color: '#536b4c', roughness: 1, flatShading: true }),
  rock: new THREE.MeshStandardMaterial({ color: '#7f8b78', roughness: 1, flatShading: true }),
  white: new THREE.MeshStandardMaterial({ color: '#ede6ce', roughness: .7 }),
  black: new THREE.MeshStandardMaterial({ color: '#283334', roughness: .8 }),
  warmLight: new THREE.MeshBasicMaterial({ color: '#ffcd8e', toneMapped: false }),
  redLight: new THREE.MeshBasicMaterial({ color: '#ff4a24', toneMapped: false }),
};

// Static structural elements are merged by material, keeping draw calls low.
function addGeometry(geometry, material) {
  if (!bucket.has(material)) bucket.set(material, []);
  bucket.get(material).push(geometry);
}
function box(x, y, z, sx, sy, sz, material = materials.orange, rotation = 0) {
  dummy.position.set(x, y, z); dummy.rotation.set(0, rotation, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
  addGeometry(boxGeometry.clone().applyMatrix4(dummy.matrix), material);
}
function beam(a, b, width, depth = width, material = materials.orange) {
  dummy.position.copy(a).add(b).multiplyScalar(.5);
  dummy.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
  dummy.scale.set(width, a.distanceTo(b), depth); dummy.updateMatrix();
  addGeometry(boxGeometry.clone().applyMatrix4(dummy.matrix), material);
}
function rod(a, b, radius, material = materials.cable) {
  dummy.position.copy(a).add(b).multiplyScalar(.5);
  dummy.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
  dummy.scale.set(radius, a.distanceTo(b), radius); dummy.updateMatrix();
  addGeometry(cylinderGeometry.clone().applyMatrix4(dummy.matrix), material);
}
function flush() {
  for (const [material, geometries] of bucket) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    world.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  bucket.clear();
}

function buildTower(x, index) {
  // Concrete caissons, sculpted plinths and the two stepped Art Deco legs.
  box(x, 2, 0, 22, 7, 54, materials.concrete);
  box(x, 6.3, 0, 18, 2, 49, materials.concrete);
  for (const z of [-18.5, 18.5]) {
    box(x, 16, z, 14, 19, 15, materials.concrete);
    box(x, 25, z, 12, 2, 13, materials.concrete);
    const sections = [[27, 63, 10.2, 8.6], [63, 104, 9.4, 7.8], [104, 137, 8.6, 7.2], [137, 164, 8, 6.6], [164, 190, 7.4, 6.1]];
    for (const [bottom, top, width, depth] of sections) {
      box(x, (bottom + top) / 2, z, width, top - bottom, depth);
      // Raised vertical flanges catch the grazing sunset light.
      for (const side of [-1, 1]) {
        box(x + side * (width / 2 + .18), (bottom + top) / 2, z - depth / 2 + .65, .5, top - bottom, .72, materials.orangeLight);
        box(x + side * (width / 2 + .18), (bottom + top) / 2, z + depth / 2 - .65, .5, top - bottom, .72, materials.orangeLight);
      }
      box(x, top - .6, z, width + .7, 1.2, depth + .6, materials.orangeLight);
    }
    box(x, 191, z, 9.3, 3.2, 8.1, materials.orangeLight);
    box(x, 194, z, 7.7, 3, 6.8);
    box(x, 196, z, 5.6, 1.4, 5.5, materials.orangeLight);
    // Rivet strips on the legs, visible in the close-up camera.
    for (let y = 32; y < 187; y += 3) {
      for (const face of [-1, 1]) {
        box(x + face * 5.15, y, z - 2.6, .18, .27, .27, materials.orangeDark);
        box(x + face * 5.15, y, z + 2.6, .18, .27, .27, materials.orangeDark);
      }
    }
    // Cable saddle castings and aviation beacons.
    box(x, 198, z, 9, 1.6, 3.7, materials.orangeDark);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.65, 8, 6), materials.redLight);
    beacon.position.set(x, 199.8, z); nightObjects.add(beacon);
  }
  // The portals become narrower toward the top, with inset webs and fascia.
  for (const [y, height] of [[58, 5.2], [101, 4.4], [136, 4.4], [165, 3.8], [187.8, 5]]) {
    box(x, y, 0, 7.8, height, 32);
    for (const side of [-1, 1]) {
      box(x + side * 4.15, y + height * .38, 0, .8, .65, 33, materials.orangeLight);
      box(x + side * 4.15, y - height * .38, 0, .8, .65, 33, materials.orangeDark);
      for (const z of [-13, 13]) {
        const s = Math.sign(z);
        beam(v(x + side * 3.3, y - height / 2 - 5, z + s * 1.3), v(x + side * 3.3, y - height / 2, z - s * 4.8), 1, 1.1);
      }
    }
  }
  // Lattice stiffening inside the low portal below the deck.
  for (const side of [-1, 1]) {
    beam(v(x + side * 4.5, 32, -14), v(x + side * 4.5, 55, 14), .9, .9, materials.orangeDark);
    beam(v(x + side * 4.5, 32, 14), v(x + side * 4.5, 55, -14), .9, .9, materials.orangeDark);
  }
  // Warm floodlighting is represented by emissive strips, not expensive point lights.
  for (const z of [-18.5, 18.5]) {
    const glow = new THREE.Mesh(new THREE.BoxGeometry(.36, 121, .36), materials.warmLight);
    glow.position.set(x + 5.3, 129, z + 3.7); nightObjects.add(glow);
  }
}

function cableHeight(x) {
  const a = Math.abs(x);
  return a <= 330 ? 91 + 107 * (a / 330) ** 2 : 68 + 130 * (1 - (a - 330) / 298) ** 2;
}
function buildBridge() {
  const road = 62;
  // Six traffic lanes, central divider, maintenance sidewalks and guardrails.
  box(0, road - 1.5, 0, 1360, 2.8, 33, materials.orangeDark);
  box(0, road, 0, 1360, .7, 26.8, materials.asphalt);
  for (const side of [-1, 1]) {
    box(0, road + .2, side * 15, 1360, 1.2, 3, materials.concrete);
    for (const y of [63, 64.5, 65.8]) box(0, y, side * 16.5, 1360, .24, .3, materials.orangeLight);
    for (let x = -674; x <= 674; x += 5.5) box(x, 64.2, side * 16.5, .22, 3.6, .26, materials.orange);
    box(0, 62.55, side * 12.6, 1360, .045, .22, materials.stripe);
    for (let x = -672; x < 674; x += 13) {
      for (const z of [4.35, 8.7]) box(x, 62.39, side * z, 5.8, .045, .15, materials.stripe);
    }
    box(0, 62.7, side * .4, 1360, .5, .28, materials.yellow);
    const edgeLight = new THREE.Mesh(new THREE.BoxGeometry(1270, .11, .13), materials.warmLight);
    edgeLight.position.set(0, 64.45, side * 16.7); nightObjects.add(edgeLight);
    // Longitudinal chords and triangular under-deck trusses.
    box(0, 53.6, side * 14.8, 1280, .85, .85);
    box(0, 60, side * 14.8, 1280, 1.2, .85);
    for (let x = -637; x < 637; x += 13) {
      beam(v(x, 53.6, side * 14.8), v(x + 13, 60, side * 14.8), .55, .55);
      beam(v(x, 60, side * 14.8), v(x + 13, 53.6, side * 14.8), .55, .55);
      box(x, 56.8, side * 14.8, .55, 6.4, .6, materials.orangeLight);
    }
  }
  for (let x = -637; x < 637; x += 26) {
    box(x, 55.5, 0, 1.05, 2.5, 29);
    beam(v(x, 55.4, -14.5), v(x + 26, 55.4, 14.5), .6, .6, materials.orangeDark);
    beam(v(x, 55.4, 14.5), v(x + 26, 55.4, -14.5), .6, .6, materials.orangeDark);
  }
  buildTower(-330, 0); buildTower(330, 1);
  // Two independently modeled main cables, with real cylindrical hangers.
  for (const side of [-1, 1]) {
    const points = [];
    for (let x = -628; x <= 628; x += 2) points.push(v(x, cableHeight(x), side * 18.5));
    const path = new THREE.CatmullRomCurve3(points);
    addGeometry(new THREE.TubeGeometry(path, 520, 1.02, 8, false), materials.cable);
    for (let x = -615; x < 620; x += 10.8) {
      if (Math.abs(Math.abs(x) - 330) < 8) continue;
      const h = cableHeight(x);
      for (const offset of [-.34, .34]) rod(v(x + offset, 61, side * 17.4), v(x + offset, h, side * 18.5), .12);
      box(x, h, side * 18.5, 1.6, .68, 2.8, materials.orangeLight);
    }
    // Art Deco light standards along the footpaths.
    for (let x = -604; x < 616; x += 45) {
      box(x, 64, side * 15.7, .85, 2, .85, materials.orangeDark);
      rod(v(x, 63, side * 15.7), v(x, 73.2, side * 15.7), .19, materials.orange);
      beam(v(x, 73.2, side * 15.7), v(x, 73.8, side * 12.4), .22, .2, materials.orange);
      box(x, 73.8, side * 12.4, 1.8, .5, .75, materials.silver);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.65, .14, .65), materials.warmLight);
      lamp.position.set(x, 73.47, side * 12.4); nightObjects.add(lamp);
    }
  }
  // Anchor housings at both shorelines and the approach viaducts.
  for (const side of [-1, 1]) {
    for (const z of [-18.5, 18.5]) {
      box(side * 631, 55, z, 22, 22, 15, materials.concrete);
      box(side * 631, 67, z, 24, 2.5, 17, materials.concrete);
    }
    for (const x of [490, 564, 652]) {
      box(side * x, 34, 0, 4.3, 48, 31, materials.concrete);
      box(side * x, 54, 0, 8, 6, 33, materials.concrete);
      for (const z of [-10, 10]) box(side * x, 28, z, 6.5, 56, 6.5, materials.concrete);
    }
  }
}

function shore(side, z) {
  const b = side === -1 ? 690 : 607;
  return b + 45 * Math.sin(z * .003 + side) + 22 * Math.sin(z * .009 + side * 2) - (side === -1 ? 86 : 40) * Math.exp(-(((z + 40) / 240) ** 2));
}
function terrainHeight(x, z, side) {
  const inland = Math.abs(x) - shore(side, z);
  if (inland < 0) return -9 + inland * .08;
  const rise = 1 - Math.exp(-inland / 190);
  const height = (side === -1 ? 170 : 95) * rise * (.49 + fbm(x * .0033, z * .0033) * .95);
  const ridge = (side === -1 ? 45 : 22) * Math.sin(z * .003 + .5) * rise;
  return Math.max(-3, height + ridge + fbm(x * .02, z * .02) * 10 - 3);
}
function buildLandscape() {
  const sand = new THREE.Color('#aba38a'), stone = new THREE.Color('#7b8974'), grass = new THREE.Color('#7e8d62'), deepGrass = new THREE.Color('#526b52');
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(2000, 4000, 110, 150);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, colors = [];
    for (let i = 0; i < p.count; i++) {
      const x = side * (p.getX(i) + 1550), z = p.getZ(i) - 700;
      const y = terrainHeight(x, z, side);
      p.setXYZ(i, x, y, z);
      const inland = Math.abs(x) - shore(side, z);
      const color = new THREE.Color();
      if (inland < 33) color.copy(sand).lerp(stone, clamp(inland / 55, 0, 1));
      else color.copy(grass).lerp(deepGrass, clamp(fbm(x * .009, z * .009) * .85 + y / 420, 0, 1));
      color.multiplyScalar(.92 + hash(x, z) * .14);
      colors.push(color.r, color.g, color.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals();
    const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    terrain.receiveShadow = true; world.add(terrain);
    // A rocky coastal fringe makes the shoreline read as land rather than a plane.
    for (let i = 0; i < 140; i++) {
      const z = -1750 + random() * 3000;
      const x = side * (shore(side, z) + 5 + random() * 23);
      const rock = new THREE.IcosahedronGeometry(1, 0);
      const y = terrainHeight(x, z, side);
      dummy.position.set(x, y + 1, z); dummy.rotation.set(random(), random() * 6, random()); dummy.scale.set(4 + random() * 11, 3 + random() * 8, 4 + random() * 7); dummy.updateMatrix();
      addGeometry(rock.applyMatrix4(dummy.matrix), materials.rock);
    }
    // Eucalyptus and Monterey cypress groves on the hills, away from the roadway.
    for (let i = 0; i < 270; i++) {
      const z = -1900 + random() * 3300;
      const x = side * (shore(side, z) + 40 + random() * 800);
      const y = terrainHeight(x, z, side);
      if (Math.abs(z) < 32 || y < 9) continue;
      const h = 4 + random() * 10;
      rod(v(x, y, z), v(x, y + h * .8, z), .35, materials.bark);
      const crown = new THREE.IcosahedronGeometry(1, 1);
      dummy.position.set(x, y + h, z); dummy.rotation.set(0, random() * 6, 0); dummy.scale.set(h * .48, h * .6, h * .43); dummy.updateMatrix();
      addGeometry(crown.applyMatrix4(dummy.matrix), materials.leaves);
    }
    // Winding paths make the coastal topography legible at aerial scale.
    let previous = null;
    for (let z = -1100; z <= 640; z += 18) {
      const x = side * (shore(side, z) + 110 + Math.sin(z * .005) * 55);
      const point = v(x, terrainHeight(x, z, side) + .7, z);
      if (previous) rod(previous, point, 1.5, materials.concrete);
      previous = point;
    }
  }
  // A restrained San Francisco silhouette in the far distance.
  for (let i = 0; i < 155; i++) {
    const x = 970 + random() * 1300, z = -780 - random() * 1100;
    const ground = terrainHeight(x, z, 1);
    const height = 5 + random() ** 2 * 85;
    const width = 12 + random() * 22;
    box(x, ground + height / 2, z, width, height, width * .72, materials.concrete);
    if (i % 8 === 0) box(x, ground + height + 3, z, width * .5, 6, width * .4, materials.silver);
  }
  // Small waterfront buildings and Fort Point-inspired brickwork.
  const fortX = 668, fortZ = 43, fortY = terrainHeight(fortX, fortZ, 1);
  box(fortX, fortY + 8, fortZ, 53, 16, 43, materials.orangeDark);
  box(fortX, fortY + 16.5, fortZ, 56, 1.2, 46, materials.concrete);
  for (let x = fortX - 21; x <= fortX + 21; x += 7) for (const y of [5, 11]) box(x, fortY + y, fortZ + 21.7, 2.6, 3.2, .3, materials.black);
}

function buildTraffic() {
  const paint = ['#e8e2cc', '#a9b6b2', '#d6bc76', '#c4563f', '#527780', '#324549', '#e5dece'];
  const paintMaterials = paint.map(color => new THREE.MeshStandardMaterial({ color, metalness: .25, roughness: .4 }));
  for (let i = 0; i < 66; i++) {
    const group = new THREE.Group();
    const isTruck = i % 13 === 0;
    const length = isTruck ? 8.8 : 4.9 + random() * 1.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, 1.15, 2.15), paintMaterials[i % paint.length]);
    body.position.y = 1; group.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(isTruck ? 6.3 : 2.8, isTruck ? 2.1 : .85, 1.94), isTruck ? materials.white : body.material);
    roof.position.set(isTruck ? -.5 : -.2, isTruck ? 2.2 : 1.95, 0); group.add(roof);
    if (!isTruck) {
      const glazing = new THREE.Mesh(new THREE.BoxGeometry(2.9, .62, 1.97), materials.window); glazing.position.set(-.2, 1.9, 0); group.add(glazing);
      const roofTop = new THREE.Mesh(new THREE.BoxGeometry(2, .18, 1.98), body.material); roofTop.position.set(-.3, 2.43, 0); group.add(roofTop);
    }
    for (const x of [-length * .31, length * .31]) for (const z of [-1.08, 1.08]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.52, .52, .23, 7), materials.black);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(x, .5, z); group.add(wheel);
    }
    const lamps = new THREE.Group();
    for (const side of [-1, 1]) for (const z of [-.72, .72]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(.12, .3, .37), side === 1 ? materials.warmLight : materials.redLight);
      light.position.set(side * (length / 2 + .03), 1.05, z); lamps.add(light);
    }
    group.add(lamps);
    const direction = i % 2 === 0 ? 1 : -1;
    group.position.set(-655 + random() * 1310, 62.5, direction * (2.2 + (i % 3) * 4.28));
    group.rotation.y = direction === 1 ? 0 : Math.PI;
    cars.push({ mesh: group, direction, speed: 5 + random() * 7, lamps });
  }
  // Bake vehicle components into material batches. Traffic costs 11 draw calls;
  // compact position buffers move the cars while their normals stay static.
  const batches = new Map();
  for (const car of cars) {
    car.mesh.updateMatrixWorld(true);
    const inverse = car.mesh.matrixWorld.clone().invert();
    car.mesh.traverse(part => {
      if (!part.isMesh) return;
      if (!batches.has(part.material)) batches.set(part.material, []);
      batches.get(part.material).push({ car, geometry: part.geometry.clone().applyMatrix4(inverse.clone().multiply(part.matrixWorld)) });
    });
  }
  for (const [material, parts] of batches) {
    const byCar = new Map();
    for (const part of parts) {
      if (!byCar.has(part.car)) byCar.set(part.car, []);
      byCar.get(part.car).push(part.geometry);
    }
    const isLight = material === materials.warmLight || material === materials.redLight;
    const entries = [...byCar].map(([car, geometries]) => ({ car, geometry: mergeGeometries(geometries).rotateY(car.mesh.rotation.y) }));
    const mesh = new THREE.Mesh(mergeGeometries(entries.map(entry => entry.geometry)), material);
    const position = mesh.geometry.attributes.position;
    const base = position.array.slice();
    let offset = 0;
    const ranges = entries.map(entry => { const start = offset; offset += entry.geometry.attributes.position.count; return { car: entry.car, start, end: offset }; });
    mesh.frustumCulled = false;
    if (isLight) nightObjects.add(mesh); else scene.add(mesh);
    trafficBatches.push({ mesh, base, ranges });
    parts.forEach(part => part.geometry.dispose()); entries.forEach(entry => entry.geometry.dispose());
  }
  updateTrafficGeometry();
}

function updateTrafficGeometry() {
  for (const batch of trafficBatches) {
    const position = batch.mesh.geometry.attributes.position;
    for (const range of batch.ranges) {
      const root = range.car.mesh.position;
      for (let i = range.start; i < range.end; i++) {
        const k = i * 3;
        position.setXYZ(i, batch.base[k] + root.x, batch.base[k + 1] + root.y, batch.base[k + 2] + root.z);
      }
    }
    position.needsUpdate = true;
  }
}

function buildBoats() {
  for (let i = 0; i < 6; i++) {
    const group = new THREE.Group();
    const size = i === 0 ? 2.1 : .7 + random() * .6;
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1, .65, 1, 5), materials.white);
    hull.rotation.x = Math.PI / 2; hull.scale.set(3.1, 10, 2.3); hull.position.y = 1.2; group.add(hull);
    if (i % 2 === 0) {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.7, 2.6, 6), materials.white); cabin.position.set(0, 3, 1); group.add(cabin);
      const windows = new THREE.Mesh(new THREE.BoxGeometry(3.8, .9, 6.1), materials.window); windows.position.set(0, 3.5, 1); group.add(windows);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(2.8, .7, 4.3), materials.white); upper.position.set(0, 4.8, 1); group.add(upper);
    } else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 20, 5), materials.silver); mast.position.y = 11; group.add(mast);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([.2, 20, 0, .2, 4, 0, .2, 4, 8, -.2, 19, 0, -.2, 4, 0, -.2, 4, -6], 3));
      const sails = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#f5edce', side: THREE.DoubleSide, roughness: .9 })); group.add(sails);
    }
    group.position.set(-410 + random() * 750, .5, i === 0 ? 260 : -660 + random() * 1150); group.rotation.y = -.9 + random() * 1.8; group.scale.setScalar(size);
    scene.add(group); boats.push({ mesh: group, angle: random() * 6, baseX: group.position.x, baseZ: group.position.z, speed: .5 + random() * .8 });
    const wakeGeometry = new THREE.PlaneGeometry(13 * size, 100 * size);
    const wakeMaterial = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uNight: { value: 0 } }, vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`, fragmentShader: `varying vec2 vUv;uniform float uNight;void main(){float edge=abs(vUv.x-.5);float alpha=(1.-smoothstep(.0,.5,edge))*(1.-vUv.y)*.13*(1.-uNight*.5);gl_FragColor=vec4(.85,.93,.87,alpha);}` });
    const wake = new THREE.Mesh(wakeGeometry, wakeMaterial); wake.rotation.x = -Math.PI / 2; wake.position.z = -45 * size; wake.position.y = -group.position.y + .5; group.add(wake);
  }
}

const waterVertex = `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
void main(){
 vec3 p=position;
 p.z+=sin(p.x*.023+uTime*.43)*.42+sin(p.y*.031+uTime*.31)*.32+sin(p.x*.065+p.y*.045-uTime*.37)*.16;
 vec4 world=modelMatrix*vec4(p,1.);
 vWorld=world.xyz;
 gl_Position=projectionMatrix*viewMatrix*world;
}`;
const waterFragment = `
uniform float uTime;uniform vec3 uColor;uniform vec3 uDeep;uniform vec3 uHorizon;uniform vec3 uSun;uniform float uNight;uniform float uFog;
varying vec3 vWorld;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float waves(vec2 p){return sin(p.x*.025+p.y*.014+uTime*.35)*.24+sin(p.y*.043-p.x*.02-uTime*.41)*.17+(noise(p*.17+vec2(uTime*.08,uTime*.035))-.5)*.8+(noise(p*.4-vec2(uTime*.04))-.5)*.12;}
void main(){
 vec2 p=vWorld.xz;
 float h=waves(p);
 float dx=waves(p+vec2(1.,0.))-h;
 float dz=waves(p+vec2(0.,1.))-h;
 vec3 N=normalize(vec3(-dx*2.8,1.,-dz*2.8));
 vec3 V=normalize(cameraPosition-vWorld);
 float fresnel=pow(1.-max(dot(N,V),0.),3.);
 vec3 color=mix(uDeep,uColor,.52+noise(p*.003)*.25);
 color=mix(color,uHorizon,fresnel*.38);
 vec3 L=normalize(vec3(-.65,.4,.35));
 vec3 H=normalize(L+V);
 float spec=pow(max(dot(N,H),0.),180.);
 float glitter=pow(max(dot(N,H),0.),24.)*noise(p*.53+uTime*.05)*.11;
 color+=uSun*(spec*.5+glitter)*(1.-uNight*.68);
 color+=(noise(p*.7+uTime*.07)-.5)*.018;
 // Soft silhouettes under the bridge make it sit in the water.
 float bridgeShadow=exp(-pow((p.y+18.)/24.,2.))*smoothstep(660.,570.,abs(p.x));
 float towerShadow=exp(-pow((abs(p.x)-330.)/16.,2.))*smoothstep(180.,10.,p.y)*smoothstep(-80.,-20.,p.y);
 color*=1.-bridgeShadow*.12-towerShadow*.09;
 float reflectedLight=exp(-pow((abs(p.x)-330.)/24.,2.))*exp(-abs(p.y-28.)/140.)*(.35+noise(p*.15)*.65)*uNight;
 color+=vec3(1.,.35,.1)*reflectedLight*.12;
 float distanceToCamera=length(cameraPosition-vWorld);
 float fog=1.-exp(-distanceToCamera*(.000045+uFog*.0001));
 color=mix(color,uHorizon,clamp(fog,0.,.94));
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;

function buildAtmosphere() {
  sky = new THREE.Mesh(new THREE.SphereGeometry(16000, 32, 20), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uSky: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
    fragmentShader: `varying vec3 vWorld;uniform vec3 uSky;uniform vec3 uHorizon;void main(){float h=normalize(vWorld).y;vec3 color=mix(uHorizon,uSky,smoothstep(-.04,.55,h));gl_FragColor=vec4(color,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include', ';\n#include'),
  }));
  scene.add(sky);
  water = new THREE.Mesh(new THREE.PlaneGeometry(22000, 22000, 200, 200), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uNight: { value: 0 }, uFog: { value: fogAmount } },
    vertexShader: waterVertex, fragmentShader: waterFragment,
  }));
  water.rotation.x = -Math.PI / 2; water.position.y = .1; scene.add(water);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,250,220,1)'); gradient.addColorStop(.14, 'rgba(255,246,207,.8)'); gradient.addColorStop(.4, 'rgba(255,236,192,.14)'); gradient.addColorStop(1, 'rgba(255,236,192,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, fog: false }));
  sun.position.set(-2800, 1050, -3500); sun.scale.set(1100, 1100, 1); scene.add(sun);
  // Cloud banks use a soft procedural texture and a handful of billboards.
  const cloudCanvas = document.createElement('canvas'); cloudCanvas.width = 256; cloudCanvas.height = 128;
  const c = cloudCanvas.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = 25 + random() * 205, y = 42 + random() * 45, r = 16 + random() * 29;
    const grad = c.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,.16)'); grad.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = grad; c.fillRect(x-r, y-r, r*2, r*2);
  }
  const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture, transparent: true, opacity: .24, depthWrite: false, color: '#fff4de' }));
    cloud.position.set(-3000 + random() * 6000, 380 + random() * 400, -1800 - random() * 3200);
    cloud.scale.set(1000 + random() * 1700, 300 + random() * 400, 1); scene.add(cloud); clouds.push(cloud);
  }
  const birdGeometry = new THREE.BufferGeometry();
  birdGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-2.8, 0, -.3, -1.1, -.6, .2, 0, 0, 0, 1.1, -.6, .2, 2.8, 0, -.3], 3));
  for (let i = 0; i < 11; i++) {
    const bird = new THREE.Line(birdGeometry, new THREE.LineBasicMaterial({ color: '#55675b', transparent: true, opacity: .65 }));
    const x = -420 + random() * 900, y = 115 + random() * 150, z = -320 + random() * 330;
    bird.position.set(x, y, z); bird.rotation.y = random() * 6; scene.add(bird);
    seagulls.push({ mesh: bird, x, y, z, phase: random() * 6, speed: .3 + random() * .4 });
  }
  // Deterministic night sky; stars are hidden for daytime and sunset.
  const starPositions = [];
  for (let i = 0; i < 700; i++) {
    const az = random() * Math.PI * 2, el = .13 + random() * 1.25, r = 11000;
    starPositions.push(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
  }
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  nightObjects.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#c1d4d6', size: 10, sizeAttenuation: true, fog: false, transparent: true, opacity: .7 })));
}

function getPreset(name) {
  const mobile = viewportWidth < 768;
  if (name === 'tower') return { position: v(505, 181, 250), target: v(320, 128, 0) };
  if (name === 'aerial') return { position: mobile ? v(660, 1300, 950) : v(520, 1000, 730), target: v(0, 22, 0) };
  return { position: mobile ? v(-2100, 660, 1700) : v(-820, 375, 1170), target: mobile ? v(0, 65, 0) : v(0, 65, 0) };
}

function applyLight(name, immediate = false) {
  mode = name;
  document.body.dataset.light = name;
  document.querySelectorAll('[data-light]').forEach(button => {
    if (button.tagName !== 'BUTTON') return;
    button.classList.toggle('selected', button.dataset.light === name);
    button.setAttribute('aria-pressed', String(button.dataset.light === name));
  });
  const p = palettes[name];
  scene.fog.color.set(p.fog);
  keyLight.color.set(p.sunlight); keyLight.intensity = p.intensity;
  ambient.intensity = p.ambient;
  ambient.color.set(name === 'night' ? '#9ebac5' : '#ebf0de');
  ambient.groundColor.set(name === 'night' ? '#20373f' : '#7e8c78');
  renderer.toneMappingExposure = p.exposure;
  sky.material.uniforms.uSky.value.set(p.sky); sky.material.uniforms.uHorizon.value.set(p.horizon);
  const uniforms = water.material.uniforms;
  uniforms.uColor.value.set(p.water); uniforms.uDeep.value.set(p.deep); uniforms.uHorizon.value.set(p.horizon); uniforms.uSun.value.set(p.sun); uniforms.uNight.value = name === 'night' ? 1 : 0;
  nightObjects.visible = name === 'night';
  for (const material of [materials.orange, materials.orangeLight, materials.orangeDark, materials.cable]) {
    material.emissive.set('#a44624');
    material.emissiveIntensity = name === 'night' ? (material === materials.orangeDark ? .12 : material === materials.cable ? .18 : .46) : 0;
  }
  sun.material.color.set(p.sun); sun.material.opacity = name === 'day' ? .35 : .65;
  sun.position.y = name === 'night' ? 2100 : name === 'day' ? 3100 : 1050;
  sun.scale.setScalar(name === 'night' ? 470 : 1100);
  cars.forEach(car => car.lamps.visible = name === 'night');
  clouds.forEach(cloud => cloud.material.opacity = name === 'night' ? .08 : .24);
  if (!immediate) showToast(name === 'night' ? '万家灯火，点亮金门海峡。' : name === 'day' ? '晴空之下，看见每一处结构。' : '日落时分，海湾染上暖色。');
}

function setView(name, instant = false) {
  const preset = getPreset(name);
  autoRotate = false; syncRotateButton();
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('selected', button.dataset.view === name);
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
  if (instant || reducedMotion.matches) {
    camera.position.copy(preset.position); controls.target.copy(preset.target); controls.update(); transition = null;
  } else {
    transition = { from: camera.position.clone(), targetFrom: controls.target.clone(), to: preset.position, targetTo: preset.target, started: performance.now(), duration: 1550 };
  }
}

function showToast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3400);
}
function syncRotateButton() {
  $('#auto-rotate').setAttribute('aria-pressed', String(autoRotate));
  $('#auto-rotate').setAttribute('aria-label', autoRotate ? '停止自动环绕' : '开启自动环绕');
}
function zoom(factor) {
  transition = null;
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
  camera.position.copy(controls.target).add(offset); controls.update();
}
async function saveFrame() {
  const button = $('#save-image'); button.disabled = true;
  try {
    // A separate render target avoids resizing the visible canvas during export.
    const width = Math.min(2560, Math.max(1600, Math.round($('#scene').clientWidth * 1.5)));
    const height = Math.round(width / camera.aspect);
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(oldTarget); target.dispose();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); const imageData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) imageData.data.set(pixels.subarray((height-y-1)*width*4, (height-y)*width*4), y*width*4);
    ctx.putImageData(imageData, 0, 0);
    const scale = width / 1500;
    ctx.fillStyle = mode === 'night' ? '#e5ebe3' : '#263c37';
    ctx.font = `500 ${Math.round(40 * scale)}px Arial`; ctx.fillText('Golden Gate.', 42 * scale, height - 66 * scale);
    ctx.font = `${Math.round(11 * scale)}px Arial`; ctx.fillText('LANDMARK ATELIER  /  SAN FRANCISCO', 44 * scale, height - 37 * scale);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Export failed');
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `golden-gate-${mode}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('画面已保存，留住这一刻的海湾。');
  } catch (error) { console.error(error); showToast('保存失败，请稍后重试。'); }
  finally { button.disabled = false; }
}

function bindInterface() {
  document.querySelectorAll('button[data-light]').forEach(button => button.addEventListener('click', () => applyLight(button.dataset.light)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#fog-range').addEventListener('input', event => {
    fogAmount = Number(event.target.value) / 100;
    $('#fog-value').value = `${event.target.value}%`;
    scene.fog.density = .00006 + fogAmount * .00055;
    water.material.uniforms.uFog.value = fogAmount;
    clouds.forEach(cloud => cloud.material.opacity = (mode === 'night' ? .05 : .14) + fogAmount * .4);
  });
  $('#auto-rotate').addEventListener('click', () => {
    transition = null; autoRotate = !autoRotate; syncRotateButton();
    if (autoRotate && reducedMotion.matches) showToast('已按你的操作开启环绕；再次点击可停止。');
  });
  $('#zoom-in').addEventListener('click', () => zoom(.8));
  $('#zoom-out').addEventListener('click', () => zoom(1.25));
  $('#reset-view').addEventListener('click', () => setView('classic'));
  $('#brand-home').addEventListener('click', event => { event.preventDefault(); setView('classic'); });
  $('#explore-link').addEventListener('click', () => setView('classic'));
  $('#save-image').addEventListener('click', saveFrame);
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else showToast('当前浏览器不支持全屏，请使用横屏欣赏。');
    } catch { showToast('当前浏览器暂时无法进入全屏。'); }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    $('#fullscreen').setAttribute('aria-pressed', String(active));
    $('#fullscreen').setAttribute('aria-label', active ? '退出全屏' : '进入全屏');
  });
  document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.dialog}-dialog`).showModal()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  });
  $('#scene').addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(.88); }
    if (event.key === '-') { event.preventDefault(); zoom(1.14); }
    if (event.key.toLowerCase() === 'r') setView('classic');
    if (event.key.startsWith('Arrow')) {
      event.preventDefault(); transition = null;
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (event.key === 'ArrowLeft') spherical.theta -= .08;
      if (event.key === 'ArrowRight') spherical.theta += .08;
      if (event.key === 'ArrowUp') spherical.phi -= .06;
      if (event.key === 'ArrowDown') spherical.phi += .06;
      spherical.phi = clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); controls.update();
    }
  });
  controls.addEventListener('start', () => { transition = null; autoRotate = false; syncRotateButton(); });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; showError('图形上下文已暂停。请关闭部分浏览器标签后重新加载。'); });
  document.addEventListener('visibilitychange', () => { paused = document.hidden; clock.getDelta(); });
  reducedMotion.addEventListener('change', () => { autoRotate = false; syncRotateButton(); });
  window.addEventListener('resize', resize);
}

function resize() {
  const host = $('#scene'); const wasMobile = viewportWidth < 768; viewportWidth = innerWidth;
  camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, viewportWidth < 768 ? 1.6 : 1.8));
  if (wasMobile !== (viewportWidth < 768)) setView('classic', true);
}
function showError(message) {
  $('#loading').classList.add('loaded'); $('#render-error').hidden = false; $('#error-message').textContent = message;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);
  if (paused || contextLost) return;
  const time = clock.elapsedTime;
  if (transition) {
    const progress = clamp((performance.now() - transition.started) / transition.duration, 0, 1);
    const t = progress < .5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    camera.position.lerpVectors(transition.from, transition.to, t); controls.target.lerpVectors(transition.targetFrom, transition.targetTo, t);
    if (progress >= 1) transition = null;
  }
  controls.autoRotate = autoRotate; controls.update(dt);
  if (!reducedMotion.matches) {
    water.material.uniforms.uTime.value = time;
    for (const car of cars) {
      car.mesh.position.x += dt * car.speed * car.direction;
      if (car.mesh.position.x > 669) car.mesh.position.x = -669;
      if (car.mesh.position.x < -669) car.mesh.position.x = 669;
    }
    updateTrafficGeometry();
    for (const boat of boats) {
      boat.mesh.position.y = .5 + Math.sin(time * .8 + boat.angle) * .18;
      boat.mesh.rotation.z = Math.sin(time * .55 + boat.angle) * .014;
      boat.mesh.position.x = boat.baseX + Math.sin(time * .003 * boat.speed) * 70;
      boat.mesh.position.z = boat.baseZ + Math.sin(time * .006 * boat.speed) * 90;
    }
    for (const bird of seagulls) {
      bird.mesh.position.set(bird.x + Math.sin(time * .04 * bird.speed + bird.phase) * 95, bird.y + Math.sin(time * .2 + bird.phase) * 5, bird.z + Math.cos(time * .04 * bird.speed + bird.phase) * 45);
      bird.mesh.rotation.z = Math.sin(time * .4 + bird.phase) * .15;
    }
  }
  const angle = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  $('#compass-needle').style.transform = `rotate(${-angle * 180 / Math.PI + 40}deg)`;
  renderer.render(scene, camera);
}

async function init() {
  try {
    const host = $('#scene');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 768 ? 1.6 : 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    scene = new THREE.Scene(); scene.fog = new THREE.FogExp2('#dce7dc', .00006 + fogAmount * .00055);
    camera = new THREE.PerspectiveCamera(37, host.clientWidth / host.clientHeight, 1, 28000);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .065;
    controls.minDistance = 115; controls.maxDistance = 3800;
    controls.minPolarAngle = .13; controls.maxPolarAngle = Math.PI / 2 - .025;
    controls.maxTargetRadius = 950; controls.autoRotateSpeed = .34;
    controls.zoomSpeed = .75; controls.panSpeed = .6;
    ambient = new THREE.HemisphereLight('#ebf0de', '#7e8c78', 2.1); scene.add(ambient);
    keyLight = new THREE.DirectionalLight('#ffdab1', 3.8); keyLight.position.set(-390, 600, 450);
    keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(keyLight.shadow.camera, { left: -1000, right: 1000, top: 750, bottom: -750, near: 10, far: 2200 });
    keyLight.shadow.bias = -.00025; keyLight.shadow.normalBias = .7; scene.add(keyLight);
    scene.add(world, nightObjects);
    // Allow the loading state to paint before building the detailed geometry.
    await new Promise(resolve => setTimeout(resolve, 0));
    const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));
    buildAtmosphere(); await yieldToBrowser();
    buildBridge(); await yieldToBrowser();
    buildLandscape(); await yieldToBrowser();
    flush(); await yieldToBrowser();
    buildTraffic(); buildBoats();
    applyLight(mode, true); setView('classic', true); bindInterface();
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera); $('#loading').classList.add('loaded');
    document.documentElement.dataset.ready = 'true';
    // A compact read-only diagnostic interface for meaningful browser smoke tests.
    window.__goldenGate = { get state() { return { ready: true, mode, autoRotate, fog: fogAmount, camera: camera.position.toArray(), target: controls.target.toArray(), cars: cars.length, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, width: host.clientWidth, height: host.clientHeight }; } };
    animate();
  } catch (error) {
    console.error('Golden Gate scene:', error);
    showError('请使用支持 WebGL 2 的浏览器，并确认已开启图形加速，然后重新加载此页面。');
  }
}
$('#retry-button').addEventListener('click', () => location.reload());
// Paint the interface before asking the GPU to create its rendering context.
setTimeout(init, 50);
