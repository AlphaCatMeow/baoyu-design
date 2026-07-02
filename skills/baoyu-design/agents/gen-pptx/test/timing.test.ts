import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimingXml, type TimingAnim } from "../src/render/timing.ts";
import type { AnimationDef } from "../src/types.ts";

const def = (over: Partial<AnimationDef>): AnimationDef => ({
  effect: "fade-in",
  trigger: "after",
  delayMs: 0,
  durationMs: 500,
  order: 0,
  index: 0,
  ...over,
});

const anim = (spids: number[], over: Partial<AnimationDef>): TimingAnim => ({ def: def(over), spids });

test("buildTimingXml: skeleton (tmRoot, mainSeq, seq conditions, bldLst)", () => {
  const xml = buildTimingXml([anim([2], {})], 1920, 1080);
  assert.match(xml, /^<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">/);
  assert.match(xml, /<p:cTn id="2" dur="indefinite" nodeType="mainSeq">/);
  assert.match(xml, /<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt\/><\/p:tgtEl><\/p:cond><\/p:prevCondLst>/);
  assert.match(xml, /<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt\/><\/p:tgtEl><\/p:cond><\/p:nextCondLst>/);
  assert.match(xml, /<p:bldLst><p:bldP spid="2" grpId="0" animBg="1"\/><\/p:bldLst><\/p:timing>$/);
});

test("buildTimingXml: auto lead-in group opens at delay 0, click group at indefinite", () => {
  const auto = buildTimingXml([anim([2], { trigger: "after" })], 1920, 1080);
  const groupCond = auto.match(/mainSeq"><p:childTnLst><p:par><p:cTn id="\d+" fill="hold"><p:stCondLst><p:cond delay="([^"]+)"/);
  assert.equal(groupCond?.[1], "0");

  const click = buildTimingXml([anim([2], { trigger: "click" })], 1920, 1080);
  const clickCond = click.match(/mainSeq"><p:childTnLst><p:par><p:cTn id="\d+" fill="hold"><p:stCondLst><p:cond delay="([^"]+)"/);
  assert.equal(clickCond?.[1], "indefinite");
  assert.match(click, /nodeType="clickEffect"/);
});

test("buildTimingXml: after chains behind group end, with co-starts", () => {
  const xml = buildTimingXml(
    [
      anim([2], { index: 0, durationMs: 500 }),
      anim([3], { index: 1, trigger: "after", delayMs: 250, durationMs: 400 }),
      anim([4], { index: 2, trigger: "with", delayMs: 0 }),
    ],
    1920,
    1080,
  );
  // Inner-par start offsets: first 0, second 500+250=750, third with → 750.
  const starts = [...xml.matchAll(/<p:par><p:cTn id="\d+" fill="hold"><p:stCondLst><p:cond delay="(\d+)"\/><\/p:stCondLst><p:childTnLst><p:par><p:cTn id="\d+" presetID/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(starts, ["0", "750", "750"]);
  assert.match(xml, /nodeType="afterEffect"/);
  assert.match(xml, /nodeType="withEffect"/);
});

test("buildTimingXml: data-anim-order overrides document order", () => {
  const xml = buildTimingXml(
    [
      anim([2], { index: 0, order: 5, effect: "fade-in" }),
      anim([3], { index: 1, order: 1, effect: "wipe-in", dir: "left" }),
    ],
    1920,
    1080,
  );
  const wipePos = xml.indexOf('filter="wipe(right)"');
  const fadePos = xml.indexOf('filter="fade"');
  assert.ok(wipePos >= 0 && fadePos >= 0 && wipePos < fadePos, "order 1 (wipe) must precede order 5 (fade)");
});

test("buildTimingXml: effect fragments", () => {
  const w = 1280;
  const h = 720;
  // fade-in: set visible + animEffect in/fade
  const fadeIn = buildTimingXml([anim([2], {})], w, h);
  assert.match(fadeIn, /<p:to><p:strVal val="visible"\/><\/p:to>/);
  assert.match(fadeIn, /<p:animEffect transition="in" filter="fade">/);
  assert.match(fadeIn, /presetID="10" presetClass="entr"/);

  // fade-out: out transition + hidden at D-1
  const fadeOut = buildTimingXml([anim([2], { effect: "fade-out", durationMs: 600 })], w, h);
  assert.match(fadeOut, /<p:animEffect transition="out" filter="fade">/);
  assert.match(fadeOut, /<p:cond delay="599"\/>.*<p:strVal val="hidden"\/>/);
  assert.match(fadeOut, /presetClass="exit"/);

  // appear/disappear: set only, dur 1
  const appear = buildTimingXml([anim([2], { effect: "appear", durationMs: 1 })], w, h);
  assert.match(appear, /presetID="1" presetClass="entr"/);
  assert.ok(!/animEffect/.test(appear));

  // fly-in from left: subtype 8, offscreen x start, both axes animated
  const fly = buildTimingXml([anim([2], { effect: "fly-in", dir: "left" })], w, h);
  assert.match(fly, /presetID="2" presetClass="entr" presetSubtype="8"/);
  assert.match(fly, /<p:strVal val="0-#ppt_w\/2"\/>/);
  assert.match(fly, /<p:attrName>ppt_y<\/p:attrName>/);
  assert.match(fly, /<p:strVal val="#ppt_x"\/>/);

  // wipe-in from bottom → wipe(up), subtype 4
  const wipe = buildTimingXml([anim([2], { effect: "wipe-in", dir: "bottom" })], w, h);
  assert.match(wipe, /presetID="22".*filter="wipe\(up\)"/);
  assert.match(wipe, /presetSubtype="4"/);

  // zoom-in: fade + scale 10% → 100%
  const zoom = buildTimingXml([anim([2], { effect: "zoom-in" })], w, h);
  assert.match(zoom, /presetID="23"/);
  assert.match(zoom, /<p:from x="10000" y="10000"\/><p:to x="100000" y="100000"\/>/);

  // spin 360° → by=21600000 on attribute r
  const spin = buildTimingXml([anim([2], { effect: "spin", rotateDeg: 360, durationMs: 2000 })], w, h);
  assert.match(spin, /<p:animRot by="21600000">/);
  assert.match(spin, /<p:attrName>r<\/p:attrName>/);
  assert.match(spin, /presetID="8" presetClass="emph"/);

  // grow ×1.5 → by=150000
  const grow = buildTimingXml([anim([2], { effect: "grow", scale: 1.5 })], w, h);
  assert.match(grow, /<p:by x="150000" y="150000"\/>/);

  // path: animMotion with fraction path + both position attributes
  const path = buildTimingXml(
    [anim([2], { effect: "path", pathSegs: [{ c: "L", p: [128, -72] }], durationMs: 2000 })],
    w,
    h,
  );
  assert.match(path, /<p:animMotion origin="layout" path="M 0 0 L 0\.10000 -0\.10000 E" pathEditMode="relative"/);
  assert.match(path, /<p:attrName>ppt_x<\/p:attrName><p:attrName>ppt_y<\/p:attrName>/);
  assert.match(path, /presetClass="path"/);
});

test("buildTimingXml: multi-shape element animates all shapes together", () => {
  const xml = buildTimingXml([anim([5, 6, 7], { trigger: "click" })], 1920, 1080);
  assert.equal([...xml.matchAll(/<p:spTgt spid="5"\/>/g)].length >= 1, true);
  const nodeTypes = [...xml.matchAll(/nodeType="(clickEffect|withEffect|afterEffect)"/g)].map((m) => m[1]);
  assert.deepEqual(nodeTypes, ["clickEffect", "withEffect", "withEffect"]);
  // one bldP per distinct spid
  assert.equal([...xml.matchAll(/<p:bldP /g)].length, 3);
});

test("buildTimingXml: every cTn id is unique", () => {
  const xml = buildTimingXml(
    [
      anim([2, 3], { index: 0, trigger: "click", effect: "fly-in", dir: "top" }),
      anim([4], { index: 1, trigger: "with", effect: "spin", rotateDeg: -720 }),
      anim([5], { index: 2, trigger: "after", effect: "zoom-out" }),
      anim([6], { index: 3, trigger: "click", effect: "path", pathSegs: [{ c: "C", p: [1, 2, 3, 4, 5, 6] }] }),
    ],
    1920,
    1080,
  );
  const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate cTn ids in: ${ids.join(",")}`);
});

test("buildTimingXml: empty and all-hidden input produce no timing", () => {
  assert.equal(buildTimingXml([], 1920, 1080), "");
  assert.equal(buildTimingXml([anim([], {})], 1920, 1080), "");
});
