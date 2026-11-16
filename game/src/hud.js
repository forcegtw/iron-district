// The DOM HUD: crosshair, hit marker, health, ammo, grenades, round timer, team scores,
// money, the buy menu, damage flash and the overlay panel. It never touches the
// simulation; main.js pushes numbers in and reads events out. Text writes are cached
// against the last value so the DOM is only touched when a number really changes.
const COPY = {
  start: {
    title: 'Iron District',
    copy: 'A dock-yard shootout. You are Coal, defending the district device. Torch is coming to plant it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Iron District',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  won: {
    title: 'Round won',
    copy: 'The district holds.',
    action: 'Next round',
  },
  lost: {
    title: 'Round lost',
    copy: 'Torch took the yard.',
    action: 'Next round',
  },
};

function overlayText(mode) {
  return COPY[mode];
}

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const hitmarker = document.getElementById('hitmarker');
  const healthValue = document.getElementById('health-value');
  const healthBar = document.getElementById('health-bar');
  const timerValue = document.getElementById('timer-value');
  const scoreCoal = document.getElementById('score-coal');
  const scoreTorch = document.getElementById('score-torch');
  const moneyValue = document.getElementById('money-value');
  const roundLabel = document.getElementById('round-label');
  const buyMenu = document.getElementById('buy-menu');
  const buyList = document.getElementById('buy-list');
  const statsPanel = document.getElementById('stats-panel');
  const statsGrid = document.getElementById('stats-grid');
  const detailPanel = document.getElementById('detail-panel');
  const detailGrid = document.getElementById('detail-grid');
  const buyMoney = document.getElementById('buy-money');
  const banner = document.getElementById('banner');
  const damageFlash = document.getElementById('damage-flash');
  const grenadeCount = document.getElementById('grenade-count');
  const objective = document.getElementById('objective');

  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastScore = '';
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastGrenades = -1;
  let buyOpen = false;
  let onBuyPick = null;
  let onBuyClose = null;

  // Rebuilds the buy list: one button per catalog row plus the close action. A row
  // is disabled when it is already owned or costs more than the purse.
  function renderBuy(items, money) {
    buyMoney.textContent = `$${money}`;
    buyList.innerHTML = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.disabled = item.price > money || item.owned;
      button.textContent = item.owned ? `${item.name} - owned` : `${item.name} - $${item.price}`;
      button.dataset.kind = item.kind;
      button.addEventListener('click', () => {
        if (onBuyPick) onBuyPick(item.kind);
      });
      buyList.appendChild(button);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'buy-close';
    close.textContent = 'Close (B)';
    close.addEventListener('click', () => { if (onBuyClose) onBuyClose(); });
    buyList.appendChild(close);
  }

  return {
    // Fills the end-of-round ledger from the stats module's own renderer, then hides
    // the panel again six seconds later.
    renderStats(stats) {
      if (!statsPanel || !statsGrid) return;
      stats.render(statsGrid);
      statsPanel.hidden = false;
      clearTimeout(statsPanel._t);
      statsPanel._t = setTimeout(() => { statsPanel.hidden = true; }, 6000);
    },
    // T panel: one card per gun with its numbers, or nothing at all when closed.
    toggleDetail(cards) {
      if (!detailPanel || !detailGrid) return;
      if (!cards) {
        detailPanel.hidden = true;
        return;
      }
      detailGrid.innerHTML = '';
      for (const card of cards) {
        const box = document.createElement('div');
        box.className = 'detail-card';
        const name = document.createElement('div');
        name.className = 'detail-name';
        name.textContent = card.name;
        box.appendChild(name);
        for (const [label, value] of card.lines) {
          const row = document.createElement('div');
          row.className = 'stat-row';
          const l = document.createElement('span');
          l.className = 'stat-label';
          l.textContent = label;
          const v = document.createElement('span');
          v.className = 'stat-value';
          v.textContent = value;
          row.append(l, v);
          box.appendChild(row);
        }
        detailGrid.appendChild(box);
      }
      detailPanel.hidden = false;
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammo.classList.toggle('empty', mag === 0);
    },
    setScore(coal, torch) {
      const pair = `${coal}:${torch}`;
      if (pair === lastScore) return;
      lastScore = pair;
      scoreCoal.textContent = String(coal);
      scoreTorch.textContent = String(torch);
    },
    setHealth(value) {
      if (value === lastHealth) return;
      lastHealth = value;
      healthValue.textContent = String(value);
      healthBar.style.width = `${Math.max(0, value)}%`;
      healthBar.classList.toggle('low', value <= 35);
    },
    setTimer(seconds) {
      const whole = Math.max(0, Math.ceil(seconds));
      if (whole === lastTimer) return;
      lastTimer = whole;
      timerValue.textContent = `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
      timerValue.classList.toggle('urgent', whole <= 10);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setRound(value) {
      roundLabel.textContent = `Round ${value}`;
    },
    setGrenades(count) {
      if (count === lastGrenades) return;
      lastGrenades = count;
      grenadeCount.textContent = `G x${count}`;
      grenadeCount.classList.toggle('none', count === 0);
    },
    setObjective(text) {
      objective.textContent = text;
    },
    showBanner(text, holdMs = 2200) {
      banner.textContent = text;
      banner.classList.add('on');
      clearTimeout(banner._t);
      banner._t = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    damageFlashPulse() {
      damageFlash.classList.add('on');
      clearTimeout(damageFlash._t);
      damageFlash._t = setTimeout(() => damageFlash.classList.remove('on'), 130);
    },
    // A kill marker is the same cross tilted further out and scaled up a touch.
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    openBuy(items, money) {
      buyOpen = true;
      buyMenu.hidden = false;
      renderBuy(items, money);
    },
    // Called after a purchase so prices and owned flags refresh in place.
    refreshBuy(items, money) {
      if (buyOpen) renderBuy(items, money);
    },
    closeBuy() {
      buyOpen = false;
      buyMenu.hidden = true;
    },
    get buyIsOpen() { return buyOpen; },
    onBuyPick(handler) { onBuyPick = handler; },
    onBuyClose(handler) { onBuyClose = handler; },
    showOverlay(mode, score) {
      const text = overlayText(mode);
      title.textContent = text.title;
      const base = text.copy;
      // Round-end panels append the round's reason to the base copy when there is one.
      copy.textContent = mode === 'won' || mode === 'lost'
        ? `${base} ${score && score.reason ? score.reason : ''}`
        : base;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
