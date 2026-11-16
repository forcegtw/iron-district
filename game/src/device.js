// The device: a rust-orange satchel the Torch carrier plants at the north site and the
// Coal side defuses. Planting takes 3.5 s and defusing 6 s in rounds.js; this module is
// the mesh and its blink, driven by the round state, never driving it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { DEVICE_SPOT } from './world.js';

export function createDevice(scene) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.16, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 }),
  );
  const blink = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  blink.position.set(0.1, 0.11, 0);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 4);
  light.position.set(0, 0.3, 0);
  group.add(shell, blink, light);
  group.position.set(DEVICE_SPOT[0], 0.08, DEVICE_SPOT[1]);
  group.visible = false;
  scene.add(group);

  function step(visualTime, planted) {
    group.visible = planted;
    if (!planted) {
      light.intensity = 0;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(visualTime * 9);
    blink.scale.setScalar(0.7 + pulse * 0.6);
    light.intensity = 2 + pulse * 6;
  }

  return { step, group };
}
