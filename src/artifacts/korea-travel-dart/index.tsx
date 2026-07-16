import React, { useEffect, useRef, useState } from 'react';
import { Filter, Share2 } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import regionsJson from './regions.data.json';
import { regionDescriptions, genericTemplates } from './descriptions';

type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];

interface RawRegion {
  code: string;
  name: string;
  nameEng: string;
  sidoCode: string;
  sido: string;
  polygons: Polygon[];
  centroid: Point;
  bbox: [number, number, number, number];
  area: number;
}

interface RegionsFile {
  viewBox: [number, number, number, number];
  regions: RawRegion[];
}

interface Region extends RawRegion {
  path: string;
}

const DATA = regionsJson as unknown as RegionsFile;
const [VB_X, VB_Y, VB_W, VB_H] = DATA.viewBox;

function buildPath(polygons: Polygon[]): string {
  let d = '';
  for (const poly of polygons) {
    for (const ring of poly) {
      d += 'M' + ring.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
    }
  }
  return d;
}

const REGIONS: Region[] = DATA.regions.map((r) => ({ ...r, path: buildPath(r.polygons) }));
const TOTAL_AREA = REGIONS.reduce((s, r) => s + r.area, 0);

const SIDO_ORDER = Array.from(new Set(REGIONS.map((r) => r.sidoCode)));
const SIDO_COLORS: Record<string, string> = {};
SIDO_ORDER.forEach((code, i) => {
  const hue = Math.round((i * 360) / SIDO_ORDER.length);
  SIDO_COLORS[code] = `hsl(${hue}, 58%, 76%)`;
});

const SIDO_SHORT: Record<string, string> = {
  '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주',
  '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원',
  '33': '충북', '34': '충남', '35': '전북', '36': '전남', '37': '경북',
  '38': '경남', '39': '제주',
};

const SIDO_FULL: Record<string, string> = {};
REGIONS.forEach((r) => {
  SIDO_FULL[r.sidoCode] = r.sido;
});

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon) {
    if (pointInRing(x, y, ring)) inside = !inside;
  }
  return inside;
}

function pointInRegion(x: number, y: number, region: Region): boolean {
  return region.polygons.some((poly) => pointInPolygon(x, y, poly));
}

function pickWeightedRegion(pool: Region[], totalArea: number, excludeCode?: string): Region {
  let region = pool[pool.length - 1];
  for (let attempt = 0; attempt < 6; attempt++) {
    let t = Math.random() * totalArea;
    for (const r of pool) {
      if (t < r.area) {
        region = r;
        break;
      }
      t -= r.area;
    }
    if (region.code !== excludeCode || pool.length === 1) break;
  }
  return region;
}

function samplePointInRegion(region: Region): Point {
  const [x0, y0, x1, y1] = region.bbox;
  for (let i = 0; i < 80; i++) {
    const x = x0 + Math.random() * (x1 - x0);
    const y = y0 + Math.random() * (y1 - y0);
    if (pointInRegion(x, y, region)) return [x, y];
  }
  return region.centroid;
}

function describeRegion(region: Region): string {
  const specific = regionDescriptions[region.code];
  if (specific) return specific;
  const template = genericTemplates[region.code.charCodeAt(0) % genericTemplates.length];
  return template(region.name, region.sido);
}

interface HistoryEntry {
  code: string;
  name: string;
  sido: string;
  sidoCode: string;
}

type Status = 'idle' | 'throwing' | 'result';

const THROW_DURATION_MS = 900;

const SUSPENSE_PHRASES = [
  '두근두근...',
  '어디로 떨어질까...?',
  '운명의 한 곳...',
  '조준 중...',
  '눈을 감고...',
];

const KoreaTravelDart: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [target, setTarget] = useState<Point>([VB_W / 2, VB_H * 0.08]);
  const [selected, setSelected] = useState<Region | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hitKey, setHitKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSido, setSelectedSido] = useState<Set<string>>(() => new Set(SIDO_ORDER));
  const [caption, setCaption] = useState('');
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('region');
    if (!code) return;
    const region = REGIONS.find((r) => r.code === code);
    if (!region) return;
    setTarget(region.centroid);
    setSelected(region);
    setStatus('result');
    setDialogOpen(true);
    setHistory((h) => [
      { code: region.code, name: region.name, sido: region.sido, sidoCode: region.sidoCode },
      ...h.filter((e) => e.code !== region.code),
    ].slice(0, 6));
  }, []);

  const pool = selectedSido.size === SIDO_ORDER.length
    ? REGIONS
    : REGIONS.filter((r) => selectedSido.has(r.sidoCode));
  const poolArea = selectedSido.size === SIDO_ORDER.length
    ? TOTAL_AREA
    : pool.reduce((s, r) => s + r.area, 0);
  const isAllSidoSelected = selectedSido.size === SIDO_ORDER.length;
  const filterLabel = isAllSidoSelected
    ? '전체 지역'
    : selectedSido.size === 0
      ? '선택된 지역 없음'
      : `${selectedSido.size}개 지역`;

  const toggleSido = (code: string) => {
    setSelectedSido((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const throwDart = () => {
    if (status === 'throwing' || pool.length === 0) return;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    const region = pickWeightedRegion(pool, poolArea, selected?.code);
    const point = samplePointInRegion(region);

    setDialogOpen(false);
    setStatus('throwing');
    setTarget(point);
    setCaption(SUSPENSE_PHRASES[Math.floor(Math.random() * SUSPENSE_PHRASES.length)]);

    timeoutRef.current = window.setTimeout(() => {
      setSelected(region);
      setStatus('result');
      setHitKey((k) => k + 1);
      setDialogOpen(true);
      setHistory((h) => [
        { code: region.code, name: region.name, sido: region.sido, sidoCode: region.sidoCode },
        ...h.filter((e) => e.code !== region.code),
      ].slice(0, 6));
    }, THROW_DURATION_MS);
  };

  const shareResult = async () => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set('region', selected.code);
    const shareText = `🎯 다트로 뽑힌 다음 여행지는... ${selected.sido} ${selected.name}!\n${describeRegion(selected)}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: '대한민국 여행지 다트', text: shareText, url: url.toString() });
      } catch {
        // user cancelled the native share sheet
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${shareText}\n${url.toString()}`);
      toast.success('결과 링크가 클립보드에 복사됐어요!');
    } catch {
      toast.error('복사에 실패했어요.');
    }
  };

  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (hitKey === 0) return;
    setShaking(true);
    const t = window.setTimeout(() => setShaking(false), 400);
    return () => window.clearTimeout(t);
  }, [hitKey]);

  const dartLeftPct = ((target[0] - VB_X) / VB_W) * 100;
  const dartTopPct = ((target[1] - VB_Y) / VB_H) * 100;

  return (
    <div className="h-full min-h-0 flex flex-col items-center p-3 sm:p-5 gap-3 bg-gradient-to-b from-sky-50 to-white dark:from-slate-950 dark:to-slate-900">
      <style>{`
        @keyframes dart-spin-fly {
          0% { transform: translate(-50%, -95%) rotate(0deg) scale(1); }
          70% { transform: translate(-50%, -95%) rotate(540deg) scale(1.15); }
          100% { transform: translate(-50%, -95%) rotate(630deg) scale(1); }
        }
        @keyframes dart-land-bounce {
          0% { transform: translate(-50%, -95%) scale(1.3); }
          50% { transform: translate(-50%, -95%) scale(0.9); }
          100% { transform: translate(-50%, -95%) scale(1); }
        }
        @keyframes ripple-ring {
          0% { r: 2; opacity: 0.9; }
          100% { r: 26; opacity: 0; }
        }
        @keyframes pop-in {
          0% { transform: scale(0.4) rotate(-6deg); opacity: 0; }
          65% { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes impact-flash {
          0% { opacity: 0.65; }
          100% { opacity: 0; }
        }
        @keyframes impact-shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-5px, 3px); }
          40% { transform: translate(5px, -3px); }
          60% { transform: translate(-4px, -2px); }
          80% { transform: translate(4px, 2px); }
        }
        @keyframes caption-pulse {
          0%, 100% { opacity: 0.55; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.08); }
        }
        .dart-marker--throwing { animation: dart-spin-fly ${THROW_DURATION_MS}ms cubic-bezier(.25,.6,.3,1) forwards; }
        .dart-marker--landed { animation: dart-land-bounce 0.35s ease-out forwards; }
        .ripple-circle { animation: ripple-ring 0.9s ease-out forwards; }
        .pop-in { animation: pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .impact-flash { animation: impact-flash 0.4s ease-out forwards; }
        .impact-shake { animation: impact-shake 0.4s ease-in-out; }
        .caption-pulse { animation: caption-pulse 0.7s ease-in-out infinite; }
      `}</style>

      <div className="text-center flex-shrink-0 space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">대한민국 여행지 다트 🎯</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          지역 면적에 비례한 확률로 다음 여행지를 무작위로 골라드려요
        </p>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Filter className="h-3.5 w-3.5" />
              {filterLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="center">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">던질 지역 선택</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setSelectedSido(new Set(SIDO_ORDER))}
                >
                  전체 선택
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setSelectedSido(new Set())}
                >
                  전체 해제
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 max-h-64 overflow-y-auto">
              {SIDO_ORDER.map((code) => (
                <label
                  key={code}
                  className="flex items-center gap-1.5 text-sm cursor-pointer select-none"
                >
                  <Checkbox
                    checked={selectedSido.has(code)}
                    onCheckedChange={() => toggleSido(code)}
                  />
                  {SIDO_SHORT[code] ?? SIDO_FULL[code]}
                </label>
              ))}
            </div>
            {selectedSido.size === 0 && (
              <p className="text-xs text-destructive mt-2">최소 한 지역은 선택해야 다트를 던질 수 있어요</p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative flex-1 min-h-0 w-full max-w-2xl flex items-center justify-center">
        <div
          className={'relative max-h-full max-w-full rounded-3xl border bg-white/70 dark:bg-slate-900/60 shadow-lg p-3 sm:p-4 ' + (shaking ? 'impact-shake' : '')}
          style={{ aspectRatio: `${VB_W + 30} / ${VB_H + 30}` }}
        >
          {status === 'throwing' && (
            <div className="absolute top-1 left-1/2 z-10 px-3 py-1 rounded-full bg-black/70 text-white text-sm font-medium whitespace-nowrap caption-pulse pointer-events-none">
              {caption}
            </div>
          )}

          <div
            className="relative h-full w-full overflow-hidden rounded-2xl"
            style={{
              transform: status === 'throwing' ? 'scale(1.07)' : 'scale(1)',
              transformOrigin: `${dartLeftPct}% ${dartTopPct}%`,
              transition: `transform ${THROW_DURATION_MS}ms ease-in-out`,
            }}
          >
            <svg
              viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
              className="block h-full w-full bg-slate-50 dark:bg-slate-950"
            >
              {REGIONS.map((r) => {
                const isSelected = selected?.code === r.code && status === 'result';
                const isEligible = selectedSido.has(r.sidoCode);
                const fill = isSelected
                  ? '#ef4444'
                  : isEligible
                    ? SIDO_COLORS[r.sidoCode]
                    : '#e2e8f0';
                return (
                  <path
                    key={r.code}
                    d={r.path}
                    fill={fill}
                    stroke={isSelected ? '#7f1d1d' : '#ffffff'}
                    strokeWidth={isSelected ? 1.5 : 0.6}
                    opacity={!isSelected && !isEligible ? 0.6 : 1}
                    style={{ transition: 'fill 0.3s ease, stroke 0.3s ease, opacity 0.3s ease' }}
                  />
                );
              })}
              {status === 'result' && (
                <circle
                  key={hitKey}
                  className="ripple-circle"
                  cx={target[0]}
                  cy={target[1]}
                  r={2}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={2}
                />
              )}
            </svg>

            <div
              className="absolute inset-0 pointer-events-none transition-opacity"
              style={{
                background: `radial-gradient(circle at ${dartLeftPct}% ${dartTopPct}%, transparent 20%, rgba(0,0,0,0.5) 80%)`,
                opacity: status === 'throwing' ? 1 : 0,
                transitionDuration: `${THROW_DURATION_MS}ms`,
              }}
            />

            {status === 'result' && (
              <div key={hitKey} className="absolute inset-0 bg-white impact-flash pointer-events-none" />
            )}

            <div
              className={
                'absolute text-3xl pointer-events-none drop-shadow-md ' +
                (status === 'throwing'
                  ? 'dart-marker--throwing'
                  : status === 'result'
                    ? 'dart-marker--landed'
                    : '')
              }
              style={{
                left: `${dartLeftPct}%`,
                top: `${dartTopPct}%`,
                opacity: status === 'idle' ? 0 : 1,
                transform: 'translate(-50%, -95%)',
                transition: `left ${THROW_DURATION_MS}ms cubic-bezier(.25,.6,.3,1), top ${THROW_DURATION_MS}ms cubic-bezier(.25,.6,.3,1)`,
              }}
            >
              📍
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 flex-shrink-0 w-full">
        <Button
          size="lg"
          className="px-10 shadow-md"
          onClick={throwDart}
          disabled={status === 'throwing' || pool.length === 0}
        >
          {status === 'throwing' ? '다트 날아가는 중...' : status === 'idle' ? '다트 던지기' : '다시 던지기'}
        </Button>

        {history.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center max-w-xl">
            {history.map((h) => (
              <Badge key={h.code} variant="outline" className="font-normal text-xs">
                {SIDO_SHORT[h.sidoCode] ?? h.sido} {h.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm text-center">
          {selected && (
            <div className="pop-in flex flex-col items-center gap-2">
              <div className="text-5xl">🎯</div>
              <DialogHeader className="items-center text-center">
                <Badge variant="secondary" className="mb-1">{selected.sido}</Badge>
                <DialogTitle className="text-2xl">{selected.name}</DialogTitle>
                <DialogDescription className="text-center">
                  {describeRegion(selected)}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="sm:justify-center w-full mt-2 gap-2">
                <Button
                  onClick={() => {
                    setDialogOpen(false);
                    throwDart();
                  }}
                >
                  다시 던지기
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={shareResult}>
                  <Share2 className="h-4 w-4" />
                  공유하기
                </Button>
                <DialogClose asChild>
                  <Button variant="ghost">닫기</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Toaster position="bottom-center" richColors />
    </div>
  );
};

export default KoreaTravelDart;
