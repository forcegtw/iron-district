// The player's held gun: one view model per weapon, magazine, reserve, reload, recoil
// kick and the spread model that punishes firing on the move. Damage numbers live in
// combat.js; this module owns only what the hands do.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { GUNS } from './combat.js';
import { buildExtraModel } from './weapons2.js';

const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.15 });

  const models = new Map();
  function buildModel(kind) {
    const extra = buildExtraModel(kind, { metal, grip, accent });
    if (extra) {
      extra.visible = false;
      camera.add(extra);
      return extra;
    }
    const model = new THREE.Group();
    if (kind === 'pistol') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.24), metal);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.16), grip);
      barrel.position.set(0, 0.02, -0.2);
      model.add(receiver, barrel);
    } else if (kind === 'smg') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.3), metal);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), grip);
      barrel.position.set(0, 0.02, -0.26);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), grip);
      stock.position.set(0, -0.01, 0.22);
      model.add(receiver, barrel, stock);
    } else if (kind === 'sniper') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), metal);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), grip);
      barrel.position.set(0, 0.02, -0.5);
      const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), accent);
      scope.position.set(0, 0.09, -0.1);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.26), grip);
      stock.position.set(0, -0.02, 0.34);
      model.add(receiver, barrel, scope, stock);
    } else {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), metal);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
      barrel.position.set(0, 0.025, -0.38);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
      stock.position.set(0, -0.02, 0.3);
      const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), accent);
      magazine.position.set(0, -0.11, -0.02);
      model.add(receiver, barrel, stock, magazine);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    return model;
  }
  for (const kind of Object.keys(GUNS)) models.set(kind, buildModel(kind));

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.10, 0.10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.17, -0.62);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.16, -0.6);
  camera.add(flashLight);

  const state = { gun: 'rifle', mag: 0, reserve: 0, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, grenades: 0 };

  function setGun(kind) {
    if (!models.has(kind)) return;
    state.gun = kind;
    for (const [key, model] of models) model.visible = key === kind;
  }

  const gun = () => GUNS[state.gun];

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models.get(state.gun);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 9 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (gun().reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = gun().mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    gun,
    setGun,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pulling() {
      return state.cooldown > 0 || state.reloadLeft > 0;
    },
    pullTrigger() {
      state.cooldown = gun().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === gun().mag || state.reserve === 0) return;
      state.reloadLeft = gun().reloadTime;
    },
    spread(speed) {
      const g = gun();
      return g.spreadStill + Math.min(1, speed / g.moveRef) * g.spreadMove;
    },
    equip(kind) {
      setGun(kind);
      const g = GUNS[kind];
      state.mag = g.mag;
      state.reserve = g.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    refillGrenades(count) {
      state.grenades = count;
    },
  };
}
