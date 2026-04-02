// ═══════════════════════════════════════════════════════════════════
// gravity-egg.ts — Drag the logo to create a gravitational black hole
// Elements are attracted toward the dragged logo. The longer you hold,
// the stronger the pull. Drop to release with a bounce-back effect.
// ═══════════════════════════════════════════════════════════════════

let dragging = false;
let dragX = 0;
let dragY = 0;
let holdTime = 0;
let holdStart = 0;
let clone: HTMLElement | null = null;
let raf = 0;
let trail: HTMLElement[] = [];
const affected: Array<{ el: HTMLElement; ox: number; oy: number }> = [];

const PULL_ELEMENTS = '.s-card, .tab, .env-select, .theme-picker, .health-widget, .logo-sub, .logo-ver, .term-bar button, .run-bar, .shortcuts span';

function getElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll(PULL_ELEMENTS)) as HTMLElement[];
}

function startDrag(e: MouseEvent | TouchEvent): void {
  e.preventDefault();
  const logo = document.querySelector('.logo') as HTMLElement;
  if (!logo) return;

  dragging = true;
  holdStart = performance.now();
  const r = logo.getBoundingClientRect();
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  dragX = clientX;
  dragY = clientY;

  // Create floating clone
  clone = document.createElement('div');
  clone.className = 'gravity-clone';
  clone.innerHTML = logo.innerHTML;
  clone.style.left = r.left + 'px';
  clone.style.top = r.top + 'px';
  clone.style.width = r.width + 'px';
  clone.style.height = r.height + 'px';
  document.body.appendChild(clone);

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'gravity-overlay';
  overlay.id = 'gravityOverlay';
  document.body.appendChild(overlay);

  // Hide original
  logo.style.opacity = '0';

  // Snapshot element positions
  affected.length = 0;
  for (const el of getElements()) {
    const rect = el.getBoundingClientRect();
    affected.push({ el, ox: rect.left + rect.width / 2, oy: rect.top + rect.height / 2 });
    el.style.transition = 'none';
    el.style.willChange = 'transform';
  }

  raf = requestAnimationFrame(tickGravity);
}

function moveDrag(e: MouseEvent | TouchEvent): void {
  if (!dragging) return;
  dragX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  dragY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  if (clone) {
    clone.style.left = (dragX - 40) + 'px';
    clone.style.top = (dragY - 15) + 'px';
  }

  // Trail particles
  if (trail.length < 30) {
    const t = document.createElement('div');
    t.className = 'gravity-trail';
    t.style.left = dragX + 'px';
    t.style.top = dragY + 'px';
    const hue = (performance.now() / 3) % 360;
    t.style.background = `hsl(${hue}, 100%, 65%)`;
    document.body.appendChild(t);
    trail.push(t);
    setTimeout(() => { t.remove(); trail = trail.filter(x => x !== t); }, 600);
  }
}

function endDrag(): void {
  if (!dragging) return;
  dragging = false;
  cancelAnimationFrame(raf);

  // Bounce back all elements
  for (const { el } of affected) {
    el.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
    el.style.transform = '';
    setTimeout(() => {
      el.style.transition = '';
      el.style.willChange = '';
    }, 700);
  }
  affected.length = 0;

  // Restore logo
  const logo = document.querySelector('.logo') as HTMLElement;
  if (logo) logo.style.opacity = '';

  // Remove clone with explosion effect
  if (clone) {
    clone.classList.add('gravity-clone-explode');
    const c = clone;
    setTimeout(() => c.remove(), 600);
    clone = null;

    // Screen shake
    document.body.classList.add('gravity-shake');
    setTimeout(() => document.body.classList.remove('gravity-shake'), 500);

    // Shockwave ring
    const ring = document.createElement('div');
    ring.className = 'gravity-shockwave';
    ring.style.left = dragX + 'px';
    ring.style.top = dragY + 'px';
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 800);

    // Second ring delayed
    setTimeout(() => {
      const ring2 = document.createElement('div');
      ring2.className = 'gravity-shockwave gravity-shockwave-2';
      ring2.style.left = dragX + 'px';
      ring2.style.top = dragY + 'px';
      document.body.appendChild(ring2);
      setTimeout(() => ring2.remove(), 800);
    }, 100);

    // Flash
    const flash = document.createElement('div');
    flash.className = 'gravity-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 300);

    // Massive donut explosion — 3 waves
    const emojis = ['\uD83C\uDF69', '\uD83C\uDF6A', '\uD83C\uDF70', '\u2B50', '\uD83C\uDF1F', '\uD83C\uDF6B', '\uD83C\uDF6C', '\uD83C\uDF82'];
    const power = Math.min(1, holdTime / 3); // 0-1 based on hold duration
    const count = Math.round(20 + power * 40); // 20-60 donuts

    for (let wave = 0; wave < 3; wave++) {
      const waveCount = Math.round(count / 3);
      const waveDelay = wave * 80;

      setTimeout(() => {
        for (let i = 0; i < waveCount; i++) {
          const d = document.createElement('div');
          d.className = 'gravity-donut-burst';
          d.textContent = emojis[Math.floor(Math.random() * emojis.length)];
          d.style.left = dragX + 'px';
          d.style.top = dragY + 'px';
          d.style.fontSize = (16 + Math.random() * 20) + 'px';
          const angle = (i / waveCount) * Math.PI * 2 + Math.random() * 0.5;
          const dist = (40 + wave * 40) + Math.random() * (80 + power * 120);
          const gy = 30 + Math.random() * 60; // gravity drop
          d.style.setProperty('--bx', Math.cos(angle) * dist + 'px');
          d.style.setProperty('--by', (Math.sin(angle) * dist + gy) + 'px');
          d.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
          const dur = 0.6 + Math.random() * 0.6;
          d.style.animationDuration = dur + 's';
          document.body.appendChild(d);
          setTimeout(() => d.remove(), dur * 1000 + 100);
        }
      }, waveDelay);
    }

    // Confetti sparkles
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('div');
      s.className = 'gravity-sparkle';
      s.style.left = dragX + 'px';
      s.style.top = dragY + 'px';
      const angle = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 200;
      s.style.setProperty('--sx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--sy', (Math.sin(angle) * dist + Math.random() * 40) + 'px');
      const hue = Math.floor(Math.random() * 360);
      s.style.background = `hsl(${hue}, 100%, 65%)`;
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  // Remove overlay
  const overlay = document.getElementById('gravityOverlay');
  if (overlay) { overlay.classList.add('gravity-overlay-out'); setTimeout(() => overlay.remove(), 300); }

  // Clean trails
  trail.forEach(t => t.remove());
  trail.length = 0;
}

function tickGravity(): void {
  if (!dragging) return;
  holdTime = (performance.now() - holdStart) / 1000;
  // Strength grows over time (0 → 1 over 3 seconds)
  const strength = Math.min(1, holdTime / 3);

  // Clone grows + trembles as power builds
  if (clone) {
    const scale = 1 + strength * 1.2;  // grows up to 2.2x
    const glow = Math.round(strength * 25);
    // Tremble increases with strength
    const shake = strength * 4;
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    clone.style.transform = `scale(${scale}) translate(${sx}px, ${sy}px)`;
    clone.style.filter = `drop-shadow(0 0 ${glow}px rgba(255,150,50,${strength}))`;
    // Color shift toward red as it's about to "explode"
    if (strength > 0.7) {
      const red = Math.round((strength - 0.7) * 3.3 * 255);
      clone.style.filter += ` brightness(${1 + strength * 0.5})`;
    }
  }

  // Pull elements linearly toward drag position
  for (const { el, ox, oy } of affected) {
    const dx = dragX - ox;
    const dy = dragY - oy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxPull = 80 * strength;
    const pull = Math.min(maxPull, maxPull * (300 / (dist + 100)));
    const tx = (dx / (dist || 1)) * pull;
    const ty = (dy / (dist || 1)) * pull;
    el.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  // Overlay intensity
  const overlay = document.getElementById('gravityOverlay');
  if (overlay) overlay.style.background = `rgba(0,0,0,${0.05 + strength * 0.15})`;

  raf = requestAnimationFrame(tickGravity);
}

export function initGravityEgg(): void {
  const logo = document.querySelector('.logo');
  if (!logo) return;

  let pressTimer = 0;

  logo.addEventListener('mousedown', (e: Event) => {
    // Long press to start drag (300ms to avoid conflict with click)
    pressTimer = window.setTimeout(() => startDrag(e as MouseEvent), 300);
  });

  logo.addEventListener('mouseup', () => { clearTimeout(pressTimer); endDrag(); });
  logo.addEventListener('mouseleave', () => { clearTimeout(pressTimer); });

  document.addEventListener('mousemove', (e) => moveDrag(e));
  document.addEventListener('mouseup', () => endDrag());

  // Touch support
  logo.addEventListener('touchstart', (e: Event) => {
    pressTimer = window.setTimeout(() => startDrag(e as TouchEvent), 300);
  }, { passive: false });
  logo.addEventListener('touchend', () => { clearTimeout(pressTimer); endDrag(); });
  document.addEventListener('touchmove', (e) => moveDrag(e as TouchEvent), { passive: true });
  document.addEventListener('touchend', () => endDrag());
}
