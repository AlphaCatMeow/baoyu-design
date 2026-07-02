// data-anim-* attribute grammar, shared by the browser walk() and node-side
// tests. Pure and dependency-free (type-only imports) so the browser bundle can
// include it without pulling in the Node graph.

import type { AnimationDef, AnimDir, AnimEffect, AnimPathSeg, AnimTrigger } from "../types.ts";

export interface ParsedAnim {
  def: AnimationDef | null;
  warnings: string[];
}

const DURATION_DEFAULT: Record<AnimEffect, number> = {
  appear: 1,
  disappear: 1,
  "fade-in": 500,
  "fade-out": 500,
  "fly-in": 500,
  "fly-out": 500,
  "wipe-in": 500,
  "zoom-in": 500,
  "zoom-out": 500,
  spin: 2000,
  grow: 2000,
  shrink: 2000,
  path: 2000,
};

const DIRECTIONAL: Record<string, 1> = { "fly-in": 1, "fly-out": 1, "wipe-in": 1 };
const DIRS: Record<string, 1> = { left: 1, right: 1, top: 1, bottom: 1 };
const TRIGGERS: Record<string, 1> = { click: 1, with: 1, after: 1 };

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Parse one element's data-anim-* attributes. `get` is el.getAttribute (or a
 * plain map lookup in tests); `index` is the per-slide document order assigned
 * by the caller. A null def means the effect was rejected — the element still
 * exports, just statically.
 */
export function parseAnimAttrs(
  get: (name: string) => string | null,
  index: number,
): ParsedAnim {
  const warnings: string[] = [];
  const effect = (get("data-anim") ?? "").trim().toLowerCase();
  if (!(effect in DURATION_DEFAULT)) {
    warnings.push(`unknown data-anim effect "${effect}" — element exported without animation`);
    return { def: null, warnings };
  }
  const eff = effect as AnimEffect;

  const rawTrigger = get("data-anim-trigger");
  let trigger: AnimTrigger = "after";
  if (rawTrigger !== null) {
    const t = rawTrigger.trim().toLowerCase();
    if (t in TRIGGERS) trigger = t as AnimTrigger;
    else warnings.push(`invalid data-anim-trigger "${rawTrigger}" — using "after"`);
  }

  const intAttr = (name: string, fallback: number, lo: number, hi: number): number => {
    const raw = get(name);
    if (raw === null) return fallback;
    const v = parseInt(raw, 10);
    if (Number.isNaN(v) || v < lo) {
      warnings.push(`invalid ${name} "${raw}" — using ${fallback}`);
      return fallback;
    }
    return clampNum(v, lo, hi);
  };

  const delayMs = intAttr("data-anim-delay", 0, 0, 60000);
  let durationMs: number;
  if (eff === "appear" || eff === "disappear") {
    if (get("data-anim-duration") !== null) {
      warnings.push(`data-anim-duration is ignored for "${eff}" (instant effect)`);
    }
    durationMs = 1;
  } else {
    durationMs = intAttr("data-anim-duration", DURATION_DEFAULT[eff], 1, 60000);
  }

  const rawOrder = get("data-anim-order");
  let order = 0;
  if (rawOrder !== null) {
    const v = parseInt(rawOrder, 10);
    if (Number.isNaN(v)) warnings.push(`invalid data-anim-order "${rawOrder}" — using document order`);
    else order = v;
  }

  const def: AnimationDef = { effect: eff, trigger, delayMs, durationMs, order, index };

  const rawDir = get("data-anim-dir");
  if (eff in DIRECTIONAL) {
    let dir: AnimDir = "bottom";
    if (rawDir !== null) {
      const d = rawDir.trim().toLowerCase();
      if (d in DIRS) dir = d as AnimDir;
      else warnings.push(`invalid data-anim-dir "${rawDir}" — using "bottom"`);
    }
    def.dir = dir;
  } else if (rawDir !== null) {
    warnings.push(`data-anim-dir has no effect on "${eff}"`);
  }

  if (eff === "spin") {
    const raw = get("data-anim-rotate");
    let deg = 360;
    if (raw !== null) {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) warnings.push(`invalid data-anim-rotate "${raw}" — using 360`);
      else deg = clampNum(v, -3600, 3600);
    }
    if (deg === 0) {
      warnings.push(`data-anim-rotate 0 spins nowhere — animation dropped`);
      return { def: null, warnings };
    }
    def.rotateDeg = deg;
  }

  if (eff === "grow" || eff === "shrink") {
    const raw = get("data-anim-scale");
    let scale = eff === "grow" ? 1.5 : 0.67;
    if (raw !== null) {
      const v = parseFloat(raw);
      if (Number.isNaN(v)) warnings.push(`invalid data-anim-scale "${raw}" — using ${scale}`);
      else scale = clampNum(v, 0.1, 5);
    }
    if (scale === 1) {
      warnings.push(`data-anim-scale 1 changes nothing — animation dropped`);
      return { def: null, warnings };
    }
    def.scale = scale;
  }

  if (eff === "path") {
    const raw = get("data-anim-path");
    if (raw === null || !raw.trim()) {
      warnings.push(`data-anim="path" requires data-anim-path — animation dropped`);
      return { def: null, warnings };
    }
    const parsed = parseAnimPath(raw);
    if (typeof parsed === "string") {
      warnings.push(`${parsed} — animation dropped`);
      return { def: null, warnings };
    }
    if (parsed.truncated) warnings.push(`data-anim-path exceeds 32 points — truncated`);
    def.pathSegs = parsed.segs;
  }

  return { def, warnings };
}

const MAX_PATH_POINTS = 32;

/**
 * Parse a data-anim-path value: optional leading `M x y`, then `L x y` /
 * `C x1 y1 x2 y2 x y` segments; px offsets in slide space, +y down. All
 * coordinates are re-based so the path starts at (0,0) — the element's
 * authored position. Returns an error string on bad input.
 */
export function parseAnimPath(spec: string): { segs: AnimPathSeg[]; truncated: boolean } | string {
  const tokens = spec.trim().split(/[\s,]+/).filter(Boolean);
  let i = 0;
  const nums = (n: number, cmd: string): number[] | string => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = parseFloat(tokens[i] ?? "");
      if (!Number.isFinite(v)) return `data-anim-path: "${cmd}" needs ${n} numbers`;
      out.push(v);
      i++;
    }
    return out;
  };

  let baseX = 0;
  let baseY = 0;
  if ((tokens[i] ?? "").toUpperCase() === "M") {
    i++;
    const m = nums(2, "M");
    if (typeof m === "string") return m;
    [baseX, baseY] = m;
  }

  const segs: AnimPathSeg[] = [];
  let points = 0;
  let truncated = false;
  while (i < tokens.length) {
    const cmd = tokens[i].toUpperCase();
    i++;
    let seg: AnimPathSeg;
    if (cmd === "L") {
      const p = nums(2, "L");
      if (typeof p === "string") return p;
      seg = { c: "L", p: [p[0] - baseX, p[1] - baseY] };
      points += 1;
    } else if (cmd === "C") {
      const p = nums(6, "C");
      if (typeof p === "string") return p;
      seg = { c: "C", p: p.map((v, k) => v - (k % 2 === 0 ? baseX : baseY)) };
      points += 3;
    } else {
      return `data-anim-path: unsupported command "${cmd}" (only M, L, C)`;
    }
    if (points > MAX_PATH_POINTS) {
      truncated = true;
      break;
    }
    segs.push(seg);
  }
  if (segs.length === 0) return `data-anim-path has no L/C segments`;
  return { segs, truncated };
}

// Fixed 5 decimals, no exponent notation, no negative zero.
const frac = (n: number): string => {
  const s = n.toFixed(5);
  return s === "-0.00000" ? "0.00000" : s;
};

/**
 * Convert re-based px segments to the OOXML animMotion path string: slide-size
 * fractions, `M 0 0` start, `E` end (stop at the final point).
 */
export function pathToOoxml(segs: AnimPathSeg[], slideWpx: number, slideHpx: number): string {
  let out = "M 0 0";
  for (const seg of segs) {
    const vals = seg.p.map((v, k) => frac(v / (k % 2 === 0 ? slideWpx : slideHpx)));
    out += ` ${seg.c} ${vals.join(" ")}`;
  }
  return out + " E";
}
