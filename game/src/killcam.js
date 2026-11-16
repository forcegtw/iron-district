// Killcam: when the player goes down mid-round, the camera lifts out of the body and
// orbits the shooter for two seconds, then hands the view back. The orbit eases in and
// out on a smoothstep so the cut never snaps, and the azimuth sweeps a quarter turn
// around the killer so the panel reads as a replay rather than a static freeze.
// Shot mode never activates it: the capture poses the camera itself.

const DURATION = 2.0;
const RADIUS = 3.4;
const SWEEP = Math.PI / 4;
const HEIGHT = 1.7;

function smoothstep(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function createKillcam() {
  let running = false;
  let time = 0;
  // Killer and victim positions are copied at activation: the simulation keeps
  // moving underneath the replay, so holding live references would drift the orbit.
  const killer = { x: 0, y: 0, z: 0 };
  const victim = { x: 0, y: 0, z: 0 };
  let baseAzimuth = 0;

  function start(killerPos, victimPos) {
    killer.x = killerPos.x;
    killer.y = killerPos.y;
    killer.z = killerPos.z;
    victim.x = victimPos.x;
    victim.y = victimPos.y;
    victim.z = victimPos.z;
    // Start the orbit on the side of the killer that faces the victim, so the
    // first frame already shows both bodies in relation.
    baseAzimuth = Math.atan2(victim.x - killer.x, victim.z - killer.z);
    time = 0;
    running = true;
  }

  // Drives the camera each fixed step. Returns false on the frame the replay ends,
  // so the caller knows to restore the first-person pose.
  function step(camera, dt) {
    if (!running) return true;
    time += dt;
    if (time >= DURATION) {
      running = false;
      return false;
    }
    const t = smoothstep(time / DURATION);
    const azimuth = baseAzimuth + SWEEP * t;
    const focusY = Math.max(killer.y, 0) + HEIGHT * 0.75;
    camera.position.set(
      killer.x + Math.sin(azimuth) * RADIUS,
      focusY,
      killer.z + Math.cos(azimuth) * RADIUS,
    );
    // Look from the orbit down at the killer's chest, dipping slightly toward the
    // victim as the sweep progresses: the eye drifts from shooter to scene.
    const lookX = killer.x * (1 - t * 0.2) + victim.x * t * 0.2;
    const lookZ = killer.z * (1 - t * 0.2) + victim.z * t * 0.2;
    camera.lookAt(lookX, focusY - 0.5, lookZ);
    return true;
  }

  return {
    start,
    step,
    active: () => running,
    cancel() {
      running = false;
      time = 0;
    },
  };
}
