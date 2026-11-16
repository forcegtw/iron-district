// The map: Iron District, a closed transshipment yard between two dock warehouses.
// A raised rail platform runs down the middle, two crate lanes flank it behind low
// walls, and the plant site sits in the north-west corner. Every box is a collider
// for bodies and grenades and a surface a bullet stops on. Plain geometry, no
// textures: the lighting and the six-colour palette carry the look.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Named boxes a fight can move around; bots and their routes read this list.
// Each entry: [width, height, depth, x, y, z, material]
const BLOCKS = [
  // Ground and the four boundary walls.
  [34.4, 0.4, 30.4, 0, -0.2, 0, 'canvas'],
  [0.4, 5.2, 30.4, -17.2, 2.6, 0, 'surface'],
  [0.4, 5.2, 30.4, 17.2, 2.6, 0, 'surface'],
  [34.4, 5.2, 0.4, 0, 2.6, -15.2, 'surface'],
  [34.4, 5.2, 0.4, 0, 2.6, 15.2, 'surface'],
  // Mid lane: the rail platform the long sightline runs down.
  [7.0, 0.55, 14.0, 0, 0.27, -4.0, 'surface'],
  [0.5, 1.0, 14.0, -3.75, 0.95, -4.0, 'hairline'],
  [0.5, 1.0, 14.0, 3.75, 0.95, -4.0, 'hairline'],
  [7.0, 0.5, 0.5, 0, 0.8, 2.8, 'hairline'],
  // Warehouse walls framing the mid lane: cover you can corner.
  [5.0, 3.4, 0.6, -7.5, 1.7, -9.0, 'surface'],
  [5.0, 3.4, 0.6, 7.5, 1.7, -9.0, 'surface'],
  [0.6, 3.4, 6.0, -10.2, 1.7, -6.2, 'surface'],
  [0.6, 3.4, 6.0, 10.2, 1.7, -6.2, 'surface'],
  // Crate stacks, left lane.
  [1.7, 1.7, 1.7, -13.4, 0.85, -2.0, 'hairline'],
  [1.7, 1.7, 1.7, -13.4, 0.85, -4.0, 'hairline'],
  [1.7, 1.1, 1.7, -13.4, 2.25, -3.0, 'accent'],
  [1.7, 1.7, 1.7, -13.4, 0.85, -7.0, 'hairline'],
  [1.2, 1.2, 1.2, -11.0, 0.6, -5.4, 'hairline'],
  // Crate stacks, right lane.
  [1.7, 1.7, 1.7, 13.4, 0.85, -2.0, 'hairline'],
  [1.7, 1.7, 1.7, 13.4, 0.85, -7.4, 'hairline'],
  [1.7, 1.1, 1.7, 13.4, 2.25, -4.6, 'accent'],
  [1.2, 1.2, 1.2, 11.2, 0.6, -5.8, 'hairline'],
  [1.2, 1.2, 1.2, 11.4, 0.6, 3.4, 'hairline'],
  // Defender-side cover near the plant site.
  [2.6, 1.2, 1.2, -5.2, 0.6, 8.2, 'hairline'],
  [2.6, 1.2, 1.2, 5.2, 0.6, 8.2, 'hairline'],
  [1.7, 1.7, 1.7, 0, 0.85, 11.0, 'hairline'],
  [1.7, 1.1, 1.7, -2.2, 0.85, 12.6, 'accent'],
  [1.7, 1.7, 1.7, -13.4, 0.85, 8.0, 'hairline'],
  // Site cover, north-west corner: the device sits behind this.
  [1.7, 1.1, 1.7, -9.6, 0.55, -10.6, 'hairline'],
  [1.7, 1.7, 1.7, -14.6, 0.85, -9.6, 'hairline'],
  [1.7, 1.7, 1.7, 13.4, 0.85, 8.0, 'hairline'],
  // Spawn cover on the attacker side.
  [2.2, 1.0, 1.2, -6.0, 0.5, 13.0, 'hairline'],
  [2.2, 1.0, 1.2, 6.0, 0.5, 13.0, 'hairline'],
];

// Waypoints per lane, from the Torch spawn at the south wall to the plant site and
// back out. Bots follow one route each and cut to the site once they carry.
export const ROUTES = {
  mid: [
    [0, 13.2], [0, 9.0], [0, 3.4], [0, -1.0], [0, -6.0],
    [-2.0, -10.5], [-4.0, -12.5], [-4.0, 4.0], [-4.0, 9.0], [-2.0, 13.0],
  ],
  left: [
    [-8.0, 13.0], [-12.0, 9.0], [-14.4, 4.0], [-14.4, -1.0],
    [-14.4, -6.0], [-13.0, -10.5], [-10.0, -12.5], [-6.0, -8.0],
    [-8.0, -2.0], [-10.0, 6.0], [-8.0, 11.0],
  ],
  right: [
    [8.0, 13.0], [12.0, 9.0], [14.4, 4.0], [14.4, -1.0],
    [14.4, -6.0], [13.0, -10.5], [10.0, -12.5], [6.0, -8.0],
    [8.0, -2.0], [10.0, 6.0], [8.0, 11.0],
  ],
};

// Spawn rows and the plant spot, in one place so bots, rounds and shots agree.
export const ATTACKER_SPAWNS = [[-7.0, 13.2], [0, 13.2], [7.0, 13.2]];
export const DEFENDER_SPAWNS = [[-4.0, -12.8], [0, -12.8], [4.0, -12.8]];
export const DEVICE_SPOT = [-12.0, -12.6];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const geometryCache = new Map();

  function geometry(width, height, depth) {
    const key = `${width}|${height}|${depth}`;
    let geo = geometryCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(width, height, depth);
      geometryCache.set(key, geo);
    }
    return geo;
  }

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(geometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - width / 2, y - height / 2, z - depth / 2),
      new THREE.Vector3(x + width / 2, y + height / 2, z + depth / 2),
    ));
    shootables.push(mesh);
    return mesh;
  }

  for (const [w, h, d, x, y, z, m] of BLOCKS) box(w, h, d, x, y, z, m);

  // Light: a cold dusk sky, one warm work-lamp over the mid lane, one long key.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.ink), new THREE.Color(PALETTE.hairline), 4.0);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 15.0);
  key.position.set(10, 16, 14);
  key.target.position.set(0, 0, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -20;
  key.shadow.camera.right = 20;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 56;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);

  const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 120, 24, 1.4);
  lamp.position.set(0, 4.6, -4.0);
  scene.add(lamp);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 5.5);
  fill.position.set(-10, 9, -12);
  scene.add(fill);

  return { colliders, shootables, group };
}
