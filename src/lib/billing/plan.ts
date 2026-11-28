import { DEFAULT_AI_MONTHLY_CALLS } from "./ai-allowance";

/**
 * The two ways to use canvas, and what each one includes. Safe to import
 * anywhere: the landing and pricing pages list these, and the editor asks
 * `canUse` before opening something that's part of the membership.
 *
 *   free     no account needed; drawings are saved in this browser only
 *   member   $5 a month; drawings are kept on the server, plus the tools below
 *
 * The price in Stripe has to match: `npm run stripe:setup` creates it from
 * MEMBERSHIP. To change the price, change it here, run the setup again and
 * put the new STRIPE_PRICE_ID in your environment.
 */
export const MEMBERSHIP = {
  productName: "canvas membership",
  /** In the currency's smallest unit: 500 cents. */
  unitAmount: 500,
  currency: "usd",
  interval: "month",
  /** Lets the setup script find the price again instead of making another. */
  lookupKey: "canvas_membership_monthly",
  /** How the price reads on the site. */
  price: "$5",
  per: "a month",
} as const;

/** About what a membership costs a day, in cents (a month taken as 30 days). */
export const CENTS_A_DAY = Math.round(MEMBERSHIP.unitAmount / 30);

export type Plan = "free" | "member";

/** What only members can do. Everything else on the canvas is free. */
export type MemberFeature =
  | "math-check"
  | "math-tools"
  | "worksheets"
  | "chemistry"
  | "flashcards"
  | "sharing"
  | "workspaces"
  | "server-storage";

/**
 * How each member feature is offered to someone on the free plan: the
 * upgrade prompt's title and the line under it.
 */
export const MEMBER_FEATURES: Record<MemberFeature, { title: string; text: string }> = {
  "math-check": {
    title: "Checking math is part of the membership",
    text: "Loop around an equation, handwritten or a screenshot, and the AI checks each step and shows where it goes wrong.",
  },
  "math-tools": {
    title: "The geometry, trig and proof tools are part of the membership",
    text: "Solve any triangle with the working shown, find exact trig values on the unit circle, and build two-column proofs the AI checks line by line.",
  },
  worksheets: {
    title: "Worksheets are part of the membership",
    text: "Turn the equations on a drawing, or a topic you pick, into a printable worksheet with an answer key.",
  },
  chemistry: {
    title: "The chemistry tools are part of the membership",
    text: "Molar masses, an equation balancer, stoichiometry with limiting reagents, gas laws, molarity, dilution, pH and the periodic table.",
  },
  flashcards: {
    title: "Flashcards are part of the membership",
    text: "Turn any part of a drawing into a flashcard and review it with spaced repetition.",
  },
  sharing: {
    title: "Drawing together is part of the membership",
    text: "Share a drawing by link and draw on it with classmates live, with everyone's cursors and pictures on the canvas.",
  },
  workspaces: {
    title: "Team workspaces are part of the membership",
    text: "Invite a class or a study group once, and everyone in it can open its drawings.",
  },
  "server-storage": {
    title: "Keeping drawings in your account is part of the membership",
    text: "Members' drawings are saved on our server, so they're on every device you sign in on and safe if this browser's data is cleared.",
  },
};

/** Whether someone on `plan` can use `feature` (only members can, today). */
export function canUse(plan: Plan, feature: MemberFeature): boolean {
  return plan === "member" && feature in MEMBER_FEATURES;
}

/** The free plan, for the landing and pricing pages. */
export const FREE_INCLUDES = [
  "Every drawing tool: pens, shapes, text, images, GIFs and videos",
  "Equations, graphs, to-do boards and tracing pictures",
  "Frames and slides, presented full screen",
  "Saved in this browser, no account needed",
] as const;

/** What the membership adds on top of the free plan. */
export const MEMBERSHIP_INCLUDES = [
  "Drawings kept in your account, on every device",
  `Step-by-step math checks, proof checks and AI worksheets: ${DEFAULT_AI_MONTHLY_CALLS} a month`,
  "Geometry, trig and proof tools, and worksheets with answer keys",
  "Chemistry tools and flashcards",
  "Drawing live with others, and team workspaces",
  "Cancel any time",
] as const;
