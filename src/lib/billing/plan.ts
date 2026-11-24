/**
 * The membership: one plan, billed monthly. Safe to import anywhere (the
 * landing page shows the price from here).
 *
 * The price in Stripe has to match: `npm run stripe:setup` creates it from
 * these values. To change the price, change it here, run the setup again and
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

/** What a membership includes, for the landing and membership pages. */
export const MEMBERSHIP_INCLUDES = [
  "Unlimited drawings on an infinite canvas",
  "Step-by-step math checks, equations and graphs",
  "Chemistry tools, flashcards and to-do boards",
  "Live drawing with other members",
  "Study buddies that keep your streak",
  "Cancel any time",
] as const;
