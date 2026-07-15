import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  SIDO_COLORS[code] = `hsl(${hue}, 45%, 82%)`;
});

const SIDO_SHORT: Record<string, string> = {
  '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주',
  '25': '대전', '26': '울산', '29': '세종', '31': '경기', '32': '강원',
  '33': '충북', '34': '충남', '35': '전북', '36': '전남', '37': '경북',
  '38': '경남', '39': '제주',
};

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

function pickWeightedRegion(excludeCode?: string): Region {
  let region = REGIONS[REGIONS.length - 1];
  for (let attempt = 0; attempt < 6; attempt++) {
    let t = Math.random() * TOTAL_AREA;
    for (const r of REGIONS) {
      if (t < r.area) {
        region = r;
        break;
      }
      t -= r.area;
    }
    if (region.code !== excludeCode) break;
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

const KoreaTravelDart: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [target, setTarget] = useState<Point>([VB_W / 2, VB_H * 0.08]);
  const [selected, setSelected] = useState<Region | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hitKey, setHitKey] = useState(0);
  const timeoutRef = useRef<number | null>(null);

  const throwDart = () => {
    if (status === 'throwing') return;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);

    const region = pickWeightedRegion(selected?.code);
    const point = samplePointInRegion(region);

    setStatus('throwing');
    setTarget(point);

    timeoutRef.current = window.setTimeout(() => {
      setSelected(region);
      setStatus('result');
      setHitKey((k) => k + 1);
      setHistory((h) => [
        { code: region.code, name: region.name, sido: region.sido, sidoCode: region.sidoCode },
        ...h.filter((e) => e.code !== region.code),
      ].slice(0, 6));
    }, 750);
  };

  const dartLeftPct = ((target[0] - VB_X) / VB_W) * 100;
  const dartTopPct = ((target[1] - VB_Y) / VB_H) * 100;

  return (
    <div className="p-6">
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
        .dart-marker--throwing { animation: dart-spin-fly 0.75s cubic-bezier(.25,.6,.3,1) forwards; }
        .dart-marker--landed { animation: dart-land-bounce 0.35s ease-out forwards; }
        .ripple-circle { animation: ripple-ring 0.9s ease-out forwards; }
      `}</style>

      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">대한민국 여행지 다트 🎯</h1>
          <p className="text-sm text-muted-foreground">
            지도 위에 다트를 던져서 다음 여행지(시/군/구)를 무작위로 골라보세요
          </p>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-4 sm:p-6">
            <div className="relative w-full max-w-xl mx-auto select-none">
              <svg
                viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
                className="w-full h-auto rounded-md bg-slate-50 dark:bg-slate-900"
              >
                {REGIONS.map((r) => {
                  const isSelected = selected?.code === r.code && status === 'result';
                  return (
                    <path
                      key={r.code}
                      d={r.path}
                      fill={isSelected ? '#ef4444' : SIDO_COLORS[r.sidoCode]}
                      stroke={isSelected ? '#7f1d1d' : '#ffffff'}
                      strokeWidth={isSelected ? 1.5 : 0.6}
                      style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
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
                  transition: 'left 0.75s cubic-bezier(.25,.6,.3,1), top 0.75s cubic-bezier(.25,.6,.3,1)',
                }}
              >
                📍
              </div>
            </div>

            <div className="flex justify-center mt-5">
              <Button size="lg" onClick={throwDart} disabled={status === 'throwing'}>
                {status === 'throwing' ? '다트 날아가는 중...' : status === 'idle' ? '다트 던지기' : '다시 던지기'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {selected && status === 'result' && (
          <Card>
            <CardContent className="p-5 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{selected.sido}</Badge>
                <h2 className="text-xl font-bold">{selected.name}</h2>
              </div>
              <p className="text-muted-foreground">{describeRegion(selected)}</p>
            </CardContent>
          </Card>
        )}

        {history.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-center pt-1">
            <span className="text-xs text-muted-foreground mr-1">최근 뽑은 지역</span>
            {history.map((h) => (
              <Badge key={h.code} variant="outline" className="font-normal">
                {SIDO_SHORT[h.sidoCode] ?? h.sido} {h.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KoreaTravelDart;
