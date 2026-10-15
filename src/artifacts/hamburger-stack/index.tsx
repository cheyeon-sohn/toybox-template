import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Heart, Play, RotateCcw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const W = 480; // 논리 캔버스 크기 (3:4)
const H = 640;
const FLOOR = 120; // 카메라가 0일 때 도마 윗면의 화면 위치 (아래에서부터)
const SPAWN_GAP = 210; // 스택 꼭대기 위로 재료가 움직이는 높이
const CAM_LEAD = 200;
const GRAVITY = 2000;
const PERFECT_TOLERANCE = 6;
const EDGE_PADDING = 8;
const MAX_HEARTS = 3;
const BEST_KEY = 'hamburger-stack-best-v2';
const OL = '#3B2416'; // 카툰 외곽선 색
const FONT = "'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

type IngredientType = 'patty' | 'cheese' | 'lettuce' | 'tomato' | 'onion' | 'bacon' | 'pickle';
type PieceType = IngredientType | 'bunBottom' | 'bunTop' | 'rotten';

const PIECES: Record<PieceType, { name: string; w: number; h: number; mass: number; weight: number }> = {
  bunBottom: { name: '아랫빵', w: 210, h: 30, mass: 1, weight: 0 },
  bunTop: { name: '윗빵', w: 206, h: 54, mass: 1.2, weight: 0 },
  patty: { name: '패티', w: 184, h: 22, mass: 1.6, weight: 3 },
  cheese: { name: '치즈', w: 192, h: 8, mass: 0.6, weight: 2 },
  lettuce: { name: '양상추', w: 198, h: 14, mass: 0.4, weight: 2 },
  tomato: { name: '토마토', w: 170, h: 13, mass: 0.8, weight: 2 },
  onion: { name: '양파', w: 166, h: 10, mass: 0.6, weight: 1 },
  bacon: { name: '베이컨', w: 186, h: 11, mass: 0.7, weight: 1 },
  pickle: { name: '피클', w: 158, h: 9, mass: 0.4, weight: 1 },
  rotten: { name: '상한 생선', w: 132, h: 28, mass: 1, weight: 0 },
};

const INGREDIENTS: IngredientType[] = ['patty', 'cheese', 'lettuce', 'tomato', 'onion', 'bacon', 'pickle'];

type ObstacleKey = 'wind' | 'fly' | 'conveyor' | 'rotten';

const OBSTACLES: { key: ObstacleKey; from: number; emoji: string; name: string; desc: string }[] = [
  { key: 'wind', from: 2, emoji: '🌬️', name: '바람', desc: '떨어지는 재료가 바람에 밀려요' },
  { key: 'fly', from: 3, emoji: '🪰', name: '파리', desc: '파리에 부딪히면 재료가 튕겨 나가요' },
  { key: 'conveyor', from: 4, emoji: '🔄', name: '움직이는 도마', desc: '도마가 좌우로 움직여요' },
  { key: 'rotten', from: 5, emoji: '🐟', name: '상한 생선', desc: '생선은 떨어뜨리지 말고 그냥 보내세요' },
];

const THEMES = [
  { top: '#FFE6C4', bottom: '#FFC995', dot: '#FFF5E6' },
  { top: '#DDF7EA', bottom: '#9FE3C5', dot: '#F2FFF8' },
  { top: '#E6E6FF', bottom: '#BABEFF', dot: '#F6F6FF' },
  { top: '#FFE3EE', bottom: '#FFB3CF', dot: '#FFF4F8' },
  { top: '#DCF0FF', bottom: '#9ED2FF', dot: '#F3FAFF' },
];

const CONFETTI = ['#FF6B3D', '#FFC933', '#7BD35A', '#4DA8FF', '#FF7EB6', '#A77BFF'];

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

interface RoundConfig {
  target: number; // 윗빵 전에 쌓아야 하는 재료 수
  speed: number;
  wind: number;
  flies: number;
  flySpeed: number;
  conveyor: number;
  rottenChance: number;
}

interface Piece {
  type: PieceType;
  x: number; // 스택에서는 도마 중심 기준 상대 x, 그 외에는 절대 x
  y: number; // 바닥 y (월드 좌표, 위로 증가)
  w: number;
  h: number;
  seed: number;
  landedAt: number;
}

interface Moving extends Piece {
  dir: 1 | -1;
  speed: number;
  bounces: number;
}

interface FallingPiece extends Piece {
  vx: number;
  vy: number;
  angle: number;
  va: number;
  alpha: number;
}

interface Collapse {
  pieces: Piece[]; // 절대 x
  pivotX: number;
  pivotY: number;
  dir: 1 | -1;
  angle: number;
  omega: number;
  drop: number;
  vy: number;
  alpha: number;
}

interface Fly {
  x: number;
  dir: 1 | -1;
  yOff: number;
  phase: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  color: string;
  size: number;
  star: boolean;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t: number;
  color: string;
  size: number;
}

interface Banner {
  text: string;
  sub?: string;
  t: number;
}

type Phase = 'title' | 'moving' | 'dropping' | 'settling' | 'missing' | 'collapsing' | 'clear' | 'clearWait' | 'over';

interface Game {
  phase: Phase;
  round: number;
  cfg: RoundConfig;
  hearts: number;
  score: number;
  combo: number;
  count: number;
  roundMisses: number;
  stack: Piece[];
  current: Moving | null;
  lastType: PieceType | null;
  vy: number;
  wind: number;
  flies: Fly[];
  falling: FallingPiece[];
  collapse: Collapse | null;
  exiting: { pieces: Piece[]; dx: number; vx: number } | null;
  particles: Particle[];
  popups: Popup[];
  banner: Banner | null;
  cam: number;
  time: number;
  roundTime: number;
  timer: number;
  shake: number;
  inputLockUntil: number;
}

interface BestRecord {
  score: number;
  round: number;
}

interface ClearInfo {
  round: number;
  bonus: number;
  noMissBonus: number;
  heartGained: boolean;
  newObstacles: typeof OBSTACLES;
}

interface UiState {
  phase: 'title' | 'playing' | 'clear' | 'over';
  round: number;
  hearts: number;
  score: number;
  count: number;
  target: number;
  best: BestRecord;
  isNewBest: boolean;
  clear: ClearInfo | null;
}

// ---------------------------------------------------------------------------
// 순수 로직
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function roundConfig(r: number): RoundConfig {
  return {
    target: Math.min(3 + r, 12),
    speed: Math.min(150 + (r - 1) * 26, 430),
    wind: r >= 2 ? Math.min(70 + (r - 2) * 18, 170) : 0,
    flies: r >= 6 ? 2 : r >= 3 ? 1 : 0,
    flySpeed: 55 + r * 8,
    conveyor: r >= 4 ? Math.min(35 + (r - 4) * 10, 80) : 0,
    rottenChance: r >= 5 ? Math.min(0.18 + (r - 5) * 0.03, 0.32) : 0,
  };
}

const obstaclesFor = (r: number) => OBSTACLES.filter((o) => r >= o.from);

function pickIngredient(prev: PieceType | null): IngredientType {
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
  const s = PIECES.bunBottom;
  return { type: 'bunBottom', x: 0, y: 0, w: s.w, h: s.h, seed: 0, landedAt: -10 };
}

/** 각 층 위에 얹힌 재료들의 무게중심이 그 층을 벗어나면 무너짐 */
function findCollapse(stack: Piece[]): { level: number; dir: 1 | -1 } | null {
  for (let k = 0; k < stack.length - 1; k++) {
    let m = 0;
    let mx = 0;
    for (let i = k + 1; i < stack.length; i++) {
      const mass = PIECES[stack[i].type].mass;
      m += mass;
      mx += mass * stack[i].x;
    }
    const off = mx / m - stack[k].x;
    if (Math.abs(off) > stack[k].w / 2) return { level: k, dir: off > 0 ? 1 : -1 };
  }
  return null;
}

const stackHeight = (stack: Piece[]) => {
  const top = stack[stack.length - 1];
  return top.y + top.h;
};

function loadBest(): BestRecord {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
    if (v && typeof v.score === 'number') return { score: v.score, round: v.round || 1 };
  } catch {
    /* 무시 */
  }
  return { score: 0, round: 0 };
}

function saveBest(v: BestRecord) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(v));
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

function createGame(): Game {
  return {
    phase: 'title',
    round: 1,
    cfg: roundConfig(1),
    hearts: MAX_HEARTS,
    score: 0,
    combo: 0,
    count: 0,
    roundMisses: 0,
    stack: [makeBun()],
    current: null,
    lastType: null,
    vy: 0,
    wind: 0,
    flies: [],
    falling: [],
    collapse: null,
    exiting: null,
    particles: [],
    popups: [],
    banner: null,
    cam: 0,
    time: 0,
    roundTime: 0,
    timer: 0,
    shake: 0,
    inputLockUntil: 0,
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

function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, lw = 2.5) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OL;
  ctx.stroke();
}

const SESAME: [number, number, number][] = [
  [0.22, 0.55, -0.4], [0.34, 0.32, 0.3], [0.47, 0.5, -0.1], [0.58, 0.22, 0.5],
  [0.66, 0.48, -0.5], [0.78, 0.4, 0.2], [0.4, 0.7, 0.6], [0.6, 0.7, -0.3],
];

function drawPiece(ctx: CanvasRenderingContext2D, type: PieceType, cx: number, top: number, w: number, h: number, seed: number, time = 0) {
  const x = cx - w / 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (type) {
    case 'bunBottom': {
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, '#F9C063');
      g.addColorStop(1, '#E08A2E');
      rr(ctx, x, top, w, h, 7, 7, 16, 16);
      fillStroke(ctx, g);
      ctx.fillStyle = '#FFE4AE';
      rr(ctx, x + 4, top + 2.5, w - 8, 6, 3);
      ctx.fill();
      break;
    }
    case 'bunTop': {
      const by = top + h;
      ctx.beginPath();
      ctx.moveTo(x + 8, by);
      ctx.quadraticCurveTo(x, by, x, by - 10);
      ctx.bezierCurveTo(x, top + h * 0.1, x + w * 0.18, top, x + w / 2, top);
      ctx.bezierCurveTo(x + w * 0.82, top, x + w, top + h * 0.1, x + w, by - 10);
      ctx.quadraticCurveTo(x + w, by, x + w - 8, by);
      ctx.closePath();
      const g = ctx.createRadialGradient(x + w * 0.35, top + h * 0.25, 4, x + w / 2, top + h * 0.6, w * 0.6);
      g.addColorStop(0, '#FFD583');
      g.addColorStop(1, '#E3872C');
      fillStroke(ctx, g);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.28, top + h * 0.3, w * 0.11, h * 0.1, -0.35, 0, Math.PI * 2);
      ctx.fill();
      for (const [fx, fy, rot] of SESAME) {
        ctx.beginPath();
        ctx.ellipse(x + w * fx, top + h * fy, 4.2, 2.3, rot, 0, Math.PI * 2);
        fillStroke(ctx, '#FFF6DE', 1.2);
      }
      break;
    }
    case 'patty': {
      rr(ctx, x, top, w, h, 11);
      fillStroke(ctx, '#7A4122');
      ctx.fillStyle = 'rgba(255,180,130,0.35)';
      rr(ctx, x + 12, top + 3.5, w - 24, 4, 2);
      ctx.fill();
      ctx.strokeStyle = '#4C230F';
      ctx.lineWidth = 3;
      for (let i = 0; i < 6; i++) {
        const gx = x + w * (0.16 + i * 0.135) + Math.sin(seed + i) * 3;
        ctx.beginPath();
        ctx.moveTo(gx - 5, top + h * 0.72);
        ctx.lineTo(gx + 5, top + h * 0.42);
        ctx.stroke();
      }
      break;
    }
    case 'cheese': {
      const by = top + h;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + w, top);
      ctx.lineTo(x + w, by);
      const drips = [0.84, 0.52, 0.2].map((f) => clamp(f + Math.sin(seed * 3 + f * 10) * 0.05, 0.1, 0.9));
      for (const f of drips) {
        const dx = x + w * f;
        const depth = 11 + Math.sin(seed + f * 7) * 3;
        ctx.lineTo(dx + 9, by);
        ctx.quadraticCurveTo(dx + 8, by + depth, dx, by + depth);
        ctx.quadraticCurveTo(dx - 8, by + depth, dx - 9, by);
      }
      ctx.lineTo(x, by);
      ctx.closePath();
      fillStroke(ctx, '#FFC933');
      ctx.fillStyle = 'rgba(255,248,200,0.8)';
      rr(ctx, x + 6, top + 2, w - 12, 2, 1);
      ctx.fill();
      break;
    }
    case 'lettuce': {
      const steps = 22;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x - 6 + ((w + 12) * i) / steps;
        const py = top + 2 + Math.sin(i * 1.4 + seed) * 3;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = steps; i >= 0; i--) {
        const px = x - 6 + ((w + 12) * i) / steps;
        ctx.lineTo(px, top + h + 1 + Math.sin(i * 1.9 + seed * 2) * 3.5);
      }
      ctx.closePath();
      fillStroke(ctx, '#86D95E');
      ctx.strokeStyle = '#D4F7B5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 14, top + h / 2 + 1);
      ctx.lineTo(x + w - 14, top + h / 2 + 1);
      ctx.stroke();
      break;
    }
    case 'tomato': {
      rr(ctx, x, top, w, h, h / 2);
      fillStroke(ctx, '#EF4A3A');
      ctx.fillStyle = '#FF8468';
      rr(ctx, x + 5, top + 3, w - 10, h - 6, (h - 6) / 2);
      ctx.fill();
      ctx.fillStyle = '#FFE7A3';
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.ellipse(x + w * (0.1 + i * 0.1), top + h / 2, 2.4, 1.4, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'onion': {
      const gap = 6;
      const half = (w - gap) / 2;
      for (const ox of [x, x + half + gap]) {
        rr(ctx, ox, top, half, h, h / 2);
        fillStroke(ctx, '#FBF1FC', 2.2);
        ctx.strokeStyle = '#C99BD8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox + 7, top + h / 2);
        ctx.lineTo(ox + half - 7, top + h / 2);
        ctx.stroke();
      }
      break;
    }
    case 'bacon': {
      const steps = 18;
      const wave = (i: number) => Math.sin(i * 0.95 + seed) * 3;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x + (w * i) / steps;
        if (i === 0) ctx.moveTo(px, top + 1 + wave(i));
        else ctx.lineTo(px, top + 1 + wave(i));
      }
      for (let i = steps; i >= 0; i--) ctx.lineTo(x + (w * i) / steps, top + h + wave(i));
      ctx.closePath();
      fillStroke(ctx, '#C9503A');
      ctx.strokeStyle = '#F8C8B2';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const px = x + 4 + ((w - 8) * i) / steps;
        const py = top + h / 2 + 0.5 + wave(i);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      break;
    }
    case 'pickle': {
      const n = Math.max(3, Math.round(w / 36));
      const slot = w / n;
      for (let i = 0; i < n; i++) {
        const px = x + slot * (i + 0.5);
        ctx.beginPath();
        ctx.ellipse(px, top + h / 2, slot / 2 + 2, h / 2 + 0.5, 0, 0, Math.PI * 2);
        fillStroke(ctx, '#93C24A', 2);
        ctx.fillStyle = '#DDF0A8';
        ctx.beginPath();
        ctx.ellipse(px, top + h / 2, slot / 2 - 6, Math.max(1, h / 2 - 2.5), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'rotten': {
      // 냄새 나는 상한 생선
      const cy = top + h / 2;
      ctx.beginPath();
      ctx.moveTo(x + w - 6, cy - h / 2);
      ctx.lineTo(x + w - 30, cy);
      ctx.lineTo(x + w - 6, cy + h / 2);
      ctx.closePath();
      fillStroke(ctx, '#8BA06F');
      ctx.beginPath();
      ctx.ellipse(x + w * 0.42, cy, w * 0.4, h / 2, 0, 0, Math.PI * 2);
      fillStroke(ctx, '#A7B98C');
      ctx.strokeStyle = 'rgba(59,36,22,0.5)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const bx = x + w * (0.4 + i * 0.1);
        ctx.beginPath();
        ctx.moveTo(bx, cy - h * 0.3);
        ctx.quadraticCurveTo(bx + 5, cy, bx, cy + h * 0.3);
        ctx.stroke();
      }
      ctx.strokeStyle = OL;
      ctx.lineWidth = 2;
      const ex = x + w * 0.16;
      ctx.beginPath();
      ctx.moveTo(ex - 4, cy - 6);
      ctx.lineTo(ex + 4, cy + 2);
      ctx.moveTo(ex + 4, cy - 6);
      ctx.lineTo(ex - 4, cy + 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(110,150,60,0.8)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const sx = x + w * (0.3 + i * 0.18);
        const wob = Math.sin(time * 6 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(sx, top - 4);
        ctx.quadraticCurveTo(sx + 6 + wob, top - 11, sx, top - 18);
        ctx.quadraticCurveTo(sx - 6 - wob, top - 25, sx, top - 32);
        ctx.stroke();
      }
      break;
    }
  }
}

function drawFly(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, time: number) {
  const flap = 0.4 + Math.abs(Math.sin(time * 38)) * 0.6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = 'rgba(210,240,255,0.85)';
  ctx.strokeStyle = OL;
  ctx.lineWidth = 1.5;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(-2 + s * 5, -9, 6, 10 * flap, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 8, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#33302E', 2);
  ctx.fillStyle = '#FF5A4E';
  ctx.beginPath();
  ctx.arc(7, -3, 3.2, 0, Math.PI * 2);
  ctx.arc(7, 3, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, round: number, cam: number) {
  const theme = THEMES[(round - 1) % THEMES.length];
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.top);
  g.addColorStop(1, theme.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 물방울 무늬 (살짝 시차 스크롤)
  const sp = 48;
  const oy = (cam * 0.3) % sp;
  ctx.fillStyle = theme.dot;
  ctx.globalAlpha = 0.55;
  for (let row = -1; row < H / sp + 2; row++) {
    for (let col = 0; col < W / sp + 1; col++) {
      const px = col * sp + (row % 2 ? sp / 2 : 0);
      const py = row * sp + oy;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawCounter(ctx: CanvasRenderingContext2D, boardY: number, plateX: number, conveyor: boolean) {
  const counterY = boardY + 14;
  if (counterY > H + 20) return;
  // 앞판 (빨강/크림 스트라이프)
  for (let i = 0; i * 26 < W + 26; i++) {
    ctx.fillStyle = i % 2 ? '#FFF3E4' : '#E8553F';
    ctx.fillRect(i * 26, counterY + 18, 26, H - counterY);
  }
  ctx.strokeStyle = OL;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, counterY + 18);
  ctx.lineTo(W, counterY + 18);
  ctx.stroke();
  // 상판
  ctx.fillStyle = '#F6EBDD';
  ctx.fillRect(-4, counterY, W + 8, 18);
  ctx.strokeRect(-4, counterY, W + 8, 18);

  if (conveyor) {
    // 레일
    rr(ctx, 30, boardY + 6, W - 60, 10, 5);
    fillStroke(ctx, '#55546A', 2.5);
    ctx.strokeStyle = '#8E8DA6';
    ctx.lineWidth = 2;
    const off = (plateX * 1) % 18;
    for (let px = 38 + off; px < W - 38; px += 18) {
      ctx.beginPath();
      ctx.moveTo(px, boardY + 8);
      ctx.lineTo(px - 4, boardY + 14);
      ctx.stroke();
    }
  }

  // 도마
  rr(ctx, plateX - 138, boardY, 276, 14, 7);
  fillStroke(ctx, '#DCA36A');
  ctx.strokeStyle = '#B97E45';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plateX - 120, boardY + 5);
  ctx.lineTo(plateX + 60, boardY + 5);
  ctx.moveTo(plateX - 80, boardY + 9.5);
  ctx.lineTo(plateX + 100, boardY + 9.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(plateX + 122, boardY + 7, 3, 0, Math.PI * 2);
  fillStroke(ctx, '#B97E45', 1.5);
}

function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size / 5);
  ctx.strokeStyle = OL;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// 컴포넌트
// ---------------------------------------------------------------------------

const cardClass =
  'w-full rounded-[5cqw] border-[0.8cqw] border-[#3B2416] bg-[#FFF8EE] p-[5cqw] text-center text-[#3B2416] shadow-[0_1.4cqw_0_#3B2416]';
const bigButtonClass =
  'h-auto w-full rounded-[3cqw] border-[0.7cqw] border-[#3B2416] bg-[#FF6B3D] py-[2.4cqw] text-[4.6cqw] text-white shadow-[0_1cqw_0_#3B2416] hover:bg-[#FF7F55] active:translate-y-[1cqw] active:shadow-none';
const pillClass =
  'rounded-full border-[0.6cqw] border-[#3B2416] bg-white px-[2.6cqw] py-[0.8cqw] leading-none shadow-[0_0.6cqw_0_#3B2416]';

const HamburgerStack: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game>(createGame());
  const actionRef = useRef<() => void>(() => {});
  const startRef = useRef<() => void>(() => {});
  const nextRoundRef = useRef<() => void>(() => {});
  const bestRef = useRef<BestRecord>({ score: 0, round: 0 });

  const [ui, setUi] = useState<UiState>(() => {
    const best = loadBest();
    bestRef.current = best;
    return { phase: 'title', round: 1, hearts: MAX_HEARTS, score: 0, count: 0, target: roundConfig(1).target, best, isNewBest: false, clear: null };
  });

  // 귀여운 폰트 로드
  useEffect(() => {
    if (document.getElementById('font-jua')) return;
    const link = document.createElement('link');
    link.id = 'font-jua';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Jua&display=swap';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const g = gameRef.current;
    const sync = (patch: Partial<UiState>) => setUi((prev) => ({ ...prev, ...patch }));

    const plateX = () => W / 2 + g.cfg.conveyor * Math.sin(g.roundTime * 1.5);
    const worldTop = () => stackHeight(g.stack);
    const minX = (w: number) => w / 2 + EDGE_PADDING;
    const maxX = (w: number) => W - w / 2 - EDGE_PADDING;
    const toScreenY = (wy: number) => H - FLOOR - (wy - g.cam);

    const popup = (text: string, x: number, y: number, color: string, size = 26) => {
      g.popups.push({ text, x, y, t: 0, color, size });
    };

    const burst = (x: number, y: number, n: number, star: boolean) => {
      for (let i = 0; i < n; i++) {
        g.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * (star ? 260 : 520),
          vy: star ? 120 + Math.random() * 220 : 320 + Math.random() * 420,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          life: star ? 0.7 : 1.8,
          color: star ? '#FFD84A' : CONFETTI[i % CONFETTI.length],
          size: star ? 5 + Math.random() * 3 : 6 + Math.random() * 4,
          star,
        });
      }
    };

    const syncHud = () => sync({ score: g.score, hearts: g.hearts, count: g.count, target: g.cfg.target, round: g.round });

    const spawn = () => {
      let type: PieceType;
      if (g.count >= g.cfg.target) type = 'bunTop';
      else if (g.count > 0 && g.lastType !== 'rotten' && Math.random() < g.cfg.rottenChance) type = 'rotten';
      else type = pickIngredient(g.lastType);
      g.lastType = type;
      const spec = PIECES[type];
      const fromLeft = Math.random() < 0.5;
      g.current = {
        type,
        x: fromLeft ? minX(spec.w) : maxX(spec.w),
        y: worldTop() + SPAWN_GAP,
        w: spec.w,
        h: spec.h,
        seed: Math.random() * 10,
        landedAt: 0,
        dir: fromLeft ? 1 : -1,
        speed: (g.cfg.speed + g.count * 6) * (type === 'rotten' ? 1.25 : 1),
        bounces: 0,
      };
      g.wind = g.cfg.wind ? (Math.random() < 0.5 ? -1 : 1) * g.cfg.wind * (0.5 + Math.random() * 0.5) : 0;
      g.phase = 'moving';
    };

    const setupRound = (round: number) => {
      g.round = round;
      g.cfg = roundConfig(round);
      g.stack = [makeBun()];
      g.count = 0;
      g.combo = 0;
      g.roundMisses = 0;
      g.roundTime = 0;
      g.current = null;
      g.lastType = null;
      g.collapse = null;
      g.flies = Array.from({ length: g.cfg.flies }, (_, i) => ({
        x: 60 + Math.random() * (W - 120),
        dir: (i % 2 ? -1 : 1) as 1 | -1,
        yOff: 80 + i * 55 + Math.random() * 20,
        phase: Math.random() * 6,
      }));
      const fresh = OBSTACLES.find((o) => o.from === round);
      g.banner = { text: `ROUND ${round}`, sub: fresh ? `${fresh.emoji} ${fresh.name} 등장!` : `재료 ${g.cfg.target}개 + 윗빵`, t: 0 };
      g.phase = 'settling';
      g.timer = 1.1;
      syncHud();
    };

    const start = () => {
      g.hearts = MAX_HEARTS;
      g.score = 0;
      g.falling = [];
      g.particles = [];
      g.popups = [];
      g.exiting = null;
      setupRound(1);
      sync({ phase: 'playing', isNewBest: false, clear: null });
    };

    const nextRound = () => {
      const px = plateX();
      g.exiting = { pieces: g.stack.map((p) => ({ ...p, x: p.x + px })), dx: 0, vx: 200 };
      setupRound(g.round + 1);
      sync({ phase: 'playing', clear: null });
    };

    const gameOver = () => {
      g.phase = 'over';
      g.current = null;
      g.inputLockUntil = g.time + 0.7;
      const isNewBest = g.score > bestRef.current.score;
      if (isNewBest) {
        bestRef.current = { score: g.score, round: g.round };
        saveBest(bestRef.current);
      }
      sync({ phase: 'over', score: g.score, best: bestRef.current, isNewBest, hearts: g.hearts });
    };

    const loseHeart = (msg: string, y: number) => {
      g.hearts -= 1;
      g.roundMisses += 1;
      g.combo = 0;
      g.shake = 8;
      g.current = null;
      popup(msg, W / 2, y, '#FF5A4E', 30);
      g.phase = 'missing';
      g.timer = 1.0;
      syncHud();
    };

    const fallAway = (c: Moving, dir: number, touching: boolean) => {
      g.falling.push({
        ...c,
        vx: dir * (touching ? 120 : 40),
        vy: touching ? 80 : -g.vy * 0.6,
        angle: 0,
        va: dir * (touching ? 5 : 1.5),
        alpha: 1,
      });
    };

    const land = () => {
      const c = g.current;
      if (!c) return;
      const px = plateX();
      const below = g.stack[g.stack.length - 1];
      const belowX = px + below.x;
      c.y = worldTop();
      const perfect = c.type !== 'rotten' && Math.abs(c.x - belowX) <= PERFECT_TOLERANCE;
      if (perfect) c.x = belowX;
      const offset = c.x - belowX;
      const dir = offset >= 0 ? 1 : -1;
      const overlap = Math.min(c.x + c.w / 2, belowX + below.w / 2) - Math.max(c.x - c.w / 2, belowX - below.w / 2);

      if (c.type === 'rotten') {
        if (overlap > 0) {
          g.falling.push({ ...c, vx: dir * 160, vy: 380, angle: 0, va: dir * 7, alpha: 1 });
          loseHeart('으악! 상한 생선!', c.y + 90);
        } else {
          fallAway(c, dir, false);
          g.current = null;
          popup('휴~ 아슬아슬', W / 2, c.y + 90, '#2E9E5B', 24);
          g.phase = 'settling';
          g.timer = 0.4;
        }
        return;
      }

      // 절반 미만으로 걸치면 미끄러져 떨어짐
      if (overlap < c.w / 2) {
        fallAway(c, dir, overlap > 0);
        loseHeart('앗! 떨어졌다', c.y + 90);
        return;
      }

      g.stack.push({ type: c.type, x: c.x - px, y: c.y, w: c.w, h: c.h, seed: c.seed, landedAt: g.time });
      g.current = null;
      if (c.type !== 'bunTop') g.count += 1;
      g.combo = perfect ? g.combo + 1 : 0;
      const gained = 10 + (perfect ? 10 * Math.min(g.combo, 5) : 0);
      g.score += gained;
      if (perfect) {
        popup(g.combo > 1 ? `Perfect x${g.combo}! +${gained}` : `Perfect! +${gained}`, c.x, c.y + c.h + 28, '#FFC933', 28);
        burst(c.x, c.y + c.h, 10, true);
      } else {
        popup(`+${gained}`, c.x, c.y + c.h + 24, '#7BD35A', 24);
      }

      const col = findCollapse(g.stack);
      if (col) {
        const base = g.stack[col.level];
        const pieces = g.stack.splice(col.level + 1).map((p) => ({ ...p, x: p.x + px }));
        g.count = Math.max(0, g.stack.length - 1);
        g.collapse = {
          pieces,
          pivotX: px + base.x + (col.dir * base.w) / 2,
          pivotY: base.y + base.h,
          dir: col.dir,
          angle: 0,
          omega: 0.3,
          drop: 0,
          vy: 0,
          alpha: 1,
        };
        g.hearts -= 1;
        g.roundMisses += 1;
        g.combo = 0;
        g.phase = 'collapsing';
        g.timer = 1.7;
        g.shake = 12;
        popup('와르르!', W / 2, base.y + 150, '#FF5A4E', 40);
        syncHud();
        return;
      }

      if (c.type === 'bunTop') {
        const bonus = 50 * g.round;
        const noMiss = g.roundMisses === 0;
        const noMissBonus = noMiss ? 50 * g.round : 0;
        const heartGained = noMiss && g.hearts < MAX_HEARTS;
        if (heartGained) g.hearts += 1;
        g.score += bonus + noMissBonus;
        g.phase = 'clear';
        g.timer = 1.4;
        burst(px, worldTop() + 40, 70, false);
        popup('버거 완성!', W / 2, worldTop() + 110, '#FFC933', 44);
        sync({
          clear: { round: g.round, bonus, noMissBonus, heartGained, newObstacles: OBSTACLES.filter((o) => o.from === g.round + 1) },
        });
      } else {
        g.phase = 'settling';
        g.timer = 0.15;
      }
      syncHud();
    };

    const knockByFly = (c: Moving, fx: number) => {
      const dir = c.x >= fx ? 1 : -1;
      g.falling.push({ ...c, vx: dir * 220, vy: 260, angle: 0, va: dir * 9, alpha: 1 });
      burst(fx, c.y, 6, true);
      if (c.type === 'rotten') {
        g.current = null;
        popup('파리가 생선을 치웠어요!', W / 2, c.y + 40, '#2E9E5B', 22);
        g.phase = 'settling';
        g.timer = 0.4;
      } else {
        loseHeart('파리에 부딪혔어요!', c.y + 40);
      }
    };

    actionRef.current = () => {
      if (g.time < g.inputLockUntil) return;
      if (g.phase === 'title' || g.phase === 'over') start();
      else if (g.phase === 'clearWait') nextRound();
      else if (g.phase === 'moving' && g.current && !(g.current.type === 'rotten' && g.current.bounces >= 2)) {
        g.phase = 'dropping';
        g.vy = 0;
      }
    };
    startRef.current = start;
    nextRoundRef.current = nextRound;

    const flyPos = (f: Fly) => ({ x: f.x, y: worldTop() + f.yOff + Math.sin(g.time * 3 + f.phase) * 10 });

    const update = (dt: number) => {
      g.time += dt;
      g.roundTime += dt;
      const c = g.current;

      if (g.phase === 'moving' && c) {
        c.x += c.dir * c.speed * dt;
        if (c.type === 'rotten' && c.bounces >= 2) {
          if (c.x < -c.w || c.x > W + c.w) {
            g.current = null;
            g.score += 20;
            popup('잘 보냈어요! +20', W / 2, worldTop() + 120, '#2E9E5B', 24);
            syncHud();
            g.phase = 'settling';
            g.timer = 0.2;
          }
        } else if (c.x > maxX(c.w)) {
          c.x = maxX(c.w);
          c.dir = -1;
          c.bounces += 1;
        } else if (c.x < minX(c.w)) {
          c.x = minX(c.w);
          c.dir = 1;
          c.bounces += 1;
        }
      } else if (g.phase === 'dropping' && c) {
        g.vy += GRAVITY * dt;
        c.y -= g.vy * dt;
        c.x += g.wind * dt;
        for (const f of g.flies) {
          const p = flyPos(f);
          const nx = clamp(p.x, c.x - c.w / 2, c.x + c.w / 2);
          const ny = clamp(p.y, c.y, c.y + c.h);
          if ((nx - p.x) ** 2 + (ny - p.y) ** 2 < 11 * 11) {
            knockByFly(c, p.x);
            break;
          }
        }
        if (g.phase === 'dropping' && c.y <= worldTop()) land();
      } else if (g.phase === 'settling') {
        g.timer -= dt;
        if (g.timer <= 0) spawn();
      } else if (g.phase === 'missing') {
        g.timer -= dt;
        if (g.timer <= 0) {
          if (g.hearts <= 0) gameOver();
          else spawn();
        }
      } else if (g.phase === 'collapsing') {
        g.timer -= dt;
        if (g.timer <= 0) {
          if (g.hearts <= 0) gameOver();
          else {
            g.collapse = null;
            g.stack = [makeBun()];
            g.count = 0;
            g.banner = { text: '다시 도전!', sub: `ROUND ${g.round}`, t: 0 };
            g.phase = 'settling';
            g.timer = 1.0;
            syncHud();
          }
        }
      } else if (g.phase === 'clear') {
        g.timer -= dt;
        if (g.timer <= 0) {
          g.phase = 'clearWait';
          g.inputLockUntil = g.time + 0.4;
          sync({ phase: 'clear' });
        }
      }

      if (g.phase !== 'title' && g.phase !== 'over') {
        for (const f of g.flies) {
          f.x += f.dir * g.cfg.flySpeed * dt;
          if (f.x > W - 24) f.dir = -1;
          else if (f.x < 24) f.dir = 1;
        }
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

      if (g.exiting) {
        g.exiting.vx += 1600 * dt;
        g.exiting.dx += g.exiting.vx * dt;
        if (g.exiting.dx > W + 300) g.exiting = null;
      }

      for (const p of g.particles) {
        p.vy -= 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
      }
      g.particles = g.particles.filter((p) => p.life > 0);

      for (const p of g.popups) p.t += dt;
      g.popups = g.popups.filter((p) => p.t < 1.1);
      if (g.banner) {
        g.banner.t += dt;
        if (g.banner.t > 1.8) g.banner = null;
      }

      g.shake *= Math.exp(-dt * 8);
      const target = Math.max(0, worldTop() - CAM_LEAD);
      g.cam += (target - g.cam) * Math.min(1, dt * 5);
    };

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const scale = Math.max(dpr, (rect.width * dpr) / W);
      if (canvas.width !== Math.round(W * scale)) {
        canvas.width = Math.round(W * scale);
        canvas.height = Math.round(H * scale);
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawBackground(ctx, g.round, g.cam);

      ctx.save();
      if (g.shake > 0.3) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);

      const px = plateX();
      drawCounter(ctx, toScreenY(0), px, g.cfg.conveyor > 0 && g.phase !== 'title');

      // 완성되어 퇴장하는 버거
      if (g.exiting) {
        for (const p of g.exiting.pieces) {
          drawPiece(ctx, p.type, p.x + g.exiting.dx, toScreenY(p.y + p.h), p.w, p.h, p.seed);
        }
      }

      // 쌓인 재료
      for (const p of g.stack) {
        const bottom = toScreenY(p.y);
        const cx = px + p.x;
        const age = g.time - p.landedAt;
        const k = age < 0.6 ? Math.exp(-age * 12) * 0.28 : 0;
        ctx.save();
        ctx.translate(cx, bottom);
        ctx.scale(1 + k * 0.4, 1 - k);
        ctx.translate(-cx, -bottom);
        drawPiece(ctx, p.type, cx, bottom - p.h, p.w, p.h, p.seed);
        ctx.restore();
      }

      // 무너지는 탑
      const col = g.collapse;
      if (col && col.alpha > 0) {
        const ppx = col.pivotX;
        const ppy = toScreenY(col.pivotY);
        ctx.save();
        ctx.globalAlpha = col.alpha;
        ctx.translate(0, col.drop);
        ctx.translate(ppx, ppy);
        ctx.rotate(col.dir * col.angle);
        ctx.translate(-ppx, -ppy);
        for (const p of col.pieces) drawPiece(ctx, p.type, p.x, toScreenY(p.y + p.h), p.w, p.h, p.seed);
        ctx.restore();
      }

      // 조준 그림자
      const c = g.current;
      const topY = toScreenY(worldTop());
      if (c && g.phase === 'moving' && c.type !== 'rotten') {
        ctx.fillStyle = 'rgba(59,36,22,0.18)';
        ctx.beginPath();
        ctx.ellipse(c.x, topY - 2, c.w / 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 파리
      for (const f of g.flies) {
        const p = flyPos(f);
        drawFly(ctx, p.x, toScreenY(p.y), f.dir, g.time);
      }

      // 움직이는 재료
      if (c) {
        ctx.save();
        ctx.shadowColor = 'rgba(59,36,22,0.25)';
        ctx.shadowOffsetY = 6;
        ctx.shadowBlur = 6;
        drawPiece(ctx, c.type, c.x, toScreenY(c.y) - c.h, c.w, c.h, c.seed, g.time);
        ctx.restore();
        if (c.type === 'rotten') outlinedText(ctx, '떨어뜨리지 마세요!', c.x, toScreenY(c.y) + 22, 18, '#FFFFFF');
      }

      // 떨어지는 재료
      for (const f of g.falling) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, f.alpha);
        ctx.translate(f.x, toScreenY(f.y + f.h / 2));
        ctx.rotate(f.angle);
        drawPiece(ctx, f.type, 0, -f.h / 2, f.w, f.h, f.seed, g.time);
        ctx.restore();
      }

      // 파티클
      for (const p of g.particles) {
        ctx.save();
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        ctx.translate(p.x, toScreenY(p.y));
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.star) {
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const r = i % 2 ? p.size * 0.4 : p.size;
            const a = (i * Math.PI) / 4;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
        }
        ctx.restore();
      }

      // 바람 표시
      if (g.wind !== 0 && (g.phase === 'moving' || g.phase === 'dropping')) {
        const dir = Math.sign(g.wind);
        const strength = Math.ceil(Math.abs(g.wind) / 50);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 7; i++) {
          const sy = 170 + ((i * 53) % 260);
          const len = 30 + (i % 3) * 14;
          const sx = ((((g.time * Math.abs(g.wind) * 2.2 + i * 97) % (W + 120)) + W + 120) % (W + 120)) - 60;
          const x0 = dir > 0 ? sx : W - sx;
          ctx.beginPath();
          ctx.moveTo(x0, sy);
          ctx.lineTo(x0 - dir * len, sy);
          ctx.stroke();
        }
        const label = `바람 ${(dir > 0 ? '▶' : '◀').repeat(strength)}`;
        ctx.font = `20px ${FONT}`;
        const tw = ctx.measureText(label).width + 28;
        rr(ctx, W / 2 - tw / 2, 108, tw, 32, 16);
        fillStroke(ctx, 'rgba(255,255,255,0.92)', 2.5);
        ctx.fillStyle = '#2F7FD6';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, W / 2, 125);
      }

      // 팝업 텍스트
      for (const p of g.popups) {
        ctx.globalAlpha = 1 - p.t / 1.1;
        const pop = p.t < 0.12 ? 0.6 + (p.t / 0.12) * 0.4 : 1;
        outlinedText(ctx, p.text, clamp(p.x, 120, W - 120), toScreenY(p.y) - p.t * 50, p.size * pop, p.color);
      }
      ctx.globalAlpha = 1;

      // 라운드 배너
      if (g.banner) {
        const t = g.banner.t;
        ctx.globalAlpha = t > 1.4 ? Math.max(0, 1 - (t - 1.4) / 0.4) : 1;
        const s = t < 0.25 ? 0.5 + (t / 0.25) * 0.5 : 1;
        outlinedText(ctx, g.banner.text, W / 2, H * 0.33, 60 * s, '#FFFFFF');
        if (g.banner.sub) outlinedText(ctx, g.banner.sub, W / 2, H * 0.33 + 52, 26 * s, '#FFC933');
        ctx.globalAlpha = 1;
      }

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

  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();
  const boardWidth = 'min(100%, 720px, max(320px, calc((100vh - 130px) * 0.75)))';
  const activeObstacles = obstaclesFor(ui.round);

  return (
    <div className="min-h-full w-full flex flex-col items-center gap-3 bg-[#FFF4E4] p-2 sm:p-4" style={{ fontFamily: FONT }}>
      <div
        className="relative aspect-[3/4] select-none touch-none overflow-hidden rounded-[28px] border-4 border-[#3B2416] shadow-[0_8px_0_#3B2416] cursor-pointer"
        style={{ width: boardWidth, containerType: 'inline-size' }}
        onPointerDown={(e) => {
          e.preventDefault();
          actionRef.current();
        }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" aria-label="햄버거 쌓기 게임 화면" />

        {/* HUD */}
        {ui.phase !== 'title' && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-[3cqw] text-[#3B2416]">
            <div className="flex flex-col items-start gap-[1.6cqw]">
              <div className={`${pillClass} text-[3.6cqw]`}>ROUND {ui.round}</div>
              <div className="text-[5.4cqw] leading-none text-white [-webkit-text-stroke:0.5cqw_#3B2416] [paint-order:stroke_fill]">
                {ui.score.toLocaleString()}
              </div>
            </div>
            <div className="flex flex-col items-center gap-[1cqw] pt-[0.6cqw]">
              <div className="flex items-center gap-[0.7cqw]">
                {Array.from({ length: ui.target }, (_, i) => (
                  <div
                    key={i}
                    className={`h-[2.6cqw] w-[2.6cqw] rounded-full border-[0.5cqw] border-[#3B2416] ${i < ui.count ? 'bg-[#FFC933]' : 'bg-white/70'}`}
                  />
                ))}
                <span className="text-[4cqw] leading-none">🍔</span>
              </div>
              <div className="text-[3cqw] leading-none">
                {ui.count} / {ui.target}
              </div>
            </div>
            <div className="flex gap-[0.6cqw] pt-[0.4cqw]">
              {Array.from({ length: MAX_HEARTS }, (_, i) => (
                <Heart
                  key={i}
                  className={`h-[6cqw] w-[6cqw] text-[#3B2416] ${i < ui.hearts ? 'fill-[#FF5A6E]' : 'fill-white/60'}`}
                  strokeWidth={2.5}
                />
              ))}
            </div>
          </div>
        )}

        {ui.phase === 'playing' && activeObstacles.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[3cqw] flex flex-wrap justify-center gap-[1.4cqw] px-[3cqw]">
            {activeObstacles.map((o) => (
              <span key={o.key} className={`${pillClass} text-[2.9cqw]`}>
                {o.emoji} {o.name}
              </span>
            ))}
          </div>
        )}

        {ui.phase === 'title' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#3B2416]/20 p-[6cqw]">
            <div className={`${cardClass} space-y-[3cqw]`}>
              <div className="text-[13cqw] leading-none">🍔</div>
              <h2 className="text-[8cqw] leading-none">햄버거 쌓기</h2>
              <p className="text-[3.4cqw] leading-snug text-[#7A5A44]">
                <b className="text-[#FF6B3D]">스페이스바</b>나 <b className="text-[#FF6B3D]">탭</b>으로 재료를 떨어뜨려
                <br />
                목표 개수를 쌓고 윗빵을 덮으면 라운드 클리어!
              </p>
              <div className="grid grid-cols-2 gap-[1.6cqw] text-left text-[2.9cqw]">
                {OBSTACLES.map((o) => (
                  <div key={o.key} className="rounded-[2.4cqw] border-[0.5cqw] border-[#3B2416]/20 bg-white px-[2cqw] py-[1.4cqw]">
                    <div className="text-[3.2cqw]">
                      {o.emoji} {o.name} <span className="text-[#B08A70]">R{o.from}~</span>
                    </div>
                    <div className="text-[#7A5A44]">{o.desc}</div>
                  </div>
                ))}
              </div>
              {ui.best.score > 0 && (
                <div className="flex items-center justify-center gap-[1cqw] text-[3.4cqw]">
                  <Trophy className="h-[4cqw] w-[4cqw] text-[#FFB020]" /> 최고 {ui.best.score.toLocaleString()}점 · ROUND {ui.best.round}
                </div>
              )}
              <Button className={bigButtonClass} onPointerDown={stopPointer} onClick={() => startRef.current()}>
                <Play className="mr-[1.6cqw] h-[4.6cqw] w-[4.6cqw] fill-white" /> 시작하기
              </Button>
            </div>
          </div>
        )}

        {ui.phase === 'clear' && ui.clear && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#3B2416]/20 p-[7cqw] animate-in fade-in zoom-in-95 duration-300">
            <div className={`${cardClass} space-y-[2.6cqw]`}>
              <div className="text-[4cqw] text-[#B08A70]">ROUND {ui.clear.round}</div>
              <h2 className="text-[8cqw] leading-none">버거 완성! 🍔</h2>
              <div className="space-y-[1cqw] text-[3.8cqw]">
                <div className="flex justify-between">
                  <span>라운드 보너스</span>
                  <span className="text-[#FF6B3D]">+{ui.clear.bonus}</span>
                </div>
                {ui.clear.noMissBonus > 0 && (
                  <div className="flex justify-between">
                    <span>노미스 보너스 ✨</span>
                    <span className="text-[#FF6B3D]">+{ui.clear.noMissBonus}</span>
                  </div>
                )}
                {ui.clear.heartGained && <div className="text-[#FF5A6E]">노미스 클리어로 하트 1개 회복! ❤️</div>}
              </div>
              {ui.clear.newObstacles.length > 0 && (
                <div className="rounded-[3cqw] border-[0.5cqw] border-dashed border-[#FF6B3D] bg-[#FFF0E6] p-[2.6cqw] text-[3.4cqw]">
                  다음 라운드 새 장애물
                  {ui.clear.newObstacles.map((o) => (
                    <div key={o.key} className="text-[4.2cqw]">
                      {o.emoji} {o.name}
                      <div className="text-[3cqw] text-[#7A5A44]">{o.desc}</div>
                    </div>
                  ))}
                </div>
              )}
              <Button className={bigButtonClass} onPointerDown={stopPointer} onClick={() => nextRoundRef.current()}>
                다음 라운드 <ArrowRight className="ml-[1.6cqw] h-[4.6cqw] w-[4.6cqw]" />
              </Button>
            </div>
          </div>
        )}

        {ui.phase === 'over' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#3B2416]/35 p-[7cqw] animate-in fade-in duration-300">
            <div className={`${cardClass} space-y-[2.6cqw]`}>
              <h2 className="text-[8cqw] leading-none">게임 오버</h2>
              {ui.isNewBest && (
                <div className="inline-block rounded-full border-[0.5cqw] border-[#3B2416] bg-[#FFC933] px-[3cqw] py-[0.8cqw] text-[3.6cqw]">
                  🎉 신기록!
                </div>
              )}
              <div className="text-[14cqw] leading-none text-[#FF6B3D]">{ui.score.toLocaleString()}</div>
              <div className="text-[3.6cqw] text-[#7A5A44]">
                ROUND {ui.round}까지 도달 · 최고 {ui.best.score.toLocaleString()}점
              </div>
              <Button className={bigButtonClass} onPointerDown={stopPointer} onClick={() => startRef.current()}>
                <RotateCcw className="mr-[1.6cqw] h-[4.6cqw] w-[4.6cqw]" /> 다시 하기
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="text-[13px] text-[#9A7A62]">스페이스바 또는 화면 탭으로 떨어뜨리기</p>
    </div>
  );
};

export default HamburgerStack;
