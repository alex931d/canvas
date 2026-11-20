/** Seasonal artwork as plain SVG. Decorative only: every piece is aria-hidden. */

type ArtProps = { className?: string; style?: React.CSSProperties };

/** A candy cane: the same hook drawn three times (dark edge, white, red stripes). */
export function CandyCane({ className, style }: ArtProps) {
  const d = "M14 94 V30 a13 13 0 0 1 26 0 v7";
  return (
    <svg aria-hidden viewBox="0 0 54 100" className={className} style={style} fill="none" strokeLinecap="round">
      <path d={d} stroke="#9e2a22" strokeWidth="12" />
      <path d={d} stroke="#ffffff" strokeWidth="9" />
      <path d={d} stroke="#d63b30" strokeWidth="9" strokeDasharray="5 6" />
      <path d="M11 92 V31" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2" />
    </svg>
  );
}

/** Two candy canes crossed, tied with a green bow. */
export function CandyCanePair({ className, style }: ArtProps) {
  return (
    <svg aria-hidden viewBox="0 0 80 100" className={className} style={style} fill="none">
      <g transform="rotate(-16 40 60)">
        <CaneShape x={18} />
      </g>
      <g transform="translate(80 0) scale(-1 1) rotate(-16 40 60)">
        <CaneShape x={18} />
      </g>
      <path d="M40 62 C30 52 22 56 26 64 C30 70 37 66 40 62 Z" fill="#2f8a52" />
      <path d="M40 62 C50 52 58 56 54 64 C50 70 43 66 40 62 Z" fill="#2f8a52" />
      <path d="M38 63 L33 78 M42 63 L47 78" stroke="#2f8a52" strokeWidth="3" strokeLinecap="round" />
      <circle cx="40" cy="62" r="4" fill="#24703f" />
    </svg>
  );
}

function CaneShape({ x }: { x: number }) {
  const d = `M${x} 96 V30 a12 12 0 0 1 24 0 v6`;
  return (
    <g strokeLinecap="round">
      <path d={d} stroke="#9e2a22" strokeWidth="11" />
      <path d={d} stroke="#ffffff" strokeWidth="8" />
      <path d={d} stroke="#d63b30" strokeWidth="8" strokeDasharray="4.5 5.5" />
    </g>
  );
}

/** A carved pumpkin with a warm glow in the face. */
export function JackOLantern({ className, style }: ArtProps) {
  return (
    <svg aria-hidden viewBox="0 0 72 62" className={className} style={style}>
      <path d="M36 10 C37 4 40 2 44 1" stroke="#4d6b2e" strokeWidth="4" strokeLinecap="round" fill="none" />
      <ellipse cx="22" cy="36" rx="17" ry="22" fill="#d9661f" />
      <ellipse cx="50" cy="36" rx="17" ry="22" fill="#d9661f" />
      <ellipse cx="36" cy="36" rx="17" ry="24" fill="#ef8433" />
      <path d="M24 30 L30 22 L33 31 Z M48 30 L42 22 L39 31 Z" fill="#ffd45c" />
      <path d="M20 40 Q36 54 52 40 L47 43 L44 39 L40 44 L36 40 L32 44 L28 39 L25 43 Z" fill="#ffd45c" />
    </svg>
  );
}

/** A bat with its wings out. */
export function Bat({ className, style }: ArtProps) {
  return (
    <svg aria-hidden viewBox="0 0 64 30" className={className} style={style}>
      <path
        fill="#2b2133"
        d="M32 9 C30 5 28 5 27 8 C22 3 13 2 4 6 C9 8 10 13 9 17 C13 14 17 15 19 19 C22 15 26 15 28 18 L32 23 L36 18 C38 15 42 15 45 19 C47 15 51 14 55 17 C54 13 55 8 60 6 C51 2 42 3 37 8 C36 5 34 5 32 9 Z M29 8 L28 3 L31 7 Z M35 8 L36 3 L33 7 Z"
      />
    </svg>
  );
}

/** A small spider on its thread (the thread is drawn by whoever hangs it). */
export function Spider({ className, style }: ArtProps) {
  return (
    <svg aria-hidden viewBox="0 0 40 34" className={className} style={style} fill="none" stroke="#2b2133" strokeWidth="2" strokeLinecap="round">
      <path d="M14 14 L4 6 M14 17 L2 16 M14 20 L4 28 M16 22 L10 32 M26 14 L36 6 M26 17 L38 16 M26 20 L36 28 M24 22 L30 32" />
      <ellipse cx="20" cy="18" rx="8" ry="9" fill="#2b2133" />
      <circle cx="20" cy="8" r="5" fill="#2b2133" />
      <circle cx="18" cy="7" r="1.2" fill="#ffffff" stroke="none" />
      <circle cx="22" cy="7" r="1.2" fill="#ffffff" stroke="none" />
    </svg>
  );
}

const EGG = "M20 2 C31 2 38 22 38 32 C38 43 30 48 20 48 C10 48 2 43 2 32 C2 22 9 2 20 2 Z";

/** A painted egg: base colour, a zigzag band and dots. */
export function EasterEgg({
  className,
  style,
  base,
  band,
  id,
}: ArtProps & { base: string; band: string; id: string }) {
  return (
    <svg aria-hidden viewBox="0 0 40 50" className={className} style={style}>
      <defs>
        <clipPath id={`egg-${id}`}>
          <path d={EGG} />
        </clipPath>
      </defs>
      <path d={EGG} fill={base} />
      <g clipPath={`url(#egg-${id})`}>
        <path d="M0 24 L5 19 L10 24 L15 19 L20 24 L25 19 L30 24 L35 19 L40 24 V30 L35 25 L30 30 L25 25 L20 30 L15 25 L10 30 L5 25 L0 30 Z" fill={band} />
        <circle cx="12" cy="12" r="2" fill="#ffffff" opacity="0.85" />
        <circle cx="26" cy="9" r="1.6" fill="#ffffff" opacity="0.85" />
        <circle cx="10" cy="38" r="2" fill={band} />
        <circle cx="21" cy="41" r="2" fill={band} />
        <circle cx="31" cy="37" r="2" fill={band} />
        <path d="M8 6 C12 3 15 3 17 4" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Three eggs in a woven nest. */
export function EggNest({ className, style }: ArtProps) {
  return (
    <div aria-hidden className={className} style={style}>
      <div className="relative h-full w-full">
        <EasterEgg id="nest-a" base="#f6b8c8" band="#e0789a" className="absolute bottom-[26%] left-[8%] h-[62%] -rotate-12" />
        <EasterEgg id="nest-b" base="#fbe29a" band="#e3b43c" className="absolute bottom-[30%] left-[34%] h-[70%]" />
        <EasterEgg id="nest-c" base="#a9d4f2" band="#5f9fd0" className="absolute bottom-[26%] left-[60%] h-[62%] rotate-12" />
        <svg viewBox="0 0 120 50" className="absolute bottom-0 left-0 h-[48%] w-full" preserveAspectRatio="none">
          <path d="M4 10 C20 52 100 52 116 10 Z" fill="#a97c50" />
          <path
            d="M6 12 C30 22 90 22 114 12 M10 22 C34 32 86 32 110 22 M18 32 C40 40 80 40 102 32 M14 14 C30 30 50 38 64 40 M106 14 C90 30 70 38 56 40"
            stroke="#7a5534"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
