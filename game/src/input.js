// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it
// holds it. No AudioContext here or anywhere in shot mode.
export function createInput(canvas, onLockChange, onRadarToggle) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  let pressEdge = false;

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
    // 'R' toggles the radar overlay on the keydown edge only, so holding it
    // doesn't flicker the overlay on and off.
    if (down && event.code === 'KeyR' && !event.repeat && onRadarToggle) onRadarToggle();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked || event.button !== 0) return;
    state.firing = true;
    pressEdge = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      try {
        const request = canvas.requestPointerLock();
        if (request && request.catch) request.catch(() => {});
      } catch {
        // Pointer lock needs a user gesture; the next click retries.
      }
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // True once per mouse press: a semi-automatic gun fires on the edge only.
    takePress() {
      const pressed = pressEdge;
      pressEdge = false;
      return pressed;
    },
  };
}
