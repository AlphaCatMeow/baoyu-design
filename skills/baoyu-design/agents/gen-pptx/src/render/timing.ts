// Builds the <p:timing> tree for one slide from the animation manifest. Pure
// string assembly — no zip, no DOM — so the exact OOXML is unit-testable. The
// output slots into the slide XML via VENDOR PATCH 1 (vendor/pptxgenjs).
//
// Structure (PowerPoint's own shape for a main-sequence build):
//   tmRoot par → mainSeq seq → one par per CLICK GROUP → one par per ANIMATION
//   (start offset within the group) → one "effect par" per target SHAPE
//   (presetID/presetClass/nodeType + the concrete behaviors).
// Every p:cTn carries a document-unique id; duplicate ids or an spTgt pointing
// at a nonexistent shape id make PowerPoint show its repair dialog.

import type { AnimationDef, AnimDir } from "../types.ts";
import { pathToOoxml } from "../core/anim.ts";

export interface TimingAnim {
  def: AnimationDef;
  spids: number[];
}

const PRESET: Record<string, { pid: number; cls: string }> = {
  appear: { pid: 1, cls: "entr" },
  disappear: { pid: 1, cls: "exit" },
  "fade-in": { pid: 10, cls: "entr" },
  "fade-out": { pid: 10, cls: "exit" },
  "fly-in": { pid: 2, cls: "entr" },
  "fly-out": { pid: 2, cls: "exit" },
  "wipe-in": { pid: 22, cls: "entr" },
  "zoom-in": { pid: 23, cls: "entr" },
  "zoom-out": { pid: 23, cls: "exit" },
  spin: { pid: 8, cls: "emph" },
  grow: { pid: 6, cls: "emph" },
  shrink: { pid: 6, cls: "emph" },
  path: { pid: 0, cls: "path" },
};

// Fly/wipe presetSubtype direction flags (UI label only; motion comes from the
// behaviors): top=1 right=2 bottom=4 left=8.
const DIR_FLAG: Record<AnimDir, number> = { top: 1, right: 2, bottom: 4, left: 8 };

// Wipe filter: named by the direction the reveal travels, so entering "from
// bottom" wipes upward.
const WIPE_FILTER: Record<AnimDir, string> = {
  bottom: "wipe(up)",
  top: "wipe(down)",
  left: "wipe(right)",
  right: "wipe(left)",
};

// Offscreen start coordinates for fly (normalized slide fractions; #ppt_x/#ppt_y
// are the shape's own resting center, #ppt_w/#ppt_h its size).
const FLY_FROM: Record<AnimDir, { x: string; y: string }> = {
  left: { x: "0-#ppt_w/2", y: "#ppt_y" },
  right: { x: "1+#ppt_w/2", y: "#ppt_y" },
  top: { x: "#ppt_x", y: "0-#ppt_h/2" },
  bottom: { x: "#ppt_x", y: "1+#ppt_h/2" },
};

export function buildTimingXml(anims: TimingAnim[], slideWpx: number, slideHpx: number): string {
  const live = anims.filter((a) => a.spids.length > 0);
  if (live.length === 0) return "";
  // data-anim-order first, document order breaking ties.
  const sorted = [...live].sort((a, b) => a.def.order - b.def.order || a.def.index - b.def.index);

  let idCounter = 0;
  const nid = (): number => ++idCounter;
  nid(); // 1 → tmRoot
  nid(); // 2 → mainSeq

  const setVis = (spid: number, val: "visible" | "hidden", delay: number): string =>
    `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold">` +
    `<p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:to><p:strVal val="${val}"/></p:to></p:set>`;

  const animEffect = (spid: number, dir: "in" | "out", filter: string, dur: number): string =>
    `<p:animEffect transition="${dir}" filter="${filter}">` +
    `<p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`;

  const flyAnim = (spid: number, attr: "ppt_x" | "ppt_y", from: string, to: string, dur: number): string =>
    `<p:anim calcmode="lin" valueType="num">` +
    `<p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
    `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav>` +
    `<p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;

  const animScaleFromTo = (spid: number, from: number, to: number, dur: number): string =>
    `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>` +
    `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr>` +
    `<p:from x="${from}" y="${from}"/><p:to x="${to}" y="${to}"/></p:animScale>`;

  // Behaviors for one animation applied to one shape.
  const behaviors = (def: AnimationDef, spid: number): string => {
    const d = def.durationMs;
    const dir = def.dir ?? "bottom";
    switch (def.effect) {
      case "appear":
        return setVis(spid, "visible", 0);
      case "disappear":
        return setVis(spid, "hidden", 0);
      case "fade-in":
        return setVis(spid, "visible", 0) + animEffect(spid, "in", "fade", d);
      case "fade-out":
        return animEffect(spid, "out", "fade", d) + setVis(spid, "hidden", Math.max(d - 1, 0));
      case "fly-in": {
        const from = FLY_FROM[dir];
        return (
          setVis(spid, "visible", 0) +
          flyAnim(spid, "ppt_x", from.x, "#ppt_x", d) +
          flyAnim(spid, "ppt_y", from.y, "#ppt_y", d)
        );
      }
      case "fly-out": {
        const to = FLY_FROM[dir];
        return (
          flyAnim(spid, "ppt_x", "#ppt_x", to.x, d) +
          flyAnim(spid, "ppt_y", "#ppt_y", to.y, d) +
          setVis(spid, "hidden", Math.max(d - 1, 0))
        );
      }
      case "wipe-in":
        return setVis(spid, "visible", 0) + animEffect(spid, "in", WIPE_FILTER[dir], d);
      case "zoom-in":
        // from 10% (not 0) — matches the preview approximation and avoids
        // degenerate zero-scale frames in some renderers.
        return setVis(spid, "visible", 0) + animEffect(spid, "in", "fade", d) + animScaleFromTo(spid, 10000, 100000, d);
      case "zoom-out":
        return (
          animEffect(spid, "out", "fade", d) +
          animScaleFromTo(spid, 100000, 10000, d) +
          setVis(spid, "hidden", Math.max(d - 1, 0))
        );
      case "spin": {
        const by = Math.round((def.rotateDeg ?? 360) * 60000);
        return (
          `<p:animRot by="${by}"><p:cBhvr><p:cTn id="${nid()}" dur="${d}" fill="hold"/>` +
          `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
          `<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`
        );
      }
      case "grow":
      case "shrink": {
        const v = Math.round((def.scale ?? (def.effect === "grow" ? 1.5 : 0.67)) * 100000);
        return (
          `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${d}" fill="hold"/>` +
          `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr>` +
          `<p:by x="${v}" y="${v}"/></p:animScale>`
        );
      }
      case "path": {
        const path = pathToOoxml(def.pathSegs ?? [], slideWpx, slideHpx);
        return (
          `<p:animMotion origin="layout" path="${path}" pathEditMode="relative" ptsTypes="">` +
          `<p:cBhvr><p:cTn id="${nid()}" dur="${d}" fill="hold"/>` +
          `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>` +
          `<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst>` +
          `</p:cBhvr></p:animMotion>`
        );
      }
    }
  };

  // One effect par per target shape: the first carries the animation's trigger
  // nodeType, extra shapes ride along as withEffect so a multi-shape element
  // animates as one.
  const effectPar = (def: AnimationDef, spid: number, nodeType: string): string => {
    const preset = PRESET[def.effect];
    const sub =
      def.effect === "fly-in" || def.effect === "fly-out" || def.effect === "wipe-in"
        ? DIR_FLAG[def.dir ?? "bottom"]
        : 0;
    return (
      `<p:par><p:cTn id="${nid()}" presetID="${preset.pid}" presetClass="${preset.cls}" ` +
      `presetSubtype="${sub}" fill="hold" grpId="0" nodeType="${nodeType}">` +
      `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
      `<p:childTnLst>${behaviors(def, spid)}</p:childTnLst>` +
      `</p:cTn></p:par>`
    );
  };

  const NODE_TYPE: Record<string, string> = { click: "clickEffect", with: "withEffect", after: "afterEffect" };

  // Group the sorted animations into click groups and schedule starts (ms
  // offsets from the group start): click opens a group at its own delay, with
  // co-starts with the previous animation, after chains behind the group's end.
  interface Group {
    auto: boolean; // opens without a click (deck-entry lead-in)
    items: { def: AnimationDef; spids: number[]; start: number }[];
  }
  const groups: Group[] = [];
  let prevStart = 0;
  let groupEnd = 0;
  for (const a of sorted) {
    const opens = groups.length === 0 || a.def.trigger === "click";
    if (opens) {
      groups.push({ auto: a.def.trigger !== "click", items: [] });
      prevStart = 0;
      groupEnd = 0;
    }
    const g = groups[groups.length - 1];
    const start = opens
      ? a.def.delayMs
      : a.def.trigger === "with"
        ? prevStart + a.def.delayMs
        : groupEnd + a.def.delayMs;
    g.items.push({ def: a.def, spids: a.spids, start });
    prevStart = start;
    groupEnd = Math.max(groupEnd, start + a.def.durationMs);
  }

  // Ids mint in document order (group → animation → effect → behaviors), like
  // PowerPoint's own writer. Only uniqueness is load-bearing.
  let groupsXml = "";
  for (const g of groups) {
    const gid = nid();
    let inner = "";
    for (const item of g.items) {
      const iid = nid();
      const nodeType = NODE_TYPE[item.def.trigger];
      const pars = item.spids
        .map((spid, i) => effectPar(item.def, spid, i === 0 ? nodeType : "withEffect"))
        .join("");
      inner +=
        `<p:par><p:cTn id="${iid}" fill="hold">` +
        `<p:stCondLst><p:cond delay="${item.start}"/></p:stCondLst>` +
        `<p:childTnLst>${pars}</p:childTnLst>` +
        `</p:cTn></p:par>`;
    }
    groupsXml +=
      `<p:par><p:cTn id="${gid}" fill="hold">` +
      `<p:stCondLst><p:cond delay="${g.auto ? "0" : "indefinite"}"/></p:stCondLst>` +
      `<p:childTnLst>${inner}</p:childTnLst>` +
      `</p:cTn></p:par>`;
  }

  const bldSpids = [...new Set(sorted.flatMap((a) => a.spids))];
  const bldLst = `<p:bldLst>${bldSpids.map((s) => `<p:bldP spid="${s}" grpId="0" animBg="1"/>`).join("")}</p:bldLst>`;

  return (
    `<p:timing><p:tnLst><p:par>` +
    `<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groupsXml}</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq>` +
    `</p:childTnLst></p:cTn>` +
    `</p:par></p:tnLst>${bldLst}</p:timing>`
  );
}
