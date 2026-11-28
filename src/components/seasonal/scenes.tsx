"use client";

import type { Theme } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { CandyCane, EasterEgg, JackOLantern } from "./art";
import { useLanternLit, useLightsOut } from "./lights";
import { useReducedMotion, useSeason } from "./season-context";

/*
 * A strip of seasonal scenery under the landing page's hero: a candy town
 * with waving elves at Christmas, a pumpkin patch whose lanterns flicker at
 * Halloween, and a spring meadow with a hopping bunny at Easter. Plain SVG;
 * all motion is CSS (globals.css, "seasonal themes") and stops for reduced
 * motion. The scenes are 1200 × 240 and cropped at the sides on narrow
 * screens, so what matters sits in the middle.
 */

const W = 1200;
const H = 240;
const GROUND = 206;

/** Under the hero on the landing page; nothing outside the seasons or when decorations are hidden. */
export function SeasonalScene() {
  const theme = useSeason();
  const dark = useLightsOut();
  if (!theme) return null;
  return (
    <section
      aria-hidden
      data-season-scene={theme}
      // While the page is dark the patch stays lit, above the darkness.
      className="relative px-3 pt-3 sm:px-6"
      style={dark ? { zIndex: 36 } : undefined}
    >
      <div className={cn("mx-auto h-[190px] max-w-[1392px] overflow-hidden rounded-xl sm:h-[240px]", BACKDROP[theme])}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="block h-full w-full">
          {theme === "christmas" ? <CandyTown /> : null}
          {theme === "halloween" ? <PumpkinPatch /> : null}
          {theme === "easter" ? <SpringMeadow /> : null}
        </svg>
      </div>
    </section>
  );
}

const BACKDROP: Record<Theme, string> = {
  christmas: "bg-[linear-gradient(#d9eaf8,#f6fafe)]",
  halloween: "bg-[linear-gradient(#21172f,#3f2b57)]",
  easter: "bg-[linear-gradient(#e2f3ff,#f7fcf2)]",
};

/** A piece drawn in its own coordinates, placed with its feet at (x, bottom). */
function Place({ x, bottom, w, h, view, children, className }: { x: number; bottom: number; w: number; h: number; view: string; children: React.ReactNode; className?: string }) {
  return (
    <g className={className}>
      <svg x={x - w / 2} y={bottom - h} width={w} height={h} viewBox={view} overflow="visible">
        {children}
      </svg>
    </g>
  );
}

// ================================================================ Christmas: candy town

const CANDY = ["#e8505b", "#f2c14e", "#58b368", "#6aa6e8", "#c77ddb"];

function CandyTown() {
  return (
    <g data-scene="candy-town">
      <StringLights />
      {/* Snowy hills behind, then the street. */}
      <path d={`M0 170 C140 140 260 150 380 165 C520 182 640 140 800 150 C930 158 1060 140 ${W} 160 V${H} H0 Z`} fill="#e7f0f9" />
      <House x={150} scale={1.25} />
      <Lollipop x={300} h={120} color="#f58fb0" />
      <Lamp x={410} />
      <House x={555} scale={0.95} roof="#7d4320" />
      <Lollipop x={760} h={100} color="#8fd0f5" />
      <Lamp x={860} />
      <House x={1010} scale={1.2} roof="#93512a" />
      <Snowman x={1150} />
      <path d={`M0 ${GROUND - 4} C200 ${GROUND - 14} 420 ${GROUND + 2} 600 ${GROUND - 8} C800 ${GROUND - 16} 1000 ${GROUND} ${W} ${GROUND - 10} V${H} H0 Z`} fill="#ffffff" />
      <path d={`M0 ${GROUND + 14} C300 ${GROUND + 6} 700 ${GROUND + 20} ${W} ${GROUND + 10}`} stroke="#d8e6f2" strokeWidth="3" fill="none" />
      {/* The elves, waving in turn; the middle one hops. */}
      <Elf x={250} delay={0} />
      <Elf x={470} delay={1.4} tunic="#d63b30" hat="#2f8a52" collar="#2f8a52" />
      <Elf x={650} delay={0.7} hop />
      <Elf x={720} delay={2.1} tunic="#d63b30" hat="#2f8a52" collar="#2f8a52" mirror />
      <Elf x={910} delay={2.8} mirror />
    </g>
  );
}

/** Bulbs hung on a wire that sags between three points, twinkling out of step. */
function StringLights() {
  const wire = (t: number, a: number[], b: number[], c: number[]) => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t ** 2 * c[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t ** 2 * c[1],
  ];
  const spans = [
    [[-10, 18], [300, 74], [600, 20]],
    [[600, 20], [900, 74], [1210, 18]],
  ];
  const bulbs = spans.flatMap(([a, b, c]) => Array.from({ length: 12 }, (_, i) => wire((i + 0.5) / 12, a, b, c)));
  return (
    <g>
      {spans.map(([a, b, c], i) => (
        <path key={i} d={`M${a[0]} ${a[1]} Q${b[0]} ${b[1]} ${c[0]} ${c[1]}`} stroke="#3c4b3f" strokeWidth="2" fill="none" />
      ))}
      {bulbs.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <rect x="-2.5" y="-1" width="5" height="5" rx="1" fill="#3c4b3f" />
          <ellipse
            cy="10"
            rx="5"
            ry="7.5"
            fill={CANDY[i % CANDY.length]}
            className="season-twinkle"
            style={{ animationDelay: `${(i * 0.37) % 2.2}s` }}
          />
        </g>
      ))}
    </g>
  );
}

function House({ x, scale = 1, roof = "#8a4a22" }: { x: number; scale?: number; roof?: string }) {
  const w = 140 * scale;
  const h = 130 * scale;
  return (
    <Place x={x} bottom={GROUND + 2} w={w} h={h} view="0 0 140 130">
      <rect x="14" y="55" width="112" height="75" rx="4" fill="#b46a35" />
      <rect x="96" y="14" width="14" height="30" fill="#9d5a2c" />
      <rect x="93" y="11" width="20" height="6" rx="3" fill="#ffffff" />
      <path d="M4 64 L70 8 L136 64 Z" fill={roof} />
      <path d="M4 64 L70 8 L136 64" stroke="#ffffff" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      {/* icing drips under the roof's edges */}
      {[18, 32, 46, 94, 108, 122].map((cx) => (
        <circle key={cx} cx={cx} cy={64 - Math.min(cx - 4, 136 - cx) * (56 / 66) + 6} r="2.6" fill="#ffffff" />
      ))}
      {[
        [40, 40, 0],
        [56, 27, 1],
        [70, 16, 2],
        [84, 27, 3],
        [100, 40, 4],
      ].map(([cx, cy, c]) => (
        <path key={cx} d={`M${cx - 5} ${cy + 3} Q${cx - 5} ${cy - 5} ${cx} ${cy - 5} Q${cx + 5} ${cy - 5} ${cx + 5} ${cy + 3} Z`} fill={CANDY[c]} />
      ))}
      <circle cx="70" cy="44" r="9" fill="#ffffff" />
      <circle cx="70" cy="44" r="6" fill="none" stroke="#e8505b" strokeWidth="5" strokeDasharray="3 3.3" />
      {[28, 90].map((wx) => (
        <g key={wx}>
          <rect x={wx} y="72" width="22" height="20" rx="2" fill="#ffe08a" stroke="#ffffff" strokeWidth="3" />
          <path d={`M${wx + 11} 72 V92 M${wx} 82 H${wx + 22}`} stroke="#ffffff" strokeWidth="2" />
        </g>
      ))}
      <path d="M58 130 V104 a12 12 0 0 1 24 0 V130 Z" fill="#6b3a1c" stroke="#ffffff" strokeWidth="3" />
      <circle cx="77" cy="117" r="1.8" fill="#f2c14e" />
      {[22, 34, 46, 94, 106, 118].map((cx, i) => (
        <circle key={cx} cx={cx} cy="104" r="3.2" fill={i % 2 ? "#58b368" : "#e8505b"} />
      ))}
      <path d="M14 58 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0 q7 6 14 0" stroke="#ffffff" strokeWidth="3" fill="none" />
    </Place>
  );
}

function Lollipop({ x, h, color }: { x: number; h: number; color: string }) {
  return (
    <Place x={x} bottom={GROUND} w={h * 0.42} h={h} view="0 0 50 120">
      <rect x="23" y="40" width="4" height="80" rx="2" fill="#f3e6d8" />
      <circle cx="25" cy="24" r="20" fill={color} />
      <path
        d="M25 24 m0 -3 a3 3 0 1 1 -3 3 a6 6 0 1 1 6 6 a9 9 0 1 1 -9 -9 a12 12 0 1 1 12 12 a15 15 0 1 1 -15 -15"
        stroke="#ffffff"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M25 46 l-8 -5 v10 z M25 46 l8 -5 v10 z" fill="#2f8a52" />
    </Place>
  );
}

/** A candy-cane lamp post with its light hanging from the hook. */
function Lamp({ x }: { x: number }) {
  const k = 1.2; // the cane's drawing is 54 × 100, its foot at y 94 and its hook's end at (40, 37)
  const x0 = x - 27 * k;
  const y0 = GROUND + 4 - 94 * k;
  return (
    <g>
      <svg x={x0} y={y0} width={54 * k} height={100 * k} overflow="visible">
        <CandyCane />
      </svg>
      <circle cx={x0 + 40 * k} cy={y0 + 37 * k + 9} r="6" fill="#ffe08a" className="season-twinkle" style={{ animationDuration: "3.2s" }} />
    </g>
  );
}

function Snowman({ x }: { x: number }) {
  return (
    <Place x={x} bottom={GROUND + 4} w={60} h={96} view="0 0 60 96">
      <circle cx="30" cy="72" r="22" fill="#ffffff" stroke="#d8e6f2" strokeWidth="2" />
      <circle cx="30" cy="38" r="15" fill="#ffffff" stroke="#d8e6f2" strokeWidth="2" />
      <rect x="20" y="10" width="20" height="16" rx="2" fill="#2b2133" />
      <rect x="15" y="24" width="30" height="4" rx="2" fill="#2b2133" />
      <circle cx="25" cy="36" r="1.6" fill="#2b2133" />
      <circle cx="35" cy="36" r="1.6" fill="#2b2133" />
      <path d="M30 40 l9 2 l-9 2 z" fill="#ef8433" />
      <path d="M17 49 q13 6 26 0 l-2 6 q-11 4 -22 0 z" fill="#d63b30" />
      <circle cx="30" cy="66" r="1.8" fill="#2b2133" />
      <circle cx="30" cy="76" r="1.8" fill="#2b2133" />
    </Place>
  );
}

/**
 * A small elf, waving every few seconds (its right arm swings up from the
 * shoulder). `delay` staggers the elves so they take turns.
 */
function Elf({
  x,
  delay,
  tunic = "#2f8a52",
  hat = "#d63b30",
  collar = "#d63b30",
  hop = false,
  mirror = false,
}: {
  x: number;
  delay: number;
  tunic?: string;
  hat?: string;
  collar?: string;
  hop?: boolean;
  mirror?: boolean;
}) {
  const skin = "#f4c8a0";
  return (
    <g data-elf="" className={hop ? "season-hop" : undefined} style={hop ? { animationDelay: `${delay}s` } : undefined}>
      <svg x={x - 24} y={GROUND - 78} width="48" height="86" viewBox="0 0 40 72" overflow="visible">
        <g transform={mirror ? "translate(40 0) scale(-1 1)" : undefined}>
          {/* striped legs and curly shoes */}
          {[14, 21].map((lx) => (
            <g key={lx}>
              <rect x={lx} y="53" width="5" height="13" fill="#ffffff" />
              <path d={`M${lx} 56 h5 M${lx} 60 h5 M${lx} 64 h5`} stroke="#d63b30" strokeWidth="2" />
            </g>
          ))}
          <path d="M19 66 h-8 q-4 0 -5 -4 q3 2 5 0 h8 z" fill={tunic} />
          <path d="M21 66 h8 q4 0 5 -4 q-3 2 -5 0 h-8 z" fill={tunic} />
          {/* tunic with a zigzag hem, belt and collar */}
          <path d="M12 36 h16 l5 19 l-3 -2 l-3 3 l-3 -3 l-3 3 l-3 -3 l-3 3 l-3 -3 l-3 2 z" fill={tunic} />
          <rect x="9.5" y="46" width="21" height="3.6" rx="1" fill="#3b2a1a" />
          <rect x="18" y="45.4" width="4.4" height="4.8" rx="0.6" fill="none" stroke="#f2c14e" strokeWidth="1.2" />
          <path d="M11 35 l3 4 l3 -3.5 l3 3.5 l3 -3.5 l3 3.5 l3 -4 z" fill={collar} />
          {/* the arm that stays down */}
          <path d="M12.5 38 q-5 6 -4.5 12" stroke={tunic} strokeWidth="4.2" strokeLinecap="round" fill="none" />
          <circle cx="8" cy="51" r="2.3" fill={skin} />
          {/* head, ears and face */}
          <path d="M12.5 24 l-7 -6 l5.5 10 z M27.5 24 l7 -6 l-5.5 10 z" fill={skin} />
          <circle cx="20" cy="26" r="8.6" fill={skin} />
          <circle cx="15.4" cy="28.6" r="1.6" fill="#f29a8c" opacity="0.75" />
          <circle cx="24.6" cy="28.6" r="1.6" fill="#f29a8c" opacity="0.75" />
          <circle cx="17" cy="25" r="1.1" fill="#2b2133" />
          <circle cx="23" cy="25" r="1.1" fill="#2b2133" />
          <path d="M17.4 29.4 q2.6 2.6 5.2 0" stroke="#2b2133" strokeWidth="1" fill="none" strokeLinecap="round" />
          {/* floppy hat with a bell */}
          <path d="M11.5 21 C13 12 22 5 34 3 C29 9 28.5 15 28.6 21 Z" fill={hat} />
          <rect x="10" y="19.4" width="20" height="4.2" rx="2.1" fill="#ffffff" />
          <circle cx="34" cy="3.6" r="2.6" fill="#f2c14e" />
          {/* the waving arm */}
          <g className="season-elf-arm" style={{ animationDelay: `${delay}s` }}>
            <path d="M27.5 38 q5 6 4.5 12" stroke={tunic} strokeWidth="4.2" strokeLinecap="round" fill="none" />
            <circle cx="32" cy="51" r="2.3" fill={skin} />
          </g>
        </g>
      </svg>
    </g>
  );
}

// ================================================================ Halloween: pumpkin patch

const STARS = [
  [70, 30], [180, 60], [260, 22], [350, 48], [440, 18], [520, 62], [610, 30], [700, 54], [780, 16], [1040, 40], [1120, 24], [1170, 70],
];

function PumpkinPatch() {
  return (
    <g data-scene="pumpkin-patch">
      {STARS.map(([sx, sy], i) => (
        <circle key={i} cx={sx} cy={sy} r={i % 3 ? 1.4 : 2} fill="#f6e7b4" className="season-twinkle" style={{ animationDelay: `${(i * 0.53) % 3}s` }} />
      ))}
      <circle cx="930" cy="72" r="40" fill="#f6e7b4" />
      <circle cx="916" cy="62" r="7" fill="#eadb9f" />
      <circle cx="944" cy="86" r="5" fill="#eadb9f" />
      <path d={`M0 178 C160 140 300 150 420 168 C560 188 700 138 860 152 C980 162 1100 140 ${W} 156 V${H} H0 Z`} fill="#2a1d3c" />
      {/* a bare tree */}
      <path
        d="M150 206 C152 170 146 140 132 112 M146 160 C130 150 118 150 104 138 M141 132 C150 116 162 108 178 104 M136 122 C126 106 126 94 118 84 M160 108 C168 96 176 92 188 90"
        stroke="#160f20"
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <Fence />
      <Cat x={470} />
      <Ghost />
      {/* tombstones */}
      <path d="M1060 206 v-34 a18 18 0 0 1 36 0 v34 z" fill="#5d5670" />
      <path d="M1106 206 v-24 a13 13 0 0 1 26 0 v24 z" fill="#4c4660" />
      <path d={`M0 ${GROUND - 2} C260 ${GROUND - 10} 600 ${GROUND + 4} 860 ${GROUND - 6} C1000 ${GROUND - 10} 1100 ${GROUND - 2} ${W} ${GROUND - 6} V${H} H0 Z`} fill="#160f20" />
      <PatchLantern x={250} size={62} />
      <PatchLantern x={370} size={46} />
      <PatchLantern x={560} size={78} />
      <PatchLantern x={660} size={52} />
      <PatchLantern x={800} size={66} />
      <PatchLantern x={985} size={44} />
    </g>
  );
}

function PatchLantern({ x, size }: { x: number; size: number }) {
  const reduced = useReducedMotion();
  const { lit, blaze } = useLanternLit(reduced);
  const h = size * (62 / 72);
  return (
    <svg x={x - size / 2} y={GROUND + 6 - h} width={size} height={h} overflow="visible">
      <JackOLantern lit={lit} blaze={blaze} />
    </svg>
  );
}

function Fence() {
  const posts = Array.from({ length: 24 }, (_, i) => 40 + i * 48);
  return (
    <g fill="#2f2342">
      <rect x="20" y="176" width={W - 40} height="5" />
      <rect x="20" y="192" width={W - 40} height="5" />
      {posts.map((px) => (
        <path key={px} d={`M${px} ${GROUND} V170 l5 -7 l5 7 V${GROUND} z`} />
      ))}
    </g>
  );
}

/** A black cat on the fence whose eyes blink now and then. */
function Cat({ x }: { x: number }) {
  return (
    <Place x={x} bottom={178} w={44} h={46} view="0 0 44 46">
      <path d="M8 46 C6 34 10 26 16 22 C12 18 12 10 14 4 L18 10 C20 9 24 9 26 10 L30 4 C32 10 32 18 28 22 C34 26 38 34 36 46 Z" fill="#0f0a16" />
      <path d="M36 44 C44 40 44 30 38 26" stroke="#0f0a16" strokeWidth="4" fill="none" strokeLinecap="round" />
      <g className="season-blink">
        <ellipse cx="18" cy="16" rx="2" ry="2.4" fill="#c6f25c" />
        <ellipse cx="26" cy="16" rx="2" ry="2.4" fill="#c6f25c" />
      </g>
    </Place>
  );
}

function Ghost() {
  return (
    <g className="season-ghost">
      <Place x={720} bottom={140} w={54} h={64} view="0 0 54 64">
        <path d="M6 64 V26 a21 21 0 0 1 42 0 V64 l-7 -6 l-7 6 l-7 -6 l-7 6 l-7 -6 z" fill="#f4f0fa" opacity="0.92" />
        <ellipse cx="20" cy="26" rx="3.2" ry="4.4" fill="#2b2133" />
        <ellipse cx="34" cy="26" rx="3.2" ry="4.4" fill="#2b2133" />
        <ellipse cx="27" cy="38" rx="4" ry="5" fill="#2b2133" />
      </Place>
    </g>
  );
}

// ================================================================ Easter: spring meadow

const TULIPS = [
  [90, "#f58fb0"], [130, "#f2c14e"], [210, "#c77ddb"], [330, "#e8505b"], [380, "#f58fb0"], [470, "#f2c14e"],
  [760, "#c77ddb"], [820, "#f58fb0"], [900, "#e8505b"], [990, "#f2c14e"], [1080, "#c77ddb"], [1140, "#f58fb0"],
] as const;

function SpringMeadow() {
  return (
    <g data-scene="spring-meadow">
      <circle cx="1080" cy="56" r="30" fill="#ffe9a3" />
      <g className="season-drift">
        <Cloud x={220} y={74} />
        <Cloud x={640} y={62} scale={0.8} />
      </g>
      <path d={`M0 172 C180 140 320 150 480 166 C640 182 780 140 960 150 C1060 156 1140 148 ${W} 156 V${H} H0 Z`} fill="#c6e8b4" />
      {TULIPS.map(([tx, color], i) => (
        <Tulip key={i} x={tx} color={color} delay={(i * 0.45) % 2.4} />
      ))}
      <path d={`M0 ${GROUND - 4} C240 ${GROUND - 14} 560 ${GROUND + 2} 820 ${GROUND - 8} C980 ${GROUND - 14} 1100 ${GROUND - 2} ${W} ${GROUND - 8} V${H} H0 Z`} fill="#9fd38a" />
      {(
        [
          [300, "#f6b8c8", "#e0789a"],
          [560, "#a9d4f2", "#5f9fd0"],
          [940, "#fbe29a", "#e3b43c"],
        ] as const
      ).map(([ex, base, band], i) => (
        <svg key={i} x={ex - 13} y={GROUND - 22} width="26" height="32">
          <EasterEgg id={`meadow-${i}`} base={base} band={band} />
        </svg>
      ))}
      <g className="season-run">
        <g className="season-hop-quick">
          <Bunny />
        </g>
      </g>
    </g>
  );
}

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} fill="#ffffff">
      <ellipse cx="0" cy="10" rx="46" ry="16" />
      <circle cx="-16" cy="2" r="18" />
      <circle cx="12" cy="-4" r="22" />
    </g>
  );
}

function Tulip({ x, color, delay }: { x: number; color: string; delay: number }) {
  return (
    <g className="season-sway" style={{ animationDelay: `${delay}s` }}>
      <path d={`M${x} ${GROUND} V${GROUND - 44}`} stroke="#4f9a45" strokeWidth="3" />
      <path d={`M${x} ${GROUND - 8} q-14 -8 -12 -26 q8 12 12 18 z`} fill="#5fae52" />
      <path d={`M${x - 9} ${GROUND - 56} q0 14 9 14 q9 0 9 -14 l-4.5 5 l-4.5 -7 l-4.5 7 z`} fill={color} />
    </g>
  );
}

/** A bunny facing right; the scene moves it across the meadow. */
function Bunny() {
  return (
    <svg x="0" y={GROUND - 46} width="56" height="48" viewBox="0 0 56 48" overflow="visible">
      <ellipse cx="24" cy="32" rx="18" ry="13" fill="#ffffff" stroke="#e6dccf" strokeWidth="1.5" />
      <circle cx="7" cy="30" r="5" fill="#ffffff" stroke="#e6dccf" strokeWidth="1.5" />
      <circle cx="40" cy="20" r="10" fill="#ffffff" stroke="#e6dccf" strokeWidth="1.5" />
      <path d="M35 12 C32 0 34 -6 38 -4 C41 -2 40 6 38 12 Z M41 11 C42 -1 46 -5 49 -2 C51 1 47 7 44 12 Z" fill="#ffffff" stroke="#e6dccf" strokeWidth="1.5" />
      <path d="M36.5 9 C35 2 36 -2 37.6 -1.4 M43 9 C44.5 2 46.5 -1 47.6 0" stroke="#f6b8c8" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="44" cy="19" r="1.5" fill="#2b2133" />
      <circle cx="49.5" cy="22" r="1.4" fill="#f29a8c" />
      <ellipse cx="34" cy="44" rx="7" ry="3" fill="#ffffff" stroke="#e6dccf" strokeWidth="1.5" />
    </svg>
  );
}
