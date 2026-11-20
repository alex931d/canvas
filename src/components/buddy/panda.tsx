import type { Coat } from "@/lib/buddy/kinds";
import { RARITY } from "@/lib/buddy/kinds";
import type { Accessory } from "@/lib/buddy/shared";
import { cn } from "@/lib/utils";

/**
 * A small panda, drawn in SVG and animated with CSS (see .buddy-* in
 * globals.css). `pose` picks the animation; `coat` its colours (rarer pandas
 * have rarer coats, src/lib/buddy/kinds.ts); accessories are unlocked by
 * levels. `view="back"` draws it from behind, for your side of a battle.
 */

export type Pose =
  | "idle"
  | "walk"
  | "run"
  | "roll"
  | "drag"
  | "cheer"
  | "nod"
  | "wave"
  | "sleep"
  | "happy"
  | "snack"
  | "dance"
  | "twinkle";

const EYE = "#2b2a30";

export function Panda({
  pose = "idle",
  color = "#277c78",
  accessories = [],
  coat = RARITY.common.coat,
  view = "front",
  className,
}: {
  pose?: Pose;
  /** Scarf colour. */
  color?: string;
  accessories?: readonly Accessory[];
  coat?: Coat;
  view?: "front" | "back";
  className?: string;
}) {
  const closedEyes = pose === "sleep" || pose === "happy" || pose === "cheer" || pose === "dance" || pose === "twinkle";
  const openMouth = pose === "cheer" || pose === "drag" || pose === "run";
  const back = view === "back";
  const { fur, belly, patch, line } = coat;
  return (
    <svg viewBox="0 0 100 112" className={cn("buddy-svg", className)} data-pose={pose} data-view={view} aria-hidden>
      {coat.glow ? <ellipse className="buddy-glow" cx="50" cy="62" rx="46" ry="46" fill={coat.glow} /> : null}
      <ellipse className="buddy-shadow" cx="50" cy="106" rx="24" ry="4" fill={EYE} opacity="0.16" />
      {/* puffs of dust and speed lines behind a sprint */}
      <g className="buddy-dust" fill="#d8cfc4">
        <circle cx="20" cy="101" r="5" />
        <circle cx="10" cy="97" r="3.6" />
        <circle cx="4" cy="103" r="2.6" />
      </g>
      <g className="buddy-speed" stroke={line} strokeWidth="2" strokeLinecap="round" opacity="0.35">
        <path d="M-6 62 h14" />
        <path d="M-12 74 h18" />
        <path d="M-4 86 h12" />
      </g>
      <g className="buddy-body">
        {/* legs */}
        <ellipse className="buddy-leg buddy-leg-l" cx="37" cy="96" rx="9.5" ry="7.5" fill={patch} />
        <ellipse className="buddy-leg buddy-leg-r" cx="63" cy="96" rx="9.5" ry="7.5" fill={patch} />
        {/* body */}
        <ellipse cx="50" cy="78" rx="25" ry="21" fill={fur} stroke={line} strokeWidth="2.2" />
        {back ? (
          <circle cx="50" cy="94" r="5" fill={patch} />
        ) : (
          <ellipse cx="50" cy="82" rx="14" ry="11" fill={belly} />
        )}
        {/* arms: rotate at the shoulder */}
        <ellipse className="buddy-arm buddy-arm-l" cx="28" cy="77" rx="7" ry="11.5" fill={patch} />
        <ellipse className="buddy-arm buddy-arm-r" cx="72" cy="77" rx="7" ry="11.5" fill={patch} />
        {/* a bamboo snack, held up to the mouth */}
        <g className="buddy-bamboo">
          <rect x="62" y="38" width="6" height="34" rx="2.5" fill="#7fae5a" stroke="#3f6b2c" strokeWidth="1.2" />
          <path d="M62 50 h6 M62 61 h6" stroke="#3f6b2c" strokeWidth="1.2" />
          <path d="M68 42 q9 -6 13 -2 q-7 3 -13 6 Z" fill="#9cc56f" stroke="#3f6b2c" strokeWidth="1" />
        </g>
        {accessories.includes("scarf") ? (
          <g className="buddy-scarf">
            <path d="M30 60 Q50 70 70 60 L71 66 Q50 76 29 66 Z" fill={color} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
            {back ? null : (
              <path d="M60 67 L66 84 L58 85 L55 69 Z" fill={color} stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
            )}
          </g>
        ) : null}

        <g className="buddy-head">
          <circle cx="27" cy="18" r="10" fill={patch} />
          <circle cx="73" cy="18" r="10" fill={patch} />
          <ellipse cx="50" cy="40" rx="31" ry="27.5" fill={fur} stroke={line} strokeWidth="2.2" />
          {back ? null : (
            <>
              {/* eye patches */}
              <ellipse cx="37" cy="42" rx="8.5" ry="10.5" fill={patch} transform="rotate(-28 37 42)" />
              <ellipse cx="63" cy="42" rx="8.5" ry="10.5" fill={patch} transform="rotate(28 63 42)" />
              {closedEyes ? (
                <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                  {pose === "sleep" ? (
                    <>
                      <path d="M34 43 q4 2.6 8 0" />
                      <path d="M58 43 q4 2.6 8 0" />
                    </>
                  ) : (
                    <>
                      <path d="M34 43 q4 -4 8 0" />
                      <path d="M58 43 q4 -4 8 0" />
                    </>
                  )}
                </g>
              ) : (
                <g className="buddy-eyes">
                  <circle cx="38.5" cy="41.5" r="4" fill="#fff" />
                  <circle cx="61.5" cy="41.5" r="4" fill="#fff" />
                  <circle className="buddy-pupil" cx="39" cy="42" r="2.4" fill={EYE} />
                  <circle className="buddy-pupil" cx="61" cy="42" r="2.4" fill={EYE} />
                  <circle cx="39.8" cy="40.9" r="0.9" fill="#fff" />
                  <circle cx="61.8" cy="40.9" r="0.9" fill="#fff" />
                </g>
              )}
              {accessories.includes("glasses") ? (
                <g fill="none" stroke="#b07a2a" strokeWidth="1.8">
                  <circle cx="38.5" cy="42" r="8.6" />
                  <circle cx="61.5" cy="42" r="8.6" />
                  <path d="M47 41 q3 -2 6 0" />
                </g>
              ) : null}
              {/* nose and mouth */}
              <path d="M46.5 50.5 q3.5 -2.4 7 0 q-1.2 3.2 -3.5 3.4 q-2.3 -0.2 -3.5 -3.4 Z" fill={EYE} />
              {openMouth || pose === "snack" ? (
                <ellipse cx="50" cy="58.5" rx="3.2" ry="2.8" fill="#e98f8a" stroke={line} strokeWidth="1.4" />
              ) : (
                <path d="M45.5 56 q2.25 2.4 4.5 0 q2.25 2.4 4.5 0" fill="none" stroke={EYE} strokeWidth="1.5" strokeLinecap="round" />
              )}
              <ellipse cx="28.5" cy="52" rx="4.6" ry="2.6" fill="#f2a29d" opacity="0.75" />
              <ellipse cx="71.5" cy="52" rx="4.6" ry="2.6" fill="#f2a29d" opacity="0.75" />
            </>
          )}
          {coat.mark === "crescent" ? (
            <path className="buddy-mark" d="M47 20 a6 6 0 1 0 7 7 a5 5 0 1 1 -7 -7 Z" fill="#cab361" />
          ) : coat.mark === "star" ? (
            <path
              className="buddy-mark"
              d="M50 15 l2.2 4.6 5 .6 -3.7 3.4 1 5 -4.5 -2.5 -4.5 2.5 1 -5 -3.7 -3.4 5 -.6 Z"
              fill="#fff3c4"
              stroke={line}
              strokeWidth="1"
              strokeLinejoin="round"
            />
          ) : null}
          {accessories.includes("cap") ? (
            <g>
              <path d="M33 16 Q50 10 67 16 L66 21 Q50 16 34 21 Z" fill={EYE} />
              <path d="M22 13 L50 3 L78 13 L50 23 Z" fill={EYE} stroke="#4a4950" strokeWidth="1" strokeLinejoin="round" />
              <path className="buddy-tassel" d="M50 13 L74 15 L75 26" fill="none" stroke="#cab361" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="75" cy="27" r="2" fill="#cab361" />
            </g>
          ) : null}
        </g>
      </g>
      {/* sparkles while cheering (and around a golden coat), z's while asleep */}
      <g className="buddy-sparkles" fill={coat.glow ? "#e2ad37" : "#cab361"}>
        <path d="M12 30 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z" />
        <path d="M86 22 l1.5 -4.5 l1.5 4.5 l4.5 1.5 l-4.5 1.5 l-1.5 4.5 l-1.5 -4.5 l-4.5 -1.5 Z" />
        <path d="M90 56 l1.2 -3.6 l1.2 3.6 l3.6 1.2 l-3.6 1.2 l-1.2 3.6 l-1.2 -3.6 l-3.6 -1.2 Z" />
      </g>
      <g className="buddy-zzz" fill={EYE} fontFamily="ui-sans-serif, system-ui, sans-serif" fontWeight="700">
        <text x="76" y="20" fontSize="11">
          z
        </text>
        <text x="84" y="10" fontSize="8">
          z
        </text>
      </g>
    </svg>
  );
}
