import React, { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const W = 400; // 논리 캔버스 크기
const H = 640;
const FLOOR = 80; // 카메라가 0일 때 테이블 윗면의 화면 위치 (아래에서부터)
const SPAWN_GAP = 170; // 스택 꼭대기 위로 재료가 움직이는 높이
const CAM_LEAD = 300; // 스택 꼭대기가 화면 아래에서 이만큼 위에 오도록 카메라 이동
const GRAVITY = 2200;
const PERFECT_TOLERANCE = 5;
const BASE_SPEED = 150;
const SPEED_STEP = 9;
const MAX_SPEED = 440;
const EDGE_PADDING = 6;
const BEST_KEY = 'hamburger-stack-best';

type IngredientType = 'patty' | 'cheese' | 'lettuce' | 'tomato' | 'onion' | 'bacon' | 'pickle';
type PieceType = IngredientType | 'bun';

const PIECES: Record<PieceType, { name: string; emoji: string; w: number; h: number; mass: number; weight: number }> = {
  bun: { name: '빵', emoji: '🍞', w: 190, h: 34, mass: 1, weight: 0 },
  patty: { name: '패티', emoji: '🥩', w: 168, h: 22, mass: 1.6, weight: 3 },
  cheese: { name: '치즈', emoji: '🧀', w: 176, h: 8, mass: 0.6, weight: 2 },
  lettuce: { name: '양상추', emoji: '🥬', w: 184, h: 12, mass: 0.4, weight: 2 },
  tomato: { name: '토마토', emoji: '🍅', w: 156, h: 12, mass: 0.8, weight: 2 },
  onion: { name: '양파', emoji: '🧅', w: 152, h: 9, mass: 0.6, weight: 1 },
  bacon: { name: '베이컨', emoji: '🥓', w: 172, h: 10, mass: 0.7, weight: 1 },
  pickle: { name: '피클', emoji: '🥒', w: 144, h: 8, mass: 0.4, weight: 1 },
};

const INGREDIENTS = (Object.keys(PIECES) as PieceType[]).filter((t): t is IngredientType => t !== 'bun');

// ---------------------------------------------------------------------------
// 게임 상태 타입
// ---------------------------------------------------------------------------

interface Piece {
  type: PieceType;
  x: number; // 중심 x
  y: number; // 바닥 y (월드 좌표, 위로 증가)
  w: number;
  h: number;
  seed: number;
  landedAt: number;
}

interface Moving extends Piece {
  dir: 1 | -1;
  speed: number;
}

interface FallingPiece extends Piece {
  vx: number;
  vy: number;
  angle: number;
  va: number;
  alpha: number;
}

interface Collapse {
  pieces: Piece[];
  pivotX: number;
  pivotY: number;
  dir: 1 | -1;
  angle: number;
  omega: number;
  drop: number;
  vy: number;
  alpha: number;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
  size: number;
}

type Phase = 'ready' | 'moving' | 'dropping' | 'settling' | 'missing' | 'collapsing' | 'over';

interface Game {
  phase: Phase;
  stack: Piece[];
  current: Moving | null;
  vy: number;
  falling: FallingPiece[];
  collapse: Collapse | null;
  popups: Popup[];
  cam: number;
  score: number;
  combo: number;
  next: IngredientType;
  time: number;
  timer: number;
  shake: number;
  overAt: number;
}

interface UiState {
  phase: 'ready' | 'playing' | 'over';
  score: number;
  best: number;
  isNewBest: boolean;
  next: IngredientType;
  stability: number;
  count: number;
  heightCm: number;
}

// ---------------------------------------------------------------------------
// 순수 로직
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function pickNext(prev?: IngredientType): IngredientType {
  const pool = INGREDIENTS.filter((t) => t !== prev);
  const total = pool.reduce((s, t) => s + PIECES[t].weight, 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= PIECES[t].weight;
    if (r <= 0) return t;
  }
  return pool[0];
}

function makeBun(): Piece {
  const s = PIECES.bun;
  return { type: 'bun', x: W / 2, y: 0, w: s.w, h: s.h, seed: 0, landedAt: -10 };
}

/** 각 층 위에 얹힌 재료들의 무게중심이 그 층을 벗어나는지 검사 */
function analyzeStack(stack: Piece[]): { stability: number; collapse: { level: number; dir: 1 | -1 } | null } {
  let stability = 1;
  for (let k = 0; k < stack.length - 1; k++) {
    let m = 0;
    let mx = 0;
    for (let i = k + 1; i < stack.length; i++) {
      const mass = PIECES[stack[i].type].mass;
      m += mass;
      mx += mass * stack[i].x;
    }
    const com = mx / m;
    const half = stack[k].w / 2;
    const off = com - stack[k].x;
    if (Math.abs(off) > half) {
      return { stability: 0, collapse: { level: k, dir: off > 0 ? 1 : -1 } };
    }
    stability = Math.min(stability, 1 - Math.abs(off) / half);
  }
  return { stability, collapse: null };
}

const stackHeight = (stack: Piece[]) => {
  const top = stack[stack.length - 1];
  return top.y + top.h;
};

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

function createGame(): Game {
  return {
    phase: 'ready',
    stack: [makeBun()],
    current: null,
    vy: 0,
    falling: [],
    collapse: null,
    popups: [],
    cam: 0,
    score: 0,
    combo: 0,
    next: pickNext(),
    time: 0,
    timer: 0,
    shake: 0,
    overAt: -10,
  };
}

// ---------------------------------------------------------------------------
// 그리기
// ---------------------------------------------------------------------------

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tl: number, tr = tl, br = tl, bl = tl) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function drawPiece(ctx: CanvasRenderingContext2D, type: PieceType, cx: number, top: number, w: number, h: number, seed: number) {
  const x = cx - w / 2;
  ctx.lineJoin = 'round';
  switch (type) {
    case 'bun': {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, '#F6C06A');
      g.addColorStop(1, '#C47428');
      ctx.fillStyle = g;
      rr(ctx, x, top, w, h, 6, 6, 20, 20);
      ctx.fill();
      ctx.fillStyle = '#FBDDA2';
      rr(ctx, x + 4, top, w - 8, 6, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,60,10,0.35)';
      ctx.lineWidth = 1.5;
      rr(ctx, x, top, w, h, 6, 6, 20, 20);
      ctx.stroke();
      break;
    }
    case 'patty': {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, '#8A4E2A');
      g.addColorStop(1, '#4A2511');
      ctx.fillStyle = g;
      rr(ctx, x, top, w, h, h / 2.2);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,12,4,0.35)';
      for (let i = 0; i < 7; i++) {
        const px = x + w * (0.1 + 0.13 * i) + Math.sin(seed + i) * 4;
        const py = top + h * (0.35 + 0.3 * ((i + Math.floor(seed)) % 2));
        ctx.beginPath();
        ctx.ellipse(px, py, 5, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,200,150,0.25)';
      rr(ctx, x + 8, top + 2, w - 16, 3, 1.5);
      ctx.fill();
      break;
    }
    case 'cheese': {
      ctx.fillStyle = '#FFC83A';
      ctx.strokeStyle = '#E2A010';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + w, top);
      ctx.lineTo(x + w, top + h);
      const drips = [0.86, 0.55, 0.18].map((f) => clamp(f + Math.sin(seed * 3 + f * 10) * 0.06, 0.08, 0.92));
      for (const f of drips) {
        const dx = x + w * f;
        ctx.lineTo(dx + 10, top + h);
        ctx.lineTo(dx, top + h + 11);
        ctx.lineTo(dx - 10, top + h);
      }
      ctx.lineTo(x, top + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,180,0.6)';
      ctx.fillRect(x + 4, top + 1.5, w - 8, 2);
      break;
    }
    case 'lettuce': {
      const steps = 24;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x - 4 + ((w + 8) * i) / steps;
        const py = top + 2 + Math.sin(i * 1.3 + seed) * 2.5;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = steps; i >= 0; i--) {
        const px = x - 4 + ((w + 8) * i) / steps;
        const py = top + h + 1 + Math.sin(i * 1.7 + seed * 2) * 3;
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#74C447';
      ctx.fill();
      ctx.strokeStyle = '#4A922B';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(220,255,190,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 10, top + h / 2 + 1);
      ctx.lineTo(x + w - 10, top + h / 2 + 1);
      ctx.stroke();
      break;
    }
    case 'tomato': {
      ctx.fillStyle = '#D83A26';
      rr(ctx, x, top, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = '#F06A4E';
      rr(ctx, x + 4, top + 2.5, w - 8, h - 5, (h - 5) / 2);
      ctx.fill();
      ctx.fillStyle = '#FCE4A0';
      for (let i = 0; i < 8; i++) {
        const px = x + w * (0.12 + 0.105 * i);
        ctx.beginPath();
        ctx.ellipse(px, top + h / 2 + Math.sin(seed + i * 2) * 1, 2.2, 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'onion': {
      ctx.fillStyle = '#F7ECF8';
      ctx.strokeStyle = '#B07BC0';
      ctx.lineWidth = 2;
      const gap = 6;
      const half = (w - gap) / 2;
      rr(ctx, x, top, half, h, h / 2);
      ctx.fill();
      ctx.stroke();
      rr(ctx, x + half + gap, top, half, h, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(176,123,192,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 6, top + h / 2);
      ctx.lineTo(x + half - 6, top + h / 2);
      ctx.moveTo(x + half + gap + 6, top + h / 2);
      ctx.lineTo(x + w - 6, top + h / 2);
      ctx.stroke();
      break;
    }
    case 'bacon': {
      const steps = 20;
      const wave = (i: number) => Math.sin(i * 0.9 + seed) * 2.5;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x + (w * i) / steps;
        const py = top + 2 + wave(i);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = steps; i >= 0; i--) {
        ctx.lineTo(x + (w * i) / steps, top + h - 1 + wave(i));
      }
      ctx.closePath();
      ctx.fillStyle = '#B5422C';
      ctx.fill();
      ctx.strokeStyle = '#7E2716';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = '#F4BFA4';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x + 3 + ((w - 6) * i) / steps;
        const py = top + h / 2 + 0.5 + wave(i);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    }
    case 'pickle': {
      const n = Math.max(3, Math.round(w / 34));
      const slot = w / n;
      for (let i = 0; i < n; i++) {
        const px = x + slot * (i + 0.5);
        ctx.beginPath();
        ctx.ellipse(px, top + h / 2, slot / 2 + 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#8DB847';
        ctx.fill();
        ctx.strokeStyle = '#557A1D';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#D8EBA8';
        ctx.beginPath();
        ctx.ellipse(px, top + h / 2, slot / 2 - 5, h / 2 - 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const STARS = Array.from({ length: 60 }, (_, i) => ({
  x: (Math.sin(i * 91.7) * 0.5 + 0.5) * W,
  y: (Math.sin(i * 47.3 + 1) * 0.5 + 0.5) * H,
  r: 0.6 + ((i * 37) % 10) / 10,
}));

const CLOUDS = Array.from({ length: 9 }, (_, i) => ({
  x: ((i * 137) % 280) + 70,
  y: 500 + i * 260,
  s: 0.7 + ((i * 53) % 10) / 20,
}));

/** 하늘 비율: 0 = 주방, 0.5 = 하늘, 1 = 우주 */
const skyRatio = (cam: number) => clamp(cam / 1000, 0, 1);

function drawBackground(ctx: CanvasRenderingContext2D, cam: number, time: number) {
  const t = skyRatio(cam);
  let top: string;
  let bottom: string;
  if (t < 0.5) {
    top = mix('#FFE3BA', '#79BEF2', t * 2);
    bottom = mix('#FFF8EC', '#CFEAFF', t * 2);
  } else {
    top = mix('#79BEF2', '#0B0E2E', (t - 0.5) * 2);
    bottom = mix('#CFEAFF', '#2B2F6E', (t - 0.5) * 2);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (t > 0.55) {
    const a = clamp((t - 0.55) * 2.5, 0, 1);
    for (const s of STARS) {
      const y = (((s.y + cam * 0.08) % H) + H) % H;
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(time * 2 + s.x));
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  for (const c of CLOUDS) {
    const sy = H - FLOOR - (c.y - cam * 0.5);
    if (sy < -60 || sy > H + 60) continue;
    ctx.globalAlpha = 0.75 * (1 - clamp((t - 0.6) * 3, 0, 1));
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(c.x, sy, 18 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x + 20 * c.s, sy - 8 * c.s, 22 * c.s, 0, Math.PI * 2);
    ctx.arc(c.x + 44 * c.s, sy, 17 * c.s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

const HamburgerStack: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game>(createGame());
  const actionRef = useRef<() => void>(() => {});
  const startRef = useRef<() => void>(() => {});
  const bestRef = useRef(0);

  const [ui, setUi] = useState<UiState>(() => {
    const best = loadBest();
    bestRef.current = best;
    return {
      phase: 'ready',
      score: 0,
      best,
      isNewBest: false,
      next: gameRef.current.next,
      stability: 1,
      count: 0,
      heightCm: 0,
    };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = gameRef.current;
    const sync = (patch: Partial<UiState>) => setUi((prev) => ({ ...prev, ...patch }));

    const minX = (w: number) => w / 2 + EDGE_PADDING;
    const maxX = (w: number) => W - w / 2 - EDGE_PADDING;
    const toScreenY = (wy: number) => H - FLOOR - (wy - g.cam);

    const popup = (text: string, x: number, y: number, color: string, size = 20) => {
      g.popups.push({ text, x, y, t: 0, color, size });
    };

    const spawn = () => {
      const type = g.next;
      g.next = pickNext(type);
      const spec = PIECES[type];
      const fromLeft = Math.random() < 0.5;
      g.current = {
        type,
        x: fromLeft ? minX(spec.w) : maxX(spec.w),
        y: stackHeight(g.stack) + SPAWN_GAP,
        w: spec.w,
        h: spec.h,
        seed: Math.random() * 10,
        landedAt: 0,
        dir: fromLeft ? 1 : -1,
        speed: Math.min(MAX_SPEED, BASE_SPEED + SPEED_STEP * (g.stack.length - 1)),
      };
      g.phase = 'moving';
      sync({ next: g.next });
    };

    const start = () => {
      g.stack = [makeBun()];
      g.current = null;
      g.falling = [];
      g.collapse = null;
      g.popups = [];
      g.score = 0;
      g.combo = 0;
      g.shake = 0;
      spawn();
      sync({ phase: 'playing', score: 0, isNewBest: false, stability: 1, count: 0, heightCm: 0 });
    };

    const gameOver = () => {
      g.phase = 'over';
      g.overAt = g.time;
      const isNewBest = g.score > bestRef.current;
      if (isNewBest) {
        bestRef.current = g.score;
        saveBest(g.score);
      }
      sync({ phase: 'over', score: g.score, best: bestRef.current, isNewBest });
    };

    const land = () => {
      const c = g.current;
      if (!c) return;
      const below = g.stack[g.stack.length - 1];
      c.y = stackHeight(g.stack);
      const perfect = Math.abs(c.x - below.x) <= PERFECT_TOLERANCE;
      if (perfect) c.x = below.x;
      const offset = c.x - below.x;
      const overlap = Math.min(c.x + c.w / 2, below.x + below.w / 2) - Math.max(c.x - c.w / 2, below.x - below.w / 2);

      // 절반 미만으로 걸치면 미끄러져 떨어짐
      if (overlap < c.w / 2) {
        const dir = offset >= 0 ? 1 : -1;
        const touching = overlap > 0;
        g.falling.push({
          ...c,
          vx: dir * (touching ? 110 : 30),
          vy: touching ? 60 : -g.vy * 0.6,
          angle: 0,
          va: dir * (touching ? 5 : 1.2),
          alpha: 1,
        });
        g.current = null;
        g.combo = 0;
        g.phase = 'missing';
        g.timer = 1.0;
        g.shake = 6;
        popup('앗! 떨어졌다', W / 2, c.y + 60, '#E5484D', 24);
        return;
      }

      g.stack.push({ type: c.type, x: c.x, y: c.y, w: c.w, h: c.h, seed: c.seed, landedAt: g.time });
      g.current = null;
      g.combo = perfect ? g.combo + 1 : 0;
      const gained = 1 + (perfect ? 1 + Math.min(g.combo, 5) : 0);
      g.score += gained;
      if (perfect) {
        popup(g.combo > 1 ? `Perfect x${g.combo}! +${gained}` : `Perfect! +${gained}`, c.x, c.y + c.h + 24, '#F59E0B', 22);
      } else {
        popup('+1', c.x, c.y + c.h + 20, '#16A34A', 18);
      }

      const { stability, collapse } = analyzeStack(g.stack);
      sync({
        score: g.score,
        stability,
        count: g.stack.length - 1,
        heightCm: Math.round(stackHeight(g.stack)) / 10,
      });

      if (collapse) {
        const base = g.stack[collapse.level];
        const pieces = g.stack.splice(collapse.level + 1);
        g.collapse = {
          pieces,
          pivotX: base.x + (collapse.dir * base.w) / 2,
          pivotY: base.y + base.h,
          dir: collapse.dir,
          angle: 0,
          omega: 0.3,
          drop: 0,
          vy: 0,
          alpha: 1,
        };
        g.phase = 'collapsing';
        g.timer = 1.7;
        g.shake = 10;
        popup('와르르!', W / 2, base.y + 120, '#E5484D', 28);
        sync({ stability: 0 });
      } else {
        g.phase = 'settling';
        g.timer = 0.18;
      }
    };

    actionRef.current = () => {
      if (g.phase === 'ready') start();
      else if (g.phase === 'over') {
        if (g.time - g.overAt > 0.6) start();
      } else if (g.phase === 'moving') {
        g.phase = 'dropping';
        g.vy = 0;
      }
    };
    startRef.current = start;

    const update = (dt: number) => {
      g.time += dt;
      const c = g.current;

      if (g.phase === 'moving' && c) {
        c.x += c.dir * c.speed * dt;
        if (c.x > maxX(c.w)) {
          c.x = maxX(c.w);
          c.dir = -1;
        } else if (c.x < minX(c.w)) {
          c.x = minX(c.w);
          c.dir = 1;
        }
      } else if (g.phase === 'dropping' && c) {
        g.vy += GRAVITY * dt;
        c.y -= g.vy * dt;
        if (c.y <= stackHeight(g.stack)) land();
      } else if (g.phase === 'settling') {
        g.timer -= dt;
        if (g.timer <= 0) spawn();
      } else if (g.phase === 'missing' || g.phase === 'collapsing') {
        g.timer -= dt;
        if (g.timer <= 0) gameOver();
      }

      for (const f of g.falling) {
        f.vy -= GRAVITY * 0.7 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.angle += f.va * dt;
        f.alpha -= dt * 0.9;
      }
      g.falling = g.falling.filter((f) => f.alpha > 0);

      const col = g.collapse;
      if (col) {
        col.omega += (2.5 + 7 * Math.sin(col.angle + 0.15)) * dt;
        col.angle += col.omega * dt;
        if (col.angle > 0.5) {
          col.vy += GRAVITY * 0.6 * dt;
          col.drop += col.vy * dt;
        }
        if (col.angle > 1.2) col.alpha = Math.max(0, col.alpha - dt * 1.2);
      }

      for (const p of g.popups) p.t += dt;
      g.popups = g.popups.filter((p) => p.t < 1.1);

      g.shake *= Math.exp(-dt * 8);

      const target = g.phase === 'ready' ? 0 : Math.max(0, stackHeight(g.stack) - CAM_LEAD);
      g.cam += (target - g.cam) * Math.min(1, dt * 5);
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground(ctx, g.cam, g.time);

      ctx.save();
      if (g.shake > 0.3) {
        ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
      }

      // 높이 눈금 (100px = 10cm)
      const dark = skyRatio(g.cam) > 0.6;
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const firstMark = Math.max(1, Math.floor(g.cam / 100));
      for (let n = firstMark; n * 100 < g.cam + H; n++) {
        const y = toScreenY(n * 100);
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(80,50,20,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(12, y);
        ctx.stroke();
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(80,50,20,0.45)';
        ctx.fillText(`${n * 10}cm`, 15, y);
      }

      // 테이블 & 접시
      const floorY = toScreenY(0);
      if (floorY < H + 20) {
        ctx.fillStyle = '#A8693B';
        ctx.fillRect(0, floorY, W, H - floorY + 20);
        ctx.fillStyle = '#8C5430';
        ctx.fillRect(0, floorY, W, 6);
        ctx.strokeStyle = 'rgba(70,35,10,0.18)';
        ctx.lineWidth = 2;
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, floorY + 6 + i * 22);
          ctx.lineTo(W, floorY + 6 + i * 22);
          ctx.stroke();
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#DADADA';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(W / 2, floorY + 1, 130, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // 쌓인 재료
      for (const p of g.stack) {
        const bottom = toScreenY(p.y);
        if (bottom < -40 || bottom - p.h > H + 40) continue;
        const age = g.time - p.landedAt;
        const k = age < 0.6 ? Math.exp(-age * 12) * 0.25 : 0;
        ctx.save();
        ctx.translate(p.x, bottom);
        ctx.scale(1 + k * 0.4, 1 - k);
        ctx.translate(-p.x, -bottom);
        drawPiece(ctx, p.type, p.x, bottom - p.h, p.w, p.h, p.seed);
        ctx.restore();
      }

      // 무너지는 탑
      const col = g.collapse;
      if (col && col.alpha > 0) {
        const px = col.pivotX;
        const py = toScreenY(col.pivotY);
        ctx.save();
        ctx.globalAlpha = col.alpha;
        ctx.translate(0, col.drop);
        ctx.translate(px, py);
        ctx.rotate(col.dir * col.angle);
        ctx.translate(-px, -py);
        for (const p of col.pieces) {
          drawPiece(ctx, p.type, p.x, toScreenY(p.y + p.h), p.w, p.h, p.seed);
        }
        ctx.restore();
      }

      // 움직이는 재료 + 낙하 가이드
      const c = g.current;
      if (c) {
        const topY = toScreenY(stackHeight(g.stack));
        const pieceBottom = toScreenY(c.y);
        if (g.phase === 'moving') {
          ctx.save();
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(80,50,20,0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(c.x, pieceBottom + 4);
          ctx.lineTo(c.x, topY);
          ctx.stroke();
          ctx.restore();
        }
        drawPiece(ctx, c.type, c.x, pieceBottom - c.h, c.w, c.h, c.seed);
      }

      // 떨어지는 재료
      for (const f of g.falling) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, f.alpha);
        ctx.translate(f.x, toScreenY(f.y + f.h / 2));
        ctx.rotate(f.angle);
        drawPiece(ctx, f.type, 0, -f.h / 2, f.w, f.h, f.seed);
        ctx.restore();
      }

      // 팝업 텍스트
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of g.popups) {
        const a = 1 - p.t / 1.1;
        const y = toScreenY(p.y) - p.t * 45;
        ctx.globalAlpha = a;
        ctx.font = `800 ${p.size}px system-ui, sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(p.text, clamp(p.x, 90, W - 90), y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, clamp(p.x, 90, W - 90), y);
      }
      ctx.globalAlpha = 1;

      ctx.restore();
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt);
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      e.preventDefault();
      if (!e.repeat) actionRef.current();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const nextSpec = PIECES[ui.next];
  const stabilityColor = ui.stability > 0.5 ? 'bg-emerald-500' : ui.stability > 0.25 ? 'bg-amber-500' : 'bg-red-500';
  const boardWidth = 'min(100%, 400px, max(280px, calc((100vh - 230px) * 0.625)))';
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div className="min-h-full w-full flex flex-col items-center gap-3 p-4 bg-gradient-to-b from-amber-50 to-orange-100 text-neutral-900">
      <div className="flex flex-col gap-2" style={{ width: boardWidth }}>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-tight">🍔 햄버거 쌓기</h1>
          <div className="flex items-center gap-1 text-sm text-neutral-600">
            <Trophy className="h-4 w-4 text-amber-500" />
            최고 <span className="font-bold text-neutral-900 tabular-nums">{ui.best}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/80 px-2 py-1.5 shadow-sm">
            <div className="text-[11px] text-neutral-500">점수</div>
            <div className="text-lg font-extrabold tabular-nums">{ui.score}</div>
          </div>
          <div className="rounded-xl bg-white/80 px-2 py-1.5 shadow-sm">
            <div className="text-[11px] text-neutral-500">높이</div>
            <div className="text-lg font-extrabold tabular-nums">{ui.heightCm.toFixed(1)}cm</div>
          </div>
          <div className="rounded-xl bg-white/80 px-2 py-1.5 shadow-sm">
            <div className="text-[11px] text-neutral-500">다음 재료</div>
            <div className="text-lg font-extrabold leading-7">
              {ui.phase === 'playing' ? (
                <span title={nextSpec.name}>
                  {nextSpec.emoji} <span className="text-sm">{nextSpec.name}</span>
                </span>
              ) : (
                '—'
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600 shrink-0">안정도</span>
          <div className="h-2 flex-1 rounded-full bg-white/80 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${stabilityColor}`}
              style={{ width: `${Math.round(ui.stability * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div
        className="relative aspect-[5/8] rounded-2xl overflow-hidden shadow-xl ring-1 ring-black/5 touch-none select-none cursor-pointer"
        style={{ width: boardWidth }}
        onPointerDown={(e) => {
          e.preventDefault();
          actionRef.current();
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" aria-label="햄버거 쌓기 게임 화면" />

        {ui.phase === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 p-6">
            <div className="w-full rounded-2xl bg-white/95 p-5 text-center shadow-lg space-y-3">
              <div className="text-4xl">🍔</div>
              <h2 className="text-xl font-extrabold">햄버거 쌓기</h2>
              <ul className="text-sm text-neutral-600 space-y-1">
                <li>좌우로 움직이는 재료를 <b>스페이스바</b>나 <b>탭</b>으로 떨어뜨리세요.</li>
                <li>절반 이상 걸쳐야 쌓여요. 한쪽으로 기울면 와르르!</li>
                <li>정중앙에 떨어뜨리면 <b className="text-amber-600">Perfect</b> 보너스!</li>
              </ul>
              <Button size="lg" className="w-full" onPointerDown={stopPointer} onClick={() => startRef.current()}>
                <Play className="mr-2 h-4 w-4" /> 시작하기
              </Button>
            </div>
          </div>
        )}

        {ui.phase === 'over' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 p-6 animate-in fade-in duration-300">
            <div className="w-full rounded-2xl bg-white/95 p-5 text-center shadow-lg space-y-3">
              <h2 className="text-xl font-extrabold">게임 오버</h2>
              {ui.isNewBest && <Badge className="bg-amber-500 hover:bg-amber-500">🎉 신기록!</Badge>}
              <div className="text-5xl font-black tabular-nums">{ui.score}</div>
              <div className="text-sm text-neutral-600">
                재료 {ui.count}개 · 높이 {ui.heightCm.toFixed(1)}cm · 최고 {ui.best}점
              </div>
              <Button size="lg" className="w-full" onPointerDown={stopPointer} onClick={() => startRef.current()}>
                <RotateCcw className="mr-2 h-4 w-4" /> 다시 하기
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-neutral-500">스페이스바 또는 화면 탭으로 떨어뜨리기</p>
    </div>
  );
};

export default HamburgerStack;
