import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnimAttrs, parseAnimPath, pathToOoxml } from "../src/core/anim.ts";
import type { AnimPathSeg } from "../src/types.ts";

const attrs =
  (map: Record<string, string>) =>
  (name: string): string | null =>
    name in map ? map[name] : null;

test("parseAnimAttrs: full valid attribute set", () => {
  const { def, warnings } = parseAnimAttrs(
    attrs({
      "data-anim": "fly-in",
      "data-anim-trigger": "click",
      "data-anim-delay": "250",
      "data-anim-duration": "800",
      "data-anim-order": "3",
      "data-anim-dir": "left",
    }),
    7,
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(def, {
    effect: "fly-in",
    trigger: "click",
    delayMs: 250,
    durationMs: 800,
    order: 3,
    index: 7,
    dir: "left",
  });
});

test("parseAnimAttrs: per-effect defaults", () => {
  const fade = parseAnimAttrs(attrs({ "data-anim": "fade-in" }), 0).def;
  assert.equal(fade?.trigger, "after");
  assert.equal(fade?.delayMs, 0);
  assert.equal(fade?.durationMs, 500);
  assert.equal(fade?.order, 0);

  const spin = parseAnimAttrs(attrs({ "data-anim": "spin" }), 0).def;
  assert.equal(spin?.durationMs, 2000);
  assert.equal(spin?.rotateDeg, 360);

  const grow = parseAnimAttrs(attrs({ "data-anim": "grow" }), 0).def;
  assert.equal(grow?.scale, 1.5);
  const shrink = parseAnimAttrs(attrs({ "data-anim": "shrink" }), 0).def;
  assert.equal(shrink?.scale, 0.67);

  const fly = parseAnimAttrs(attrs({ "data-anim": "fly-in" }), 0).def;
  assert.equal(fly?.dir, "bottom");
});

test("parseAnimAttrs: unknown effect rejected, element stays static", () => {
  const { def, warnings } = parseAnimAttrs(attrs({ "data-anim": "spiral" }), 0);
  assert.equal(def, null);
  assert.match(warnings[0], /unknown data-anim effect "spiral"/);
});

test("parseAnimAttrs: bad trigger/dir fall back with warnings", () => {
  const { def, warnings } = parseAnimAttrs(
    attrs({ "data-anim": "fly-in", "data-anim-trigger": "hover", "data-anim-dir": "diagonal" }),
    0,
  );
  assert.equal(def?.trigger, "after");
  assert.equal(def?.dir, "bottom");
  assert.equal(warnings.length, 2);
});

test("parseAnimAttrs: delay/duration clamping and validation", () => {
  const a = parseAnimAttrs(
    attrs({ "data-anim": "fade-in", "data-anim-delay": "-5", "data-anim-duration": "999999" }),
    0,
  );
  assert.equal(a.def?.delayMs, 0); // negative → default with warning
  assert.equal(a.def?.durationMs, 60000); // clamped
  assert.equal(a.warnings.length, 1);

  // appear ignores duration entirely.
  const b = parseAnimAttrs(attrs({ "data-anim": "appear", "data-anim-duration": "700" }), 0);
  assert.equal(b.def?.durationMs, 1);
  assert.match(b.warnings[0], /ignored/);
});

test("parseAnimAttrs: no-op spin/scale dropped", () => {
  assert.equal(parseAnimAttrs(attrs({ "data-anim": "spin", "data-anim-rotate": "0" }), 0).def, null);
  assert.equal(parseAnimAttrs(attrs({ "data-anim": "grow", "data-anim-scale": "1" }), 0).def, null);
});

test("parseAnimAttrs: path requires data-anim-path", () => {
  const { def, warnings } = parseAnimAttrs(attrs({ "data-anim": "path" }), 0);
  assert.equal(def, null);
  assert.match(warnings[0], /requires data-anim-path/);
});

test("parseAnimPath: implicit M 0 0 and explicit M re-basing", () => {
  const implicit = parseAnimPath("L 200 -100 L 400 0");
  assert.ok(typeof implicit !== "string");
  assert.deepEqual(implicit.segs, [
    { c: "L", p: [200, -100] },
    { c: "L", p: [400, 0] },
  ]);

  // Explicit M shifts everything so the path starts at the element.
  const rebased = parseAnimPath("M 50 20 L 250 -80 C 300 -100 350 -100 450 20");
  assert.ok(typeof rebased !== "string");
  assert.deepEqual(rebased.segs, [
    { c: "L", p: [200, -100] },
    { c: "C", p: [250, -120, 300, -120, 400, 0] },
  ]);
});

test("parseAnimPath: comma separators, bad commands, truncation", () => {
  const commas = parseAnimPath("L 240,0");
  assert.ok(typeof commas !== "string");
  assert.deepEqual(commas.segs[0], { c: "L", p: [240, 0] });

  assert.match(parseAnimPath("L 10 10 Z") as string, /unsupported command "Z"/);
  assert.match(parseAnimPath("Q 1 2 3 4") as string, /unsupported command "Q"/);
  assert.match(parseAnimPath("L 10") as string, /needs 2 numbers/);
  assert.match(parseAnimPath("M 0 0") as string, /no L\/C segments/);

  // 33 line points → truncated to 32 with the flag set.
  const long = "L " + Array.from({ length: 33 }, (_, i) => `${i + 1} 0`).join(" L ");
  const t = parseAnimPath(long);
  assert.ok(typeof t !== "string");
  assert.equal(t.truncated, true);
  assert.equal(t.segs.length, 32);
});

test("pathToOoxml: slide-fraction conversion, fixed notation", () => {
  const segs: AnimPathSeg[] = [{ c: "L", p: [120, -36] }];
  assert.equal(pathToOoxml(segs, 1280, 720), "M 0 0 L 0.09375 -0.05000 E");

  // Tiny offsets stay fixed-notation (no 1e-7 exponents) and no negative zero.
  const tiny: AnimPathSeg[] = [{ c: "L", p: [0.0001, -0.0000001] }];
  const s = pathToOoxml(tiny, 1920, 1080);
  assert.ok(!/e/i.test(s.replace(/ E$/, "")), s);
  assert.equal(s, "M 0 0 L 0.00000 0.00000 E");

  const curve: AnimPathSeg[] = [{ c: "C", p: [100, -200, 300, -200, 400, 0] }];
  assert.equal(
    pathToOoxml(curve, 1000, 1000),
    "M 0 0 C 0.10000 -0.20000 0.30000 -0.20000 0.40000 0.00000 E",
  );
});
