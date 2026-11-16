// The announcer: big event text in a queue, one banner at a time, entering on a scale
// and letter-spacing ease and leaving on a fade. Major events (round win, plant,
// capture, clutch) outrank minor ones (mid pays, spot confirmed) and bump the queue
// rather than waiting behind them. The queue is drained by time, not by the frame
// rate, so a slow machine reads the same sequence in the same order.
const MAJOR_HOLD = 1900;
const MINOR_HOLD = 1200;
const ENTER_TIME = 180;
const EXIT_TIME = 260;

export function createAnnouncer() {
  const queue = [];
  let current = null; // { text, major, age, hold }
  let element = null;

  function bind(el) {
    element = el;
    if (element) element.classList.add('announcer');
  }

  function push(text, major = true) {
    if (current && current.text === text) return; // no double announce of the same event
    queue.push({ text, major });
    if (major) {
      // A major event pre-empts everything queued behind and including the current
      // minor, but never cuts a major off mid-display: its message matters too.
      for (let index = queue.length - 2; index >= 0; index -= 1) {
        if (!queue[index].major) queue.splice(index, 1);
      }
    }
  }

  function step(dtMs) {
    if (!element) return;
    if (!current) {
      if (queue.length === 0) return;
      current = queue.shift();
      current.age = 0;
      current.hold = current.major ? MAJOR_HOLD : MINOR_HOLD;
      element.textContent = current.text;
      element.classList.add('announcer-on');
    }
    current.age += dtMs;
    const total = ENTER_TIME + current.hold + EXIT_TIME;
    if (current.age >= total) {
      current = null;
      element.classList.remove('announcer-on');
      element.textContent = '';
      return;
    }
    if (current.age < ENTER_TIME) {
      const t = current.age / ENTER_TIME;
      element.style.opacity = String(t);
      element.style.transform = `translateX(-50%) scale(${0.94 + t * 0.06})`;
      element.style.letterSpacing = `${(1 - t) * 0.14}em`;
    } else if (current.age > ENTER_TIME + current.hold) {
      const t = (current.age - ENTER_TIME - current.hold) / EXIT_TIME;
      element.style.opacity = String(1 - t);
    } else {
      element.style.opacity = '1';
      element.style.transform = 'translateX(-50%) scale(1)';
      element.style.letterSpacing = '0em';
    }
  }

  function clear() {
    queue.length = 0;
    current = null;
    if (element) {
      element.classList.remove('announcer-on');
      element.textContent = '';
    }
  }

  // Convenience wrappers for the events the game actually announces, so call sites
  // read as intent instead of flags.
  return {
    bind,
    step,
    clear,
    roundWin() { push('ROUND WON'); },
    roundLost() { push('ROUND LOST'); },
    bombPlanted() { push('BOMB PLANTED'); },
    captured() { push('CAPTURED', true); },
    captureLost() { push('MID LOST', false); },
    clutch(aliveEnemies) { push(`CLUTCH! 1 v ${aliveEnemies}`, true); },
    info(text) { push(text, false); },
    get pending() { return queue.length + (current ? 1 : 0); },
  };
}
