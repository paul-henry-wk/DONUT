// ═══════════════════════════════════════════════════════════════════
// donut-pet.ts — eSheep-style donut with eyes, rolling on UI surfaces
// Easter egg: click the 🍩 in the logo to toggle
// ═══════════════════════════════════════════════════════════════════

let SIZE = 40;            // SVG element size (grows when eating cookies)
let FOOT = 37;            // visual bottom of the donut circle within the SVG
const BASE_SIZE = 40;
const BASE_FOOT = 37;
const GRAVITY = 1000;
const SPEED = 65;
const MANUAL_SPEED = 150;
const JUMP_VEL = -440;
const BOUNCE = 0.3;
const MAX_PARTICLES = 40;
const COOKIE_INTERVAL = 6000; // ms between cookie spawns

const SPRINKLE_COLORS = ['#FFE44D', '#4DE8FF', '#C84DFF', '#4DFF7C', '#FF4D6A'];
const CRUMB_COLORS = ['#D49545', '#B87A30', '#C4883C'];
const POP_LAND = ['BOING!', 'MIAM!', 'HOP!', 'BONK!'];
const POP_JUMP = ['WHEEE!', 'HOP!', 'YIPEE!'];

interface Platform { left: number; right: number; y: number; }
interface Pet {
  el: HTMLElement;
  shadow: HTMLElement;
  overlay: HTMLElement;
  x: number; y: number;
  vx: number; vy: number;
  rot: number;
  dir: number;
  state: 'fall' | 'walk' | 'idle';
  timer: number;
  squish: number;
}
interface Particle {
  el: HTMLElement;
  x: number; y: number;
  vx: number; vy: number;
  life: number;
}

interface Cookie {
  el: HTMLElement;
  x: number; y: number;
  vy: number;
  rot: number;
  eaten: boolean;
}

let pet: Pet | null = null;
let raf = 0;
let prevTime = 0;
let crumbTimer = 0;
let airJumps = 0;
let cookieTimer = 0;
let cookiesEaten = 0;
let growScale = 1;
const keys = new Set<string>();
const particles: Particle[] = [];
const cookies: Cookie[] = [];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── SVG donut with eyes on outer edge + mouth/teeth in hole ─────
function createDonutSVG(): string {
  return `<svg viewBox="0 0 40 40" width="40" height="40" style="display:block">
  <defs>
    <radialGradient id="dbod" cx="35%" cy="35%"><stop offset="0%" stop-color="#F2C060"/><stop offset="100%" stop-color="#C07828"/></radialGradient>
    <radialGradient id="dfro" cx="50%" cy="80%"><stop offset="0%" stop-color="#FFB8D0"/><stop offset="100%" stop-color="#FF6B9A"/></radialGradient>
  </defs>
  <!-- Body -->
  <circle cx="20" cy="20" r="17" fill="url(#dbod)" stroke="#A06020" stroke-width=".8"/>
  <!-- Hole (mouth area) -->
  <circle cx="20" cy="20" r="6.5" fill="#5C2D10"/>
  <!-- Tongue -->
  <ellipse cx="20" cy="22.5" rx="4" ry="2.5" fill="#E85A6B"/>
  <!-- Teeth (top) -->
  <rect x="16" y="14.2" width="3.2" height="3" rx=".5" fill="white" stroke="#ddd" stroke-width=".3"/>
  <rect x="20" y="14.2" width="3.2" height="3" rx=".5" fill="white" stroke="#ddd" stroke-width=".3"/>
  <!-- Tooth (bottom) -->
  <rect x="18" y="23.5" width="3.5" height="2.5" rx=".5" fill="white" stroke="#ddd" stroke-width=".3"/>
  <!-- Frosting -->
  <path d="M4,17Q6,7 13,3.5Q17,2 20,2Q23,2 27,3.5Q34,7 36,17Q33,12 27,9Q23,7.5 20,7.5Q17,7.5 13,9Q7,12 4,17Z" fill="url(#dfro)"/>
  <path d="M6,17Q5.5,21 7,23Q8,20 7,17Z" fill="#FF85A8"/>
  <path d="M33,15Q34,20 32,22Q31,19 32,15Z" fill="#FF85A8"/>
  <!-- Sprinkles -->
  <rect x="10" y="8" width="4" height="2" rx="1" fill="#FFE44D" transform="rotate(25 12 9)"/>
  <rect x="17" y="5" width="4" height="2" rx="1" fill="#4DE8FF" transform="rotate(-15 19 6)"/>
  <rect x="25" y="7" width="4" height="2" rx="1" fill="#C84DFF" transform="rotate(40 27 8)"/>
  <rect x="30" y="12" width="3" height="1.5" rx=".75" fill="#4DFF7C" transform="rotate(-25 31.5 12.75)"/>
  <rect x="7" y="13" width="3" height="1.5" rx=".75" fill="#FF4D6A" transform="rotate(10 8.5 13.75)"/>
  <!-- Eyes on outer edge (top-left and top-right of the ring) -->
  <ellipse class="eye-l" cx="10" cy="12" rx="3.5" ry="4" fill="white" stroke="#C07828" stroke-width=".5"/>
  <ellipse class="eye-r" cx="30" cy="12" rx="3.5" ry="4" fill="white" stroke="#C07828" stroke-width=".5"/>
  <circle class="pupil-l" cx="11" cy="12.5" r="2" fill="#2D1B06"/>
  <circle class="pupil-r" cx="31" cy="12.5" r="2" fill="#2D1B06"/>
  <!-- Eye highlights -->
  <circle cx="11.5" cy="11" r=".8" fill="white" opacity=".9"/>
  <circle cx="31.5" cy="11" r=".8" fill="white" opacity=".9"/>
</svg>
<span class="donut-pet-zzz" style="display:none">z z z</span>
<span class="donut-pet-score" style="display:none">0</span>`;
}

// ── Platform detection ──────────────────────────────────────────
function getPlatforms(): Platform[] {
  const out: Platform[] = [];
  const seen = new Set<Element>();
  const add = (el: Element | null, edge: 'top' | 'bottom' = 'top') => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 3 || r.bottom < 0 || r.top > window.innerHeight) return;
    out.push({ left: r.left, right: r.right, y: edge === 'top' ? r.top : r.bottom });
  };
  add(document.querySelector('.topbar'), 'bottom');
  ['.run-bar', '.progress-bar', '.terminal', '.resizer', '.tabs',
   '.term-bar', '.workflow-bar', '.donut-mode-bar'].forEach(s => add(document.querySelector(s)));
  document.querySelectorAll('.s-card, .s-group-label, .wiz-step, .cfg-envs, .cfg-form, .pr-card, .build-card, .diff-block, .modal-box')
    .forEach(el => add(el));
  const page = document.querySelector('.page.active');
  if (page) for (const ch of page.children) add(ch);
  out.push({ left: 0, right: window.innerWidth, y: window.innerHeight - 2 });
  return out;
}

// ── Particles ───────────────────────────────────────────────────
function spawnParticles(x: number, y: number, count: number, colors: string[]): void {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const el = document.createElement('div');
    el.className = 'donut-particle';
    el.style.background = pick(colors);
    const sz = (2 + Math.random() * 4) + 'px';
    el.style.width = sz; el.style.height = sz;
    document.body.appendChild(el);
    particles.push({ el, x, y, vx: (Math.random() - 0.5) * 250, vy: -Math.random() * 250 - 30, life: 1 });
  }
}
function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.vy += 500 * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt * 1.8;
    pt.el.style.transform = `translate(${pt.x}px,${pt.y}px)`;
    pt.el.style.opacity = String(Math.max(0, pt.life));
    if (pt.life <= 0) { pt.el.remove(); particles.splice(i, 1); }
  }
}

function popText(x: number, y: number, text: string, color = '#FF85A2'): void {
  const el = document.createElement('div');
  el.className = 'donut-pop';
  el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

// ── Cookies ─────────────────────────────────────────────────────
const COOKIE_EMOJIS = ['\uD83C\uDF6A', '\uD83C\uDF6B', '\uD83C\uDF70', '\uD83C\uDF69', '\uD83C\uDF6C']; // 🍪🍫🍰🍩🍬

function spawnCookie(): void {
  const el = document.createElement('div');
  el.className = 'donut-cookie';
  el.textContent = pick(COOKIE_EMOJIS);
  const x = 30 + Math.random() * (window.innerWidth - 60);
  el.style.left = x + 'px';
  document.body.appendChild(el);
  cookies.push({ el, x, y: -30, vy: 40 + Math.random() * 30, rot: Math.random() * 360, eaten: false });
}

function updateCookies(dt: number): void {
  if (!pet) return;
  for (let i = cookies.length - 1; i >= 0; i--) {
    const c = cookies[i];
    if (c.eaten) continue;
    c.y += c.vy * dt;
    c.rot += 60 * dt;
    c.el.style.transform = `translateY(${c.y}px) rotate(${c.rot}deg)`;

    // Check collision with donut
    const dx = (c.x) - (pet.x + SIZE / 2);
    const dy = (c.y) - (pet.y + SIZE / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SIZE * 0.7) {
      // Eaten!
      c.eaten = true;
      c.el.classList.add('donut-cookie-eaten');
      setTimeout(() => { c.el.remove(); cookies.splice(cookies.indexOf(c), 1); }, 400);
      cookiesEaten++;
      growDonut();
      popText(pet.x + SIZE / 2, pet.y - 10, 'MIAM! \uD83C\uDF6A', '#FFB830');
      spawnParticles(pet.x + SIZE / 2, pet.y + SIZE / 2, 8, SPRINKLE_COLORS);
      // Update score
      const score = pet.el.querySelector('.donut-pet-score') as HTMLElement;
      if (score) { score.textContent = String(cookiesEaten); score.style.display = ''; }
    }

    // Remove if off screen
    if (c.y > window.innerHeight + 40) {
      c.el.remove();
      cookies.splice(i, 1);
    }
  }
}

function growDonut(): void {
  if (!pet) return;
  growScale = Math.min(2.5, growScale + 0.08);
  SIZE = Math.round(BASE_SIZE * growScale);
  FOOT = Math.round(BASE_FOOT * growScale);
  pet.el.style.width = SIZE + 'px';
  pet.el.style.height = SIZE + 'px';
  const svg = pet.el.querySelector('svg');
  if (svg) { svg.setAttribute('width', String(SIZE)); svg.setAttribute('height', String(SIZE)); }
}

// ── Keyboard ────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent): void {
  if (!pet) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); toggleDonutPet(); return; }
  e.stopPropagation();
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault(); keys.add(e.key);
  }
}
function onKeyUp(e: KeyboardEvent): void { keys.delete(e.key); }

// ── Animation loop ──────────────────────────────────────────────
function tick(now: number): void {
  if (!pet) return;
  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  const p = pet;
  const platforms = getPlatforms();

  const footY = () => p.y + FOOT;
  const onPlatform = (): boolean => {
    const cx = p.x + SIZE / 2;
    const foot = footY();
    for (const pl of platforms)
      if (cx >= pl.left && cx <= pl.right && Math.abs(foot - pl.y) < 4) return true;
    return false;
  };

  // ── Manual input ──
  const hasLR = keys.has('ArrowLeft') || keys.has('ArrowRight');
  const wantJump = keys.has('ArrowUp');
  const grounded = p.state === 'walk' || p.state === 'idle';

  if (hasLR && grounded) {
    p.dir = keys.has('ArrowRight') ? 1 : -1;
    p.state = 'walk'; p.timer = 1;
    p.x += p.dir * MANUAL_SPEED * dt;
    p.rot += p.dir * MANUAL_SPEED * dt * (360 / (Math.PI * SIZE));
    if (!onPlatform()) { p.state = 'fall'; p.vx = p.dir * MANUAL_SPEED * 0.5; }
  }

  if (wantJump && grounded) {
    p.state = 'fall'; p.vy = JUMP_VEL;
    p.vx = hasLR ? p.dir * MANUAL_SPEED * 0.7 : 0;
    airJumps = 0; keys.delete('ArrowUp');
    spawnParticles(p.x + SIZE / 2, footY(), 4, CRUMB_COLORS);
    popText(p.x + SIZE / 2, p.y - 5, pick(POP_JUMP), '#4DE8FF');
  } else if (wantJump && p.state === 'fall' && airJumps < 1) {
    p.vy = JUMP_VEL * 0.75;
    if (hasLR) p.vx = p.dir * MANUAL_SPEED * 0.6;
    airJumps++; keys.delete('ArrowUp');
    spawnParticles(p.x + SIZE / 2, footY(), 6, SPRINKLE_COLORS);
    popText(p.x + SIZE / 2, p.y - 5, '\u2728 2x!', '#FFE44D');
  }

  if (keys.has('ArrowDown') && grounded) {
    const cx = p.x + SIZE / 2;
    for (const pl of platforms) {
      if (cx >= pl.left && cx <= pl.right && Math.abs(footY() - pl.y) < 4) {
        p.y = pl.y - FOOT + 10;
        p.state = 'fall'; p.vy = 80; p.vx = 0;
        keys.delete('ArrowDown');
        spawnParticles(p.x + SIZE / 2, pl.y, 3, SPRINKLE_COLORS);
        break;
      }
    }
  }

  if (hasLR && p.state === 'fall') {
    p.vx += (keys.has('ArrowRight') ? 1 : -1) * 700 * dt;
    p.dir = keys.has('ArrowRight') ? 1 : -1;
  }

  const manual = hasLR || wantJump;

  // ── State machine ─────────────────────────────────────────────
  switch (p.state) {
    case 'fall': {
      p.vy += GRAVITY * dt;
      const oldFoot = footY();
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.dir * 200 * dt;
      const cx = p.x + SIZE / 2;
      const newFoot = footY();
      let landed: Platform | null = null;
      let landY = Infinity;
      for (const pl of platforms) {
        if (cx >= pl.left && cx <= pl.right && pl.y >= oldFoot - 1 && pl.y <= newFoot + 1 && pl.y < landY) {
          landed = pl; landY = pl.y;
        }
      }
      if (landed) {
        p.y = landed.y - FOOT;
        const impact = Math.abs(p.vy);
        if (impact > 150) {
          p.vy = -p.vy * BOUNCE;
          p.squish = Math.min(0.4, impact / 800);
          spawnParticles(p.x + SIZE / 2, landed.y, Math.min(10, Math.floor(impact / 50)), SPRINKLE_COLORS);
          if (impact > 300) popText(p.x + SIZE / 2, p.y, pick(POP_LAND), '#FF6B9A');
        } else {
          p.vy = 0; p.vx = 0; p.state = 'walk';
          p.timer = 2 + Math.random() * 3; p.squish = 0.15; airJumps = 0;
        }
      }
      if (p.y > window.innerHeight + 80) {
        p.x = SIZE + Math.random() * (window.innerWidth - SIZE * 3);
        p.y = -SIZE * 2; p.vy = 0; p.vx = 0;
      }
      break;
    }
    case 'walk': {
      if (!manual) {
        p.x += p.dir * SPEED * dt;
        p.rot += p.dir * SPEED * dt * (360 / (Math.PI * SIZE));
        if (!onPlatform()) {
          if (Math.random() < 0.6) { p.dir = -p.dir; p.x += p.dir * 8; }
          else { p.state = 'fall'; p.vx = p.dir * SPEED * 0.5; }
        }
        p.timer -= dt;
        if (p.timer <= 0) {
          const r = Math.random();
          if (r < 0.2) { p.state = 'idle'; p.timer = 1.5 + Math.random() * 3; }
          else if (r < 0.35) { p.state = 'fall'; p.vy = JUMP_VEL; p.vx = p.dir * SPEED * 0.7; airJumps = 0; }
          else if (r < 0.55) { p.dir = -p.dir; p.timer = 2 + Math.random() * 3; }
          else { p.timer = 2 + Math.random() * 4; }
        }
      }
      crumbTimer -= dt * (manual ? 3 : 1);
      if (crumbTimer <= 0) {
        crumbTimer = 0.3;
        spawnParticles(p.x + SIZE / 2 - p.dir * SIZE * 0.3, footY() - 3, 1, CRUMB_COLORS);
      }
      break;
    }
    case 'idle': {
      if (!manual) {
        p.rot += Math.sin(now / 300) * 0.5;
        if (!onPlatform()) { p.state = 'fall'; p.vx = 0; }
        p.timer -= dt;
        if (p.timer <= 0) { p.state = 'walk'; p.timer = 2 + Math.random() * 3; if (Math.random() < 0.5) p.dir = -p.dir; }
      }
      break;
    }
  }

  if (p.x < 0) { p.x = 0; p.dir = 1; }
  if (p.x > window.innerWidth - SIZE) { p.x = window.innerWidth - SIZE; p.dir = -1; }

  p.squish *= 0.85;
  if (p.squish < 0.01) p.squish = 0;

  // ── Render ────────────────────────────────────────────────────
  const sx = 1 + p.squish * 0.5;
  const sy = 1 - p.squish * 0.4;
  p.el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.rot}deg) scale(${sx},${sy})`;

  // Eyes: pupils follow direction, widen when falling
  const ox = p.dir * 1.5;
  const oy = (p.state === 'fall' && p.vy > 100) ? 1.5 : 0;
  const pul = p.el.querySelector('.pupil-l');
  const pur = p.el.querySelector('.pupil-r');
  if (pul) { pul.setAttribute('cx', String(11 + ox)); pul.setAttribute('cy', String(12.5 + oy)); }
  if (pur) { pur.setAttribute('cx', String(31 + ox)); pur.setAttribute('cy', String(12.5 + oy)); }
  const eyeRy = p.state === 'fall' && p.vy > 200 ? '5.5' : p.state === 'idle' ? '2.5' : '4';
  p.el.querySelector('.eye-l')?.setAttribute('ry', eyeRy);
  p.el.querySelector('.eye-r')?.setAttribute('ry', eyeRy);

  // zzz
  const zzz = p.el.querySelector('.donut-pet-zzz') as HTMLElement | null;
  if (zzz) zzz.style.display = p.state === 'idle' ? '' : 'none';

  // Shadow
  const foot = footY();
  const cx2 = p.x + SIZE / 2;
  let shadowY = window.innerHeight;
  for (const pl2 of platforms)
    if (cx2 >= pl2.left && cx2 <= pl2.right && pl2.y >= foot - 2 && pl2.y < shadowY) shadowY = pl2.y;
  p.shadow.style.left = cx2 + 'px';
  p.shadow.style.top = shadowY + 'px';
  const dist = shadowY - foot;
  p.shadow.style.opacity = String(Math.max(0, 0.35 - dist / 400));
  p.shadow.style.transform = `translate(-50%,-50%) scaleX(${Math.max(0.4, 1 - dist / 500)})`;

  // Card wobble
  if (p.state === 'walk') {
    const hitEl = document.elementFromPoint(cx2, foot + 2);
    if (hitEl) {
      const card = hitEl.closest('.s-card, .wiz-step, .pr-card, .build-card');
      if (card && !card.classList.contains('donut-touched')) {
        card.classList.add('donut-touched');
        setTimeout(() => card.classList.remove('donut-touched'), 300);
      }
    }
  }

  updateParticles(dt);
  updateCookies(dt);

  // Spawn cookies periodically
  cookieTimer -= dt * 1000;
  if (cookieTimer <= 0) {
    cookieTimer = COOKIE_INTERVAL + Math.random() * 3000;
    spawnCookie();
  }

  raf = requestAnimationFrame(tick);
}

// ── Public API ──────────────────────────────────────────────────

export function toggleDonutPet(): void {
  if (pet) {
    cancelAnimationFrame(raf);
    pet.el.remove();
    pet.shadow.remove();
    pet.overlay.remove();
    pet = null;
    keys.clear();
    particles.forEach(pt => pt.el.remove());
    particles.length = 0;
    cookies.forEach(c => c.el.remove());
    cookies.length = 0;
    cookiesEaten = 0; growScale = 1; SIZE = BASE_SIZE; FOOT = BASE_FOOT;
    document.querySelectorAll('.donut-pop').forEach(e => e.remove());
    document.querySelector('.donut-mode-bar')?.remove();
    document.body.classList.remove('donut-mode');
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    return;
  }

  // Blur overlay
  const overlay = document.createElement('div');
  overlay.className = 'donut-overlay';
  overlay.innerHTML = '<button class="donut-exit-btn" onclick="toggleDonutPet()">\u2715 Exit Donut Mode</button>';

  const el = document.createElement('div');
  el.className = 'donut-pet';
  el.innerHTML = createDonutSVG();

  const shadow = document.createElement('div');
  shadow.className = 'donut-pet-shadow';

  const bar = document.createElement('div');
  bar.className = 'donut-mode-bar';
  bar.innerHTML =
    '\uD83C\uDF69 <b>DONUT MODE</b> \u2014 ' +
    '<kbd>\u2190</kbd><kbd>\u2192</kbd> roll ' +
    '\u00B7 <kbd>\u2191</kbd> jump (\u00D72!) ' +
    '\u00B7 <kbd>\u2193</kbd> drop ' +
    '\u00B7 <kbd>ESC</kbd> exit';

  document.body.appendChild(overlay);
  document.body.appendChild(shadow);
  document.body.appendChild(el);
  document.body.appendChild(bar);
  document.body.classList.add('donut-mode');

  const logoO = document.querySelector('.logo-o');
  let startX = window.innerWidth / 2 - SIZE / 2;
  let startY = -SIZE;
  if (logoO) {
    const lr = logoO.getBoundingClientRect();
    startX = lr.left + lr.width / 2 - SIZE / 2;
    startY = lr.top + lr.height / 2 - SIZE / 2;
  }

  pet = {
    el, shadow, overlay,
    x: startX, y: startY,
    vx: 0, vy: 0, rot: 0,
    dir: Math.random() < 0.5 ? 1 : -1,
    state: 'fall', timer: 0, squish: 0,
  };

  airJumps = 0; crumbTimer = 0; cookieTimer = 3000;
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  prevTime = performance.now();
  raf = requestAnimationFrame(tick);
}

export function isDonutPetActive(): boolean {
  return pet !== null;
}
