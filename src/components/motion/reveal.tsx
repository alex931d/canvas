"use client";

import { motion, type Variants } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Slides content a little way in as it scrolls into view and back out as it
 * leaves, from whichever edge it crosses. Kept small on purpose: 16 px and a
 * fade. Nothing is hidden in the HTML, so the page reads fine before (or
 * without) JavaScript, and what's already on screen when the page loads
 * simply stays put. With reduced motion only the fade remains (MotionProvider).
 */

const DISTANCE = 16;

const variants: Variants = {
  shown: (delay: number) => ({ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay } }),
  below: { opacity: 0, y: DISTANCE, transition: { duration: 0.3, ease: "easeIn" } },
  above: { opacity: 0, y: -DISTANCE, transition: { duration: 0.3, ease: "easeIn" } },
};

const TAGS = {
  div: motion.div,
  li: motion.li,
  section: motion.section,
  figure: motion.figure,
} as const;

type Side = "shown" | "below" | "above";

export function Reveal({
  as = "div",
  delay = 0,
  className,
  children,
  ...aria
}: {
  as?: keyof typeof TAGS;
  /** Seconds to wait before coming in (to stagger a row of items). */
  delay?: number;
  className?: string;
  children: ReactNode;
  /** For links to this part of the page (#id). */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [side, setSide] = useState<Side>("shown");
  const Tag = TAGS[as] as typeof motion.div;

  // Below the fold when the page loads: tuck it away (off screen, so nobody sees it go).
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r && r.top > window.innerHeight) setSide("below");
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      className={className}
      variants={variants}
      initial={false}
      animate={side}
      custom={delay}
      viewport={{ amount: 0.15 }}
      onViewportEnter={() => setSide("shown")}
      onViewportLeave={(entry) => setSide(entry && entry.boundingClientRect.top < 0 ? "above" : "below")}
      {...aria}
    >
      {children}
    </Tag>
  );
}
