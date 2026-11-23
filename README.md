# canvas

An infinite canvas for notes, math and chemistry, built with **Next.js 16**, **TypeScript**, **Drizzle
ORM**, **PostgreSQL**, **Tailwind CSS**, **[Motion](https://motion.dev)** (formerly Framer Motion) for
animation, and its own component kit (with Radix underneath for menus and dialogs).

- **Infinite canvas** with pan (Pan tool, Space+drag, trackpad, two fingers) and zoom (Ctrl/⌘+scroll,
  pinch, + / − buttons, zoom to fit).
- **Drawing**: pressure-sensitive ink ([perfect-freehand](https://github.com/steveruizok/perfect-freehand)),
  marker and highlighter brushes; lines, arrows, rectangles and ellipses with an optional hand-drawn
  "sketchy" style ([rough.js](https://roughjs.com)); text in handwriting, sans or mono; whole-stroke and
  pixel erasers.
- **Screenshots, GIFs and videos**: paste (Ctrl/⌘+V), drag and drop, or use the **Image or video**
  button. Large images are scaled down; GIFs keep animating; MP4, WebM and QuickTime clips up to 50 MB
  play right on the canvas (see [To-do boards, GIFs and videos](#to-do-boards-gifs-and-videos)).
- **Study buddies**: small animated pandas that float over the app, follow your progress (cards
  answered, to-do cards done, your streak and level) and cheer you on. Each has a trick (a sprint across
  the screen, a roll, a nap, a dance…), they can climb onto the canvas and walk about on your drawings
  (panning and zooming with them) if you let them, and from your first day (level 1) wild pandas
  (common, uncommon, rare and super rare) wander onto drawings to battle and catch for good (see
  [Study buddies](#study-buddies)). Your study level is kept on your account (`users.level`).
- **To-do boards**: To do, Doing and Done columns of cards on the canvas, next to your notes. Drag cards
  between columns and between boards.
- **Select, move, resize, duplicate, delete**, copy and paste, undo and redo.
- **AI math check**: press **Check math**, draw a loop around an equation (handwritten or a
  screenshot), and a vision model transcribes it, checks each step, and shows where it goes
  wrong. **Add note to canvas** writes the verdict next to your work.
- **Equations and graphs**: type LaTeX (or chemistry in mhchem notation, `2H2 + O2 -> 2H2O`) and it's
  typeset onto the canvas with [MathJax 4](https://www.mathjax.org); plot up to six functions of x on a
  graph you can resize and re-window (see [Equations, graphs and chemistry](#equations-graphs-and-chemistry)).
- **Chemistry tools**: molar mass with a grams-to-moles converter, an equation balancer that handles ions
  and half equations, and a periodic table with IUPAC standard atomic weights.
- **Live collaboration**: share a drawing by link with other members; everyone sees each other's
  changes and cursors as they happen, edits made offline merge when they reconnect, and undo is per
  person (see [Live collaboration](#live-collaboration)).
- **Flashcards**: select part of a drawing and make it a flashcard; review due cards on `/study` with
  spaced repetition (see [Flashcards and study](#flashcards-and-study)).
- **Local-first saving**: every change is kept in the browser until the server has it, and reaches
  Postgres (and everyone else on the drawing) moments later, with fallbacks for when browser storage
  is full (see below).
- **Accounts**: email and password sign-up and login with database sessions, built the way the
  [Lucia](https://lucia-auth.com) guide describes, with email confirmation codes, password reset links
  and a [Cloudflare Turnstile](https://www.cloudflare.com/application-services/products/turnstile/)
  CAPTCHA on sign-up, login and reset (see below). Each person sees only their own drawings and the
  ones shared with them.
- **Landing page** at `/` for visitors who aren't logged in, opening with an animated math check
  (see below). Logged-in people get their drawings at `/` instead.
- **Memberships**: using canvas takes a $1/month membership. The pricing page (`/pricing`, linked
  from the landing page) is where people buy it, and where anyone signed in without one is sent to
  start or renew it; Stripe Checkout takes the payment and Stripe's billing portal manages it (see
  below).
- **Seasonal themes**: falling snow and candy canes at Christmas, bats, a spider and jack-o'-lanterns
  at Halloween, painted eggs and spring petals at Easter, on the landing and pricing pages and in the
  app's menu. They follow the calendar, or admins pick one (see below).
- **Settings** (`/settings`, from the account menu): your name, a profile picture, and how drawings
  and to-do boards animate: things on a canvas can **fade**, **pop** or **trace** themselves in, and
  to-do cards glide between columns and get crossed out as you watch, each with a live example (see
  [Settings, profile pictures and effects](#settings-profile-pictures-and-effects)).
- **Scroll animations**: sections of the landing page, pricing questions, drawing cards in the gallery
  and the settings sections slide a little way in as they scroll into view, and back out as they leave.
- **Roles and an admin dashboard**: accounts are users, support or admins. Staff get `/admin`, a
  searchable, paged table of accounts (with the search, filters, page and open account all in the
  address) where they edit names, emails, roles, email confirmation and complimentary memberships, sign
  people out and send reset links, with a history of every change (see below).

## Quick start

```bash
docker compose up -d --wait       # Postgres 17 on localhost:5432; returns once it's ready
cp .env.example .env.local        # database URL + AI settings
npm install
npm run db:migrate                # users, sessions, drawings, assets, subscriptions, sharing, flashcards, buddies, email codes, roles, settings
npm run dev                       # http://localhost:3000, then create an account
npm run membership -- grant you@example.com   # free membership for your own account
npm run role -- set you@example.com admin     # and the admin dashboard at /admin
```

Signing up asks for a code sent to your email. Until you set up an email server (`SMTP_URL`, see
[Accounts and sessions](#accounts-and-sessions)), emails are printed in the terminal running
`npm run dev`: copy the code from there.

The first account you create takes ownership of any drawings made before accounts existed. New
accounts need a membership before they can draw: grant yourself one as above (after entering the
code), or set up Stripe (see [Memberships](#memberships)) and pay with a test card.
You need Node.js 20.9 or newer. Without Docker, point `DATABASE_URL` in `.env.local` at any PostgreSQL
database you've created.

A hosted database such as Supabase works too. In your Supabase project, click **Connect**, choose
**Session pooler** and paste that string, unchanged, as `DATABASE_URL`:

```
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use the session pooler (port 5432) for `npm run db:migrate`. The transaction pooler (port 6543) doesn't
keep a session, and the direct address (`db.<project-ref>.supabase.co`) only works on networks with IPv6.
Keep the password in `.env.local` only, and if it ever ends up somewhere public, reset it under
Project Settings → Database.

### Troubleshooting

`npm run db:migrate` prints what went wrong when it can't reach the database:

| Message | What to do |
| --- | --- |
| `ECONNREFUSED` | PostgreSQL isn't running. `docker compose up -d --wait`, then check `docker compose ps` says **healthy** |
| `the database system is starting up` | Wait a few seconds and run it again (the first start takes longest) |
| `Connection terminated unexpectedly` or `isn't a valid connection string` with a hosted database | The address in `DATABASE_URL` is wrong or isn't one for outside connections. For Supabase, copy **Connect → Session pooler** exactly (port 5432); a password with `@ # / ?` must be URL-encoded |
| `database "canvas" does not exist`, or a password or role error | You're reaching a different PostgreSQL, usually one installed on the computer itself, which also stops Docker's from using port 5432. Stop it (`sudo systemctl stop postgresql` on Linux), or use it by creating the database and putting its user and password in `.env.local` |

If `docker compose` itself fails on Linux:

| Message | Fix |
| --- | --- |
| `Cannot connect to the Docker daemon` | `sudo systemctl enable --now docker` |
| `permission denied … docker.sock` | `sudo usermod -aG docker $USER`, then log out and back in (or use `sudo docker compose …`) |
| `'compose' is not a docker command` | Install Docker's Compose plugin (on Arch: `sudo pacman -S docker-compose`) |
| `address already in use` / `port is already allocated` | Something else uses port 5432: stop it, or change `"5432:5432"` to `"5433:5432"` in `docker-compose.yml` and the port in `DATABASE_URL` |

### Turn on the math checker (free)

1. Create a free Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey) (no card needed).
2. Put it in `.env.local` as `AI_API_KEY=...` and restart the dev server.

The checker uses the OpenAI-compatible chat API, so you can switch providers in `.env.local`
(examples are in `.env.example`):

| Provider | Cost | Notes |
| --- | --- | --- |
| Google Gemini (default, `gemini-3.8-flash`) | Free tier | On the free tier, Google may use what you send to improve its products. Rate limits apply per project. |
| Groq | Free plan | Fast; pick a vision model from Groq's docs. |
| Ollama | Free, runs locally | Private; needs a machine that can run a vision model (e.g. `qwen3-vl:8b`). No key. |

Without a key, everything else works and **Check math** explains how to set it up.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run db:generate` | Write a new SQL migration after you change `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations in `drizzle/` (`scripts/migrate.mjs`; explains connection problems, unlike `drizzle-kit migrate`, which exits silently) |
| `npm run db:push` | Push the schema straight to the database (prototyping) |
| `npm run db:studio` | Browse the data in Drizzle Studio |
| `npm run stripe:setup` | Create the membership's product and $1/month price in Stripe and print `STRIPE_PRICE_ID` |
| `npm run membership -- grant\|revoke\|show <email>` | Complimentary memberships (no Stripe involved) |
| `npm run role -- set <email> <role>\|show <email>\|list` | Roles: make the first admin (see [Roles](#roles-and-the-admin-dashboard)) |
| `npm run typecheck` | Generate route types and run `tsc` |
| `npm run test:e2e` | Browser tests (see below) |
| `npm run test:unit` | Quick checks of the chemistry, graph, collaboration and calendar logic, no browser needed |

## Accounts and sessions

The Lucia library itself is deprecated; its maintainers now publish it as a guide to writing session
auth yourself. This app follows that guide, with no auth library: about 400 lines in `src/lib/auth/`.

**What's stored in Postgres**

| Table | Columns | Notes |
| --- | --- | --- |
| `users` | `id`, `name`, `email`, `password_hash`, `email_verified`, `role`, `level`, `created_at` | Unique index on `lower(email)`. `password_hash` is Argon2id (`m=19456, t=2, p=1`). `role` is `user`, `support` or `admin`. `level` is the study level (at least 1; see [Study buddies](#study-buddies)) |
| `sessions` | `id`, `secret_hash`, `user_id`, `created_at`, `last_verified_at` | `secret_hash` is SHA-256 of the secret (32 bytes). Deleted with the user |
| `email_verification_codes` | `user_id`, `email`, `code_hash`, `attempts`, `sent_at`, `expires_at` | One per account; `code_hash` is SHA-256 of the 8-digit code |
| `password_reset_tokens` | `token_hash`, `user_id`, `email`, `created_at`, `expires_at` | `token_hash` is SHA-256 of the link's token |
| `drawings` | + `user_id` | Owner; every query filters by it. Deleted with the user |

**How a session works**

- On sign-up or login the server makes a token `<id>.<secret>`: two random 24-character strings
  (120 bits each). The id and a SHA-256 hash of the secret go in `sessions`; the token goes in the
  `session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`). A stolen copy of
  the database can't be turned back into working cookies.
- Each request looks the session up by id and compares the hash in constant time
  (`src/lib/auth/session.ts`, cached per request with React `cache()`).
- Sessions end after **30 days without use** (old Lucia v3's default lifetime; the current guide's
  sample uses 10 days, set in `src/lib/auth/constants.ts`). Activity moves `last_verified_at` forward, at most once
  an hour, and `src/proxy.ts` refreshes the cookie on page views so it doesn't expire first.
- **Sign out** deletes the session row and the cookie. It also clears this person's synced drawings
  from the browser; anything not yet synced is kept and syncs after the next login.

**Confirming the email** (`src/lib/auth/email-verification.ts`)

- Sign-up emails an 8-digit code and sends the new account to `/verify-email`; until the code is
  entered, every other page leads back there and the API answers 402. Accounts created before this
  existed count as confirmed.
- Codes come from a cryptographic random generator, are stored as SHA-256, and work for 15 minutes
  and 5 wrong tries. **Send a new code** works once a minute (5 times, then once per 10 minutes).
- The email's link (`/verify-email?code=…`) only fills the code in; pressing **Confirm email** is what
  uses it, so mail systems that open links to scan them can't spend it. Opened while signed out, it
  goes through the login page and comes back with the code filled in.
- Logging in to an unconfirmed account sends a fresh code if the last one no longer works.
  **Sign out** on the page is there for anyone who signed up with the wrong address.

**Resetting a password** (`src/lib/auth/password-reset.ts`)

- **Forgot password?** on the login page goes to `/forgot-password`. It shows the same message whether
  or not an account uses the address, and the lookup and email happen after the response is sent,
  so the answer and its timing give nothing away.
- The link `/reset-password/<token>` carries 32 random bytes; only their SHA-256 is stored. It works
  once, for an hour, and the page asks browsers not to send its address on as a Referer.
- Saving the new password signs the account out everywhere, signs this browser in, emails a "password
  changed" notice, and counts the email as confirmed. That last part also rescues an address someone
  else signed up with: its owner resets the password and takes the account over.
- At most 3 reset emails go to one address in a row (then one per 20 minutes), so the form can't be
  used to flood someone's inbox.

**CAPTCHA** (`src/lib/auth/captcha.ts`)

The sign-up, login and forgot-password forms run a [Cloudflare
Turnstile](https://developers.cloudflare.com/turnstile/) check (free). Most people never see it: it
works in the background and only shows a box if Cloudflare wants a click. Each Server Action sends the
form's one-time token to Cloudflare's `siteverify` before doing anything else, and only a token made
on that same form counts. Pressing the button before the check has finished waits for it, then sends.

To turn it on, create a widget in the Cloudflare dashboard ([Cloudflare's
steps](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/): Turnstile →
Add widget, widget mode **Managed**, your domain and `localhost` under hostnames) and put its keys in
`.env.local` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Without them the forms work with no
CAPTCHA (production logs a warning). The keys are read on each request, so no rebuild is needed.

**Email** (`src/lib/email/`)

Any provider with SMTP works (Resend, Postmark, Brevo, Amazon SES, Mailgun, or a Gmail account with an
app password). Put its server in `SMTP_URL` and your sender address in `EMAIL_FROM`:

```bash
SMTP_URL=smtps://resend:re_xxxxxxxx@smtp.resend.com:465
EMAIL_FROM="canvas <hello@yourdomain.com>"
```

Without `SMTP_URL`, emails are printed to the server's console instead (production also logs a warning).
Links in emails use `APP_URL`; in production, set it to your site's address. The app won't build reset
links from the request's own address there, because a forged `Host` header could otherwise put a link to
someone else's site in a real person's inbox. Without `APP_URL`, `npm start` on `localhost` still works,
and confirmation emails leave the link out (the code still works).

**Protections**

- Passwords: 8 to 255 characters, and checked against known breaches with the
  [Have I Been Pwned range API](https://haveibeenpwned.com/API/v3#PwnedPasswords) (only the first
  5 characters of a SHA-1 hash leave the server; skipped if the API is unreachable).
- Login failures show one generic message, and unknown emails still run an Argon2 check, so the form
  doesn't reveal who has an account.
- Rate limits (`src/lib/auth/rate-limit.ts`): 3 sign-ups per IP with one more every 10 s; 20 login
  attempts per IP with one more each second; a growing delay (1 s up to 5 min) per account after
  wrong passwords; 10 code entries per account with one more every 6 s; 10 "forgot password"
  requests per IP with one more every 30 s; 10 new passwords from reset links per IP with one more
  every 10 s; 10 math checks per person with one more every 30 s.
- Cross-site requests: `src/proxy.ts` rejects any non-GET request that the browser marks as not
  same-origin (`Sec-Fetch-Site`) or whose `Origin` isn't this site (Server Actions also check this
  themselves).
- Pages and API routes check the session on the server; the proxy's redirect to `/login` is only a
  shortcut. Drawings and images that belong to someone else answer 404.
- Browser storage is per person too (`canvas-local:<userId>` in IndexedDB), so two people sharing a
  browser don't see each other's local copies.

**Settings** (optional, in `.env.local`)

| Variable | Effect |
| --- | --- |
| `SMTP_URL`, `EMAIL_FROM` | Where emails go out (see Email above); without them they're printed to the console |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Turn the CAPTCHA on (see CAPTCHA above) |
| `APP_URL` | This site's address, for links in emails and for Stripe (production) |
| `PASSWORD_BREACH_CHECK=off` | Skip the breached-password check (offline development) |
| `INSECURE_COOKIES=true` | Drop `Secure` from the cookie when running `npm start` over plain `http://` on another machine (browsers allow `Secure` cookies on `localhost`) |

## Landing page

Visitors without a session cookie see a landing page at `/`; logged-in people get their drawings
there instead. `src/proxy.ts` makes that call from the cookie and serves `src/app/welcome/page.tsx`,
which reads no request data, so it's built once as static HTML. It's always at `/welcome` too, and the
wordmark on the login and sign-up pages links back to it.

- **The opening scene** (`src/components/landing/hero-demo.tsx`) is made of the editor's own pieces:
  handwriting in the Hand font, the lasso, the selection toolbar and a still copy of the Math check
  card. It plays once on load and shows the finished scene straight away for visitors who've asked
  their system for reduced motion.
- **The editor screenshot** is `src/components/landing/editor.webp`. Swap in another image with the
  same name and `next/image` sizes and compresses it.
- **Sections slide in as you scroll** to them, and back out as they leave (16 px and a fade, from
  whichever edge they cross), with `Reveal` (see [Scroll animations](#scroll-animations)). The hero
  doesn't move, and nothing is hidden in the HTML.
- **The "Study it together" scene** (`TogetherScene` in the page) is plain HTML and SVG: two named
  cursors, a balanced equation, a molar mass and a flashcard, as they look in the app.
- **Its CSS** (`hero-demo.css`) is a plain global stylesheet with `hero-` class names, because
  `next.config.ts` sends every `.css` file through the Tailwind loader, which doesn't keep CSS-module
  class names.

## Memberships

Drawings, the editor, image uploads and math checks are for members.

**The pricing page** (`/pricing`, `src/app/pricing/page.tsx`) is open to everyone and linked from the
landing page (**Pricing** in the header, **See what's included** under the hero, **Get membership** in
the closing section). The plan is the same for everyone; the card's button is the next step for
whoever is looking:

| Who | The card offers |
| --- | --- |
| Visitor | **Create account**, or log in and come back here |
| Signed in, email not confirmed | **Enter the code**, then back here |
| Signed in, no membership | **Start membership** (Stripe Checkout) |
| Membership ended | **Renew membership**, with the date it ended |
| Back from Checkout without paying | A note that nothing was charged, and the button again |
| Member | **Open your drawings** and **Manage membership** |

Below it, the three steps (create an account, confirm the email, start the membership) show which are
done and which is next. Everything that needs a membership sends people without one here, and so
does confirming a new account's email.

`/membership` is the members' page: renewal date, **Manage billing** (Stripe's billing portal, for the
card, invoices and cancelling) and the confirmation after paying. It's **Membership** in the account
menu; anyone without a membership who opens it goes to `/pricing`.

**How it works**

- Stripe is the source of truth. `subscriptions` holds a copy that pages read without calling
  Stripe. `src/lib/billing/sync.ts` refreshes it from Stripe whenever a webhook arrives
  (`/api/stripe/webhook`, checked against Stripe's signature) and when someone comes back from
  Checkout, so a new member can start straight away.
- Someone is a member while a subscription is `active`, `trialing` or `past_due` (Stripe is still
  retrying a failed payment). A cancelled membership runs until the end of the paid month.
- When a membership ends, the drawings stay in the database and in the browser. An editor that's open
  stops syncing, says so, and syncs everything once they renew.
- `users.stripe_customer_id` links each account to one Stripe customer, created the first time they
  start a membership and reused after that.
- Complimentary memberships (for you, testers, friends) are rows whose id starts with `comp_`:
  `npm run membership -- grant|revoke|show <email>`. Stripe never sees them. Granting needs the
  account's email to be confirmed first, since anyone can sign up with any address.
- The price shown on the site comes from `src/lib/billing/plan.ts`.

**Setting up Stripe**

1. Create a Stripe account and copy the test-mode secret key (`sk_test_...`) into `.env.local` as
   `STRIPE_SECRET_KEY`.
2. `npm run stripe:setup` creates the product and the $1/month price and prints `STRIPE_PRICE_ID`.
   Running it again finds the same price.
3. In the Stripe Dashboard, open **Settings → Billing → Customer portal** and save it once, so the
   billing portal works. Choose what members can do there (cancel, update card, see invoices).
4. Webhooks, locally: install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run
   `stripe listen --forward-to localhost:3000/api/stripe/webhook`. It prints `STRIPE_WEBHOOK_SECRET`.
5. Start a membership with the test card `4242 4242 4242 4242`, any future date and any CVC.

**Going live:** repeat steps 1–3 with your live key, set `APP_URL` to your site's address, and add a
webhook endpoint in the Dashboard for `https://your-site/api/stripe/webhook` that sends
`checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`,
`.resumed`, `invoice.paid` and `invoice.payment_failed`. Its signing secret is the live
`STRIPE_WEBHOOK_SECRET`.

**Costs:** Stripe's standard US card fee is 2.9% + 30¢ per successful charge, so about 33¢ of each $1
renewal goes to fees (more for cards from other countries). Sales tax and VAT aren't calculated; look
at Stripe Tax if you need them.

## Roles and the admin dashboard

Every account has a role (`users.role`). What each role may do is one table in
`src/lib/auth/roles.ts`, used by the pages to decide what to show and by the server to decide what to
allow:

| Permission | User | Support | Admin |
| --- | :-: | :-: | :-: |
| Open `/admin`, search accounts, see details and history | | ✓ | ✓ |
| Edit names, confirm emails, send reset links, sign accounts out | | ✓ | ✓ |
| Give and end complimentary memberships | | ✓ | ✓ |
| Change email addresses | | | ✓ |
| Change roles, and edit staff (support and admin) accounts | | | ✓ |
| Site settings: the seasonal theme, and how wild pandas turn up and battle | | | ✓ |

Nobody can change their own role, so there's always at least one admin.

**The first admin** comes from the command line (the account's email has to be confirmed):

```bash
npm run role -- set you@example.com admin     # or support, or user
npm run role -- show you@example.com
npm run role -- list                          # everyone with a staff role
```

After that, admins change roles in the dashboard. Staff see **Admin** in the sidebar and **Admin
dashboard** in the account menu; for everyone else `/admin` is the 404 page.

**The dashboard** (`src/app/admin/page.tsx`)

- Totals for accounts, members, unconfirmed emails and staff; each one is also a filter.
- A table of accounts, newest first, 10 to a page: name and email, role, whether the email is
  confirmed, membership (paid, complimentary, ended or none), when they joined and when they were last
  active.
- Search matches names and emails as you type. A role filter sits next to it.
- The pager reads **← 1 2 3 4 5 →**: up to five page numbers around the current page, sliding along as
  you go, with Previous and Next.
- **All of it is in the address**: `/admin?q=ada&role=support&status=members&page=3&user=<id>`.
  Reloading, Back and Forward, and pasting the link to someone all show the same thing. Typing replaces
  the history entry (so Back isn't a list of half-typed searches); pages, filters and opening an account
  add one. A page past the end goes to the last page. The parsing and link building are in
  `src/lib/admin/query.ts`.
- **Edit** opens the account in a side panel: name, email, role (with what it allows), email confirmed,
  complimentary membership, **Sign out everywhere**, **Email a password reset link**, and the
  account's history. Paid memberships are refunded or cancelled in the Stripe Dashboard.
- **Wild pandas** (admins only; `src/components/admin/wild-rules-form.tsx`): how wild pandas turn up
  for everyone. See [Wild pandas and battles](#wild-pandas-and-battles) for what each number does.
  - A switch for whether they turn up at all. Off stops new ones; any already out stay their time,
    and battles finish.
  - The chance each time (1–100 %), the minutes between chances (1–240), and the minutes each one
    stays (1–30).
  - For each kind: how often (0–1,000, against the other kinds someone can meet; 0 is never), from
    which study level (1–10), how many levels above the member (−3 to +5), the chance bamboo is taken
    at its last breath (1–100 %), and the chance it runs off each turn (0–50 %).
  - As you type, it shows how often that works out ("about one every 6½ minutes, staying 3 minutes"),
    each kind's share at the top level, and the lowest level that meets any.
  - **Save wild pandas** stores the rules in `site_settings` under `wild_pandas`, and they apply to
    the next wild panda anywhere. **Reset to defaults** puts back the numbers in the table under Wild
    pandas and battles. The server checks every number again (`rulesFromForm` in
    `src/lib/buddy/rules.ts`), and a stored value that's missing or out of range falls back to its
    default by itself.

**Checks and history**

- Every action (`src/app/admin/actions.ts`) checks the role again on the server. A field the panel
  locks for support, re-enabled in the browser, is still refused; so is a form pointed at another
  account, and an action from someone whose role was taken away a moment ago.
- Changing an email address cancels any codes and reset links sent to the old one.
- Each change is a row in `audit_events` (who, which account, what, from and to, when), written in
  the same transaction as the change. `npm run role` records its changes too.

## Seasonal themes

Decorations for Easter, Halloween and Christmas on the landing and pricing pages and in the app's menu
(the sidebar). The dates, colours and artwork are in `src/lib/seasons.ts` and
`src/components/seasonal/`; the artwork is plain SVG drawn for this app.

| Theme | Automatic dates | Landing and pricing pages | Menu |
| --- | --- | --- | --- |
| Christmas | December 1–26 | Snow falling over the page; candy canes by the wordmark, hanging in the opening board and crossed in its corner | Snow, crossed candy canes, a candy-striped edge on the current page |
| Halloween | October 15–31 | Bats crossing the page now and then; a spider on its thread; jack-o'-lanterns | Bats, a jack-o'-lantern, an orange-and-black edge |
| Easter | Palm Sunday to Easter Monday (worked out for each year) | Spring petals drifting down; painted eggs and a nest | Petals, two eggs, a pastel edge |

- **Who decides**: admins choose in `/admin` under **Seasonal theme**: Automatic (the default), one of
  the three now (to preview it, or to run it on other dates), or Off. It's stored in `site_settings`.
- **How it reaches pages**: the browser asks `GET /api/site/theme` for the mode (cached for a minute,
  so a change reaches everyone within one) and works out Automatic from its own date and time zone.
  Pages never read it on the server, so the landing page stays fully static.
- **Visitors can hide them**: **Hide Christmas decorations** (and so on) in the corner of the public
  pages, or in the account menu in the app. It's remembered in that browser.
- **Out of the way**: nothing seasonal takes a click, nothing moves for people who've asked their
  system for reduced motion (the decorations stay still), the snow and petals pause in background tabs,
  and in the editor the menu keeps its decorations but nothing falls next to the drawing. On phones,
  where the menu is a bottom bar, only the striped edge shows.

## Equations, graphs and chemistry

- **Equation tool (M)**: click the canvas and type. The popover previews as you type and explains
  mistakes ("A `{` is never closed"). **Math** takes LaTeX (with the `ams`, `color`, `cancel` and
  `boldsymbol` packages); **Chemistry** takes [mhchem](https://mhchem.github.io/MathJax-mhchem/)
  notation such as `Fe^3+ + e- -> Fe^2+` or `N2 + 3H2 <=> 2NH3`. Snippet buttons insert fractions,
  roots, arrows, charges and states. Double-click an equation to edit it.
- Equations are typeset by **MathJax 4** in the browser, loaded only when the first equation appears.
  Its SVG output is flattened into paths and drawn on the canvas, so equations stay sharp at any zoom,
  export with everything else and look the same for everyone. No TeX package that produces HTML or
  links is loaded, so a shared drawing can't inject anything.
- **Graph tool (G)**: drag out a box (or click for a default one) and type up to six functions of x:
  `x^2 - 3x + 2`, `2sin(3x)`, `sin^2 x`, `|x - 1|`, `e^(-x^2)`, `log(2, x)`, implicit multiplication
  included. **Fit y to the curves** picks a window. Expressions are parsed by a small hand-written
  parser (`src/lib/math/expr.ts`) into closures, never `eval`. Curves are sampled per screen pixel and
  break at asymptotes.
- **Chemistry panel** (header button): molar mass with a per-element breakdown and a grams ⇄ moles
  converter; a balancer that solves the element (and charge) balance exactly with rational
  arithmetic and explains when it can't (an element on one side only, or two reactions in one); and the
  periodic table. Atomic weights are the IUPAC [CIAAW](https://ciaaw.org/atomic-weights.htm) standard
  values ("Atomic Weights 2021", with the 2024 revisions for Gd, Lu and Zr; conventional values for
  elements given as intervals); elements with no stable isotopes show the mass number of their
  longest-lived isotope. Any result can go onto the canvas as a typeset equation.

## Live collaboration

Open **Share** in a drawing and turn on **Invite with a link**. Anyone with a membership who opens the
link joins with the link's role (**Can edit** or **Can view**); people without a membership are asked
to join first. The owner can change each person's role, remove them, or make a **New link** (the old
one stops working). Collaborators can leave from the same dialog or the gallery, where shared drawings
are listed under **Shared with you**.

How it works (`src/lib/collab`):

```
 edit ──► batch of ops (add / set / del per element) ──► shown at once, kept in IndexedDB
      ──► POST /api/drawings/[id]/changes  (row lock, next version, drawing_changes row, NOTIFY)
      ──► every open editor: GET /api/drawings/[id]/events  (Server-Sent Events, in version order)
```

- Every change is a list of per-element operations, so edits to different things never clash. When
  two people change the same element, the later one wins; a deletion beats a concurrent edit.
- The server applies batches one at a time under a row lock and numbers them; a retried batch id is
  applied once. Each editor shows the server's state plus its own unconfirmed batches on top, and
  replays them when other people's changes arrive, so everyone converges.
- Live updates are Server-Sent Events. Each server process holds one Postgres connection that
  `LISTEN`s for changes and fans them out, so it works with several app servers. Editors that fall
  behind the kept history (2,000 changes per drawing) reload the drawing.
- Cursors and selections travel the same way but aren't stored. Undo and redo only reverse your own
  changes, and skip anything someone else has changed since.
- Viewers can look, follow along, check math and make flashcards; the server refuses their changes.
  Removing someone or deleting the drawing ends their live view at once.

## To-do boards, GIFs and videos

**To-do board tool (K)**: click the canvas and a board appears with **To do**, **Doing** and **Done**
columns, asking for its first card. Then:

- **Drag a card** to another column, up or down within one, or onto another board. Where it would land
  opens up as you drag; let go anywhere else and it goes back.
- **Click a card** to change its text, move it to another column (from the keyboard too) or delete it.
  **+ Add a card** adds one at the end of a column.
- **Double-click a column's name** to rename it, change its colour or delete it. **Add column** (up to
  six) and **Rename board** are on the toolbar above a selected board.
- The last column counts as done: its cards are struck through, and the title shows how many of all
  the cards are done, with a bar.
- Cards glide into place when they move (from where you let go, after a drag, and for collaborators'
  moves and undo too), new cards pop in, the bar slides, and a card that reaches the last column is
  crossed out as you watch. **Animate to-do boards** in Settings turns this off.
- Drag a corner to make the whole board bigger or smaller; hold **Shift** to change only its width.
- Every edit, including moving a card from one board to another, is one change: one undo puts it back,
  and collaborators see it at once.

A board is one element in the drawing (`{ type: "kanban", title, columns: [{ title, color, cards:
[{ text }] }], w, scale }`). Its height isn't stored: it follows from the cards
(`src/lib/canvas/kanban.ts` lays it out and hit-tests it; `kanban-render.ts` draws it).

**GIFs and videos** go on the canvas like images: paste, drop, or **Image or video (I)**.

- **GIFs** are stored exactly as uploaded and decoded a frame at a time
  ([gifuct-js](https://github.com/matt-way/gifuct-js)) only while they're on screen. Click one to pause
  or play it. With *reduce motion* turned on in the system settings they start paused.
- **Videos** (MP4/H.264, WebM, QuickTime) up to 50 MB. Click one to play or pause it; the toolbar
  above a selected video has play/pause, the position, the time and sound. Playback is per person:
  starting a video doesn't start it for everyone else. View-only collaborators can play videos too.
- Uploaded files are served with byte ranges: a video player asks for 4 MB at a time, read from
  Postgres with `substring()`, so playback and seeking start straight away. In the editor that added
  it, a video plays from the browser's own copy.
- Limits: images and GIFs up to 10 MB, videos up to 50 MB, and 2 GB of uploads across the drawings one
  person owns. Too-large files are turned away before uploading. If the server refuses a file anyway,
  the change that added it is undone and the reason is shown, instead of retrying forever.

## Flashcards and study

Select something on a canvas (or loop around it with the lasso) and choose **Flashcard**. The selection
becomes a picture on the back (or the front, or neither), you type the question, and the card goes in a
deck named after the drawing. Viewers of a shared drawing can make cards from it too; cards belong to
the person who made them.

`/study` shows the cards that are due. **Space** shows the answer; **1** Again, **2** Good, **3** Easy.
Scheduling is a Leitner system (`src/lib/study/schedule.ts`): a remembered card moves up a box (two for
Easy) and comes back after 1, 3, 7, 16, 35, 75 or 160 days; a forgotten one drops to box 1 and comes
back in 10 minutes, and again later in the same session. Cards can be edited, started over or deleted
below the session, and filtered by deck. The gallery shows how many are due.

## Study buddies

Members get a panda, **Bao**, floating near the bottom-right corner of the gallery, `/study` and every
drawing. It's original SVG with CSS animation (`src/components/buddy/panda.tsx`, `.buddy-*` in
`globals.css`): it bobs and blinks, drifts about near its spot, dangles while you drag it, waves hello
once a day, naps after three quiet minutes and wakes when you're back.

- **Move it**: drag it anywhere, or focus it (Tab) and use the arrow keys (Shift for bigger steps). The
  spot is saved as a fraction of the window, so it follows you to other screen sizes and devices.
- **Click it** for today's progress: cards answered against your daily goal, to-do cards finished, the
  streak, the level and your bamboo, plus its rarity and trick (**Show me** does the trick now), with
  **Hide buddies** (undo in the toast), **Settings** and a link to all your buddies.
- **Settings** (also in the account menu, which is how hidden buddies come back; on pages without
  buddies the menu opens `/buddies` instead): show or hide, let them wander or stay put, **Walk all
  over drawings** (off by default; needs wandering), **Do their tricks** (on), **Wild pandas on
  drawings** (on), the daily goal (flashcards a day; 0 turns it off), and up to three buddies with
  their own names and scarf colours, made up or caught. The same switches are on the Settings page.
- **Following progress**: a flashcard answered is 1 point and a to-do card moved into a board's last
  column is 5 (once per card, and only for cards that were on a board before, so copying a finished
  board doesn't count). Points make levels (20, 50, 100, 175, …, 1,000), and levels dress the pandas
  up: a scarf at 2, reading glasses at 4 and a graduation cap at 6. The streak counts days in a row
  with anything studied, in your own time zone.
- **Your level, on your record**: the level is stored on the account (`users.level`, 1 for a new
  account; migration `0012_user_level.sql` worked it out for everyone who had studied already). Noting
  something studied works it out again in the same transaction (`recordEvents` → `syncLevel` in
  `src/lib/buddy/progress.ts`, in SQL from the same points and level floors), and reading progress
  (`GET /api/buddy`) puts it right if study events got in some other way. Everything that needs only
  the level reads it from there: the session's user (`user.level`), wild pandas and battles,
  `/buddies`, and the admin panel ("Study level 4.").
- **Reacting**: a hop for a good answer, a nod for a missed one, and a few words now and then (the
  first card, every fifth, the daily goal, the end of a round, a level, a finished task), never on
  every card. With *reduce motion* on, they don't drift or bounce; they still talk.

Events are recorded on the server where they happen: `reviewCard` notes each answer, and the changes
route notes to-do cards that reached Done (`finishedCards` in `src/lib/canvas/kanban.ts`). The page
tells the buddies through a window event (`src/lib/buddy/events.ts`), so nothing else depends on them.

### Tricks and getting about

Every panda has a trick, which is also its special move in a battle. Pandas you make yourself are
common, with a trick that follows from their id (Bao always sprints); caught ones keep theirs.

| Trick | On screen | In a battle |
| --- | --- | --- |
| Sprint | Runs (dust and speed lines) to the other side of the screen, or of the drawing when roaming, then walks back | **Dash**: a quick hit that always goes first |
| Roll | Somersaults a few steps towards the side with more room | **Roll**: hits hard, misses now and then |
| Power nap | Curls up for a nap | **Nap**: almost half its energy back |
| Bamboo break | Stops for a bamboo snack | **Snack**: a quarter of its energy back, and stronger hits |
| Pep talk | Jumps up and cheers | **Cheer**: much stronger hits |
| Dance | A little spinning dance | **Dizzy dance**: the other panda misses more |
| Stardust | Floats up in a twinkle of stars | **Starfall**: a big hit that never misses |

- With **Do their tricks** on, each panda does its trick every 30–60 s, unless it's asleep, being
  dragged or showing its card. Tricks that move it (sprint, roll) need **Let them wander about**;
  **Show me** on the card does the trick whatever the settings, and a panda that doesn't wander walks
  back to exactly its spot afterwards.
- Each move is a CSS transform transition whose length follows the distance
  (`src/components/buddy/movement.ts`): a stroll near its spot takes 3.2 s, walking goes at about 55 px/s
  (1.6–9 s), a sprint at about 650 px/s and a roll at about 180 px/s, with the pose to match (`data-pose`
  `walk`, `run` or `roll`).
- **Walk on drawings**: on a drawing the pandas leave the corner and climb onto the canvas itself
  (`src/components/buddy/canvas-buddies.tsx`), as part of the drawing. They're placed in its own
  coordinates, inside the board (marked `data-buddy-stage`), so they move with it when you scroll or pan,
  are exactly as much bigger or smaller as everything else when you zoom (a panda is 64×72 drawing
  units, like a shape that size), are clipped to it and walk under its tool bars. Only their words stay
  the same size on screen, so they can be read. The board publishes its camera on every change
  (`src/lib/canvas/view-bus.ts`) and the layer follows it in the same frame, without re-rendering.
  Nothing they do depends on where you're looking: each has its own patch of the drawing (the part in
  view when it first climbed on, between 700×450 and 1600×1000 drawing units) and walks (and sprints,
  and rolls) about that, resting in between, wherever you pan or zoom. Put one down somewhere else and
  its patch moves there. Each panda's spot and patch are kept for each drawing in this browser
  (`localStorage` `buddy-spots:<drawing id>`), so it's where you left it next time. Turned off, they go
  back to their corner.
- **They keep off what's drawn** (`src/lib/buddy/pathing.ts`). The board also publishes its elements;
  shapes, text, pictures, equations, graphs and to-do boards count as their whole box, while pen
  strokes and lines are cut into short pieces, so the empty middle of a circle you drew stays walkable
  (rubbed-out ink still counts). Before each walk a grid of spots 22 drawing units apart is laid over
  the panda's patch, and a spot is blocked if the panda's body standing there would come within 6 units
  of anything (all in drawing units, so zooming changes nothing). They only choose clear spots, and walk there along a path found round everything
  (A*, no squeezing diagonally between two blocked spots), straightened so it only turns where it has to
  and walked at an even pace. Each turn waits until the move before it has really finished (its
  `transitionend`, not a timer), so a busy page can't make a panda cut a corner across something drawn.
  Sprints go round too, a roll only happens where the way is clear (else it
  rolls on the spot), and wild pandas walk in and out at clear spots on the edge of their patch. If you draw
  under a panda it steps aside to the nearest clear spot; if you draw across its way, it finds another
  way (or another spot); if you put one down on your drawing, it hops off. With no clear paper on its
  patch a panda stays where it is.
- A panda never looks like it's resting while it moves: on the move it shows its walk, run or roll,
  and a nap, a snack, a dance, a reaction or falling asleep stops it where it is first (as does pressing
  it). A panda that's saying something stands still until it's done.
- With *reduce motion* on, nothing moves by itself (pandas on a drawing still pan and zoom with it) and
  **Show me** shows the trick's pose on the spot.

### Wild pandas and battles

From level 1 (so from your first day), while a drawing is open, the page asks `POST /api/buddy/wild` 2.5 s after it opens and
then every minute (not while the tab is hidden). The server decides: at most one chance every 4 minutes,
counted from when the last one turned up or left (so the first comes after a full wait and none
straight after a battle), each a 60 % coin flip. A wild panda stays 3 minutes on the canvas itself
(like buddies walking on drawings, whatever that setting), on a patch of the drawing that's the part in
view when it turns up: it walks in from one side, ambles about with a bobbing "!" over its head (a
sprinter dashes now and then, a roller rolls), and walks off the nearer side when its time is up,
staying put on the drawing however you pan or zoom. One of your buddies points it out.

These numbers, and the ones in the table, are the defaults: admins can change them all for everyone
in `/admin` under **Wild pandas**, or switch wild pandas off (see
[Roles and the admin dashboard](#roles-and-the-admin-dashboard)). The rules live in
`src/lib/buddy/rules.ts` and are read on every request (`getWildRules`). A battle keeps the bamboo
and running-off chances it started with (`BattleState.rates`). Browsers learn whether wild pandas
turn up, and from which level each kind does, from `GET /api/buddy` (`wild`). The field guide on
`/buddies`, the level-up lines and the settings switch's hint follow along.

| Rarity | Coat | From level | How often | Bamboo taken at its last breath | Strength | Runs off |
| --- | --- | --- | --- | --- | --- | --- |
| Common | Classic | 1 | 58 | 75 % | ×1 | never |
| Uncommon | Cocoa (brown) | 3 | 28 | 55 % | ×1.1 | 3 % a turn |
| Rare | Moonlit (navy, with a crescent) | 5 | 11 | 38 % | ×1.22, a level above you | 6 % a turn |
| Super rare | Golden (with a star and a glow) | 7 | 3 | 22 % | ×1.38, two levels above you | 10 % a turn |

"How often" weighs the rarities your level can meet (at level 4: common 58 out of 86). Wild pandas
are your level, give or take one, plus the rarity's bonus.

**The battle** is turn based and original to canvas (its own art, moves and rules; no names or
pictures from any game). Press the wild panda and it opens: the wild panda faces you on its patch of
grass, your buddy stands with its back to you, each with an energy bar on a taped-down card, and what
happens is written underneath in handwriting. Your choices:

- **Fight**: **Bump** (always lands), **Paw swipe** (stronger, misses one time in ten), **Stare** (its
  hits get softer), or the buddy's own trick move. The faster panda goes first; Dash always does.
  Hits are stronger with your level, a rarer coat and Cheer or Snack; one in sixteen is a great hit.
- **Bamboo**: offer some, showing what you have left and the chance now. The chance is the rarity's
  rate, less the more energy the panda has left (down to 30 % of it at full energy), and a little
  better or worse for each level between you; it nibbles three times and each nibble has to go well.
  If it doesn't take it, it gets a turn.
- **Buddies**: send out another of the buddies with you (it costs your turn, except when the one out
  is worn out). If they're all worn out, the wild panda wanders off.
- **Run**: always works. Closing the battle part-way is running too.

Wear a wild panda out completely and it wanders off for a rest (a win, but not a catch). Rarer ones may
run off into the bamboo from your second turn on. Steps play one after another with
[Motion](https://motion.dev) (lunges, shakes, floating numbers, the bamboo thrown in an arc, wobbles, a
burst of hearts); press the message to skip ahead (Enter works too). *Reduce motion* keeps the words
and drops the movement.

**Bamboo** comes from studying: 5 to start with and one more for every 10 points. **Caught pandas**
are yours for good (`buddy_collection`): one walks with you straight away if fewer than three are out,
otherwise it waits at home. `/buddies` (also in the sidebar) shows who's out, every panda you've
caught with its trick, battle move and the day you caught it (each with an **Out with you** switch,
three at a time), a field guide to the four coats and the levels they turn up from, how catching
works, and your bamboo.

**Every turn is played on the server.** The engine (`src/lib/buddy/battle.ts`) is pure, with the
randomness passed in, so the unit checks replay battles exactly; `src/lib/buddy/wild.ts` keeps the
battle in `buddy_encounters.state`, works out your bamboo from your study points each turn, and saves
the turn only if nobody else played it first (the request carries the turn it was played on). The
browser just animates the steps it gets back (`src/components/buddy/battle-screen.tsx`), so a battle
can't be won, or bamboo conjured, from the console.

| Request | Answer |
| --- | --- |
| `GET /api/buddy?tz=` | settings, progress, first name, caught pandas, bamboo, and `wild` (whether wild pandas turn up, how long they stay, and the level each kind turns up from, or null for never) |
| `PUT /api/buddy` | saves settings; caught pandas in the party must be yours, each once (422) |
| `POST /api/buddy/wild` | the wild panda around now (wandering, or mid-battle), maybe a new one, or `null` |
| `POST /api/buddy/battle` | `{ id, action: "start", first? }` or `{ id, turn, action }`, where `action` is a move (`bump`, `swipe`, `stare`, `special`), `bamboo`, a switch `{ to }` or `run`; answers `{ battle, steps, bamboo, caught }` |

Errors: 401 signed out, 402 without a membership, 404 a panda that isn't yours, 409 a battle already
started or a turn already played, 410 one that has wandered off (or a battle that's over or not started),
422 a move that isn't allowed (out of bamboo, a buddy that can't come out), 429 too many requests
(20 looks then one every 10 s; 120 turns then two a second).

## Settings, profile pictures and effects

`/settings` (Settings in the account menu) is open to anyone signed in with a confirmed email.

**Name**: the same rules as signing up (up to 80 characters). It shows in the account menu at once,
and to collaborators next to your cursor.

**Profile picture**: choose any photo the browser can open. It's cut to the middle square and saved as
a 256 px WebP (JPEG where the browser can't write WebP) before it's uploaded, so uploads are a few KB
and the server never resizes anything.

- The server action checks the size (up to 300 KB) and the file's first bytes (PNG, JPEG or WebP only;
  SVG and anything else is refused), then stores it in `user_avatars`. `users.avatar_updated_at` says
  there is one and is its version.
- It's served at `/api/avatars/<user id>?v=<version>` to anyone signed in, with `nosniff`, a sandboxing
  Content-Security-Policy and a private cache that lasts as long as that version does.
- It shows in the account menu, in a drawing's **People with access**, in the faces of people who have
  a drawing open, and in `/admin`. Without one, or if it fails to load, initials show instead (the
  kit's `Avatar`).
- **Remove picture** deletes it. Staff who can edit an account can also take one down from its panel in
  `/admin` (**Remove profile picture**, written to the history).

**Drawing effects** decide how things appear on a canvas when you didn't just draw them: a drawing
opening, someone else drawing, pasting, undo and redo, and equations, graphs, pictures and to-do
boards being added. What you draw yourself is on screen as you draw it, so it never replays. Erased,
deleted and undone things leave the same way.

| Effect | Coming in | Going out |
| --- | --- | --- |
| Off | At once | At once |
| Fade | Fades in (0.28 s) | Fades out |
| Pop (default) | Springs up from 82 % size | Shrinks away |
| Trace | Pen strokes and plain lines follow their path, plain boxes and circles trace their outline, and text, pictures and sketchy shapes sweep in from the left. 0.3–1 s, longer for longer lines | Fades out |

- When a drawing opens, what's in view replays in the order it was drawn, all within about a second.
- Only what's on screen animates, never more than 240 things at once (a busier view just appears),
  and anything still animating settles the moment you start drawing. Exports, thumbnails and the math
  check always see the finished drawing.
- [Motion](https://motion.dev)'s `animate()` drives the numbers (`src/lib/canvas/effects.ts`); the
  board reads them as it paints and `drawElementFx` in `render.ts` draws an element part-way.

**To-do board effects** (`src/lib/canvas/kanban-fx.ts`): see [To-do boards](#to-do-boards-gifs-and-videos).

**Study buddies** (members): show them, let them wander, walk on drawings, do their tricks, and
wild pandas on drawings, saved as soon as they change (`PUT /api/buddy`). Names, scarves and caught
pandas are on `/buddies`. See [Study buddies](#study-buddies).

Both choices are saved per person in `user_preferences` as soon as they change, and follow you to
every device. On a device set to **reduce motion**, canvas leaves them off (the settings page says so),
and page animations keep only their fades (`MotionProvider` in the root layout).

### Scroll animations

`Reveal` (`src/components/motion/reveal.tsx`) slides content 16 px and fades it in as it scrolls into
view, and back out as it leaves, from whichever edge it crosses. Items in a row can be staggered with
`delay`. Nothing is hidden in the HTML: what's on screen when the page loads stays put, and only
things below the fold are tucked away (out of sight) once the page has loaded. It's on the landing
page's sections, the pricing questions, the gallery's drawing cards, the study card list and the
settings sections.

## Phones, tablets and loading

- **The menu** (`src/components/app-sidebar.tsx`) is a bar along the bottom on phones, a rail of
  icons on tablets (48–64rem), and the full menu on bigger screens, where **Minimize menu** turns it
  into the rail. The rail is a CSS variant (`rail:` in `globals.css`); the minimized choice is put on
  `<html>` (`data-sidebar="collapsed"`) by a small script in `src/app/layout.tsx` before the page
  draws, so pages never open with the full menu and then slide. The staff-only **Admin** link isn't in
  the phones' bar (it would arrive late and push the other tabs aside); staff open it from the account
  menu there.
- **The editor's header** keeps room for the title: on phones, Share, Export and Chemistry are in a
  **⋯** menu. **New Drawing** reads **New** on the narrowest phones (still "New Drawing" to screen
  readers).
- **Layouts follow the space they get**, not the screen: the Settings cards use container queries
  (`@container`), since next to the menu a tablet's column is narrower than a phone held sideways.
  Grids holding long unbreakable text (an email address) cap their column at `minmax(0, 1fr)`, and
  scrolling tables are `relative`, so visually hidden labels inside them can't widen the page.
- **Loading placeholders** have the real content's sizes (the page header's avatar, the gallery's
  tiles, the Settings cards at each width, the membership card, the whole admin frame), so nothing
  jumps when the page fills in.

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| V | Select | T | Text |
| S | Lasso | I | Insert image, GIF or video |
| H / hold Space | Pan | Ctrl/⌘ Z, Shift Z | Undo, redo |
| P | Pen | Ctrl/⌘ C, X, V, D | Copy, cut, paste, duplicate |
| E | Eraser | Delete | Delete selection |
| L / A | Line / arrow | Arrows (+Shift) | Nudge |
| R / O | Rectangle / ellipse | Ctrl/⌘ + / − / 0 | Zoom in / out / 100 % |
| M | Equation | G | Graph |
| K | To-do board | Shift + corner drag | Stretch; widen a to-do board |
| Shift while drawing | Square, circle, 45° lines | Shift 1 / Shift 2 | Zoom to fit / selection |

On `/study`: **Space** shows the answer, then **1**, **2** or **3** for Again, Good or Easy.

## Project layout

```
src/
  app/
    (auth)/login, (auth)/signup  login and sign-up pages; (auth)/actions.ts signs up, logs in, signs out
    (account)/verify-email       enter the emailed code (all an unconfirmed account can open)
    (account)/forgot-password    ask for a reset link; (account)/reset-password/[token] sets the password
    (account)/actions.ts         confirm the code, send a new one, request a reset, save the new password
    welcome/page.tsx             landing page (served at / to visitors without a session)
    pricing/page.tsx             the plan, and the next step for whoever's looking (join, renew, confirm email)
    membership/                  members' page (billing portal, confirmation after paying); actions start Checkout
    admin/page.tsx               admin dashboard: totals, search, role filter, ← 1 2 3 4 5 → pager, edit panel
    admin/actions.ts             staff actions: save details and role, complimentary memberships, sign out, reset link,
                                 remove a profile picture, the seasonal theme
    settings/                    name, profile picture, effects and study buddy switches; actions.ts saves them
    buddies/page.tsx             your buddies: who's out, the pandas you've caught, the field guide
    api/site/theme               GET the seasonal theme mode (public, cached a minute)
    api/stripe/webhook           Stripe webhooks: keeps memberships in step with Stripe
    page.tsx                     gallery: your drawings, shared with you, flashcards due
    drawings/[id]/page.tsx       editor page
    join/[token]/page.tsx        where invite links lead
    study/                       flashcard review and card management; actions.ts records answers
    actions.ts                   Server Actions: create, rename, delete (validated with zod)
    sharing-actions.ts           Server Actions: invite link, roles, remove, join, leave
    api/drawings/[id]/changes    POST batches of changes (the collaboration write path)
    api/drawings/[id]/events     GET live updates (Server-Sent Events)
    api/drawings/[id]/doc        GET the drawing and its version (to catch up)
    api/drawings/[id]/presence   POST cursor and selection (passed on, not stored)
    api/drawings/[id]/thumbnail  POST the gallery preview
    api/drawings/[id]/assets     POST an image, GIF or video (multipart)
    api/assets/[id]              GET it (cached forever; ids never change), with byte ranges
    api/flashcards               POST a card (multipart, with an optional picture); [id]/image serves it
    api/check-math               POST a selection image -> verdict JSON
    api/buddy                    GET study buddy settings, progress (?tz=), caught pandas, bamboo; PUT settings
    api/buddy/wild               POST: is a wild panda around? (the server decides)
    api/buddy/battle             POST: start a battle or play a turn (played on the server)
    api/avatars/[userId]         GET a profile picture (signed in; cached privately per version)
  components/
    app-sidebar.tsx              dark sidebar (tools in the editor): bottom bar on phones, icon rail on tablets
    user-menu.tsx                avatar + account menu (Study buddies, Settings, Membership, Sign out)
    motion/                      Reveal (slide in and out on scroll) and MotionProvider (reduced motion)
    settings/                    profile (picture and name) and effects, with their live examples
    buddy/panda.tsx              the panda: SVG with poses, coats, accessories and a back view
    buddy/study-buddies.tsx      floating buddies: wander, roam, tricks, drag, speech, progress card, settings,
                                 looking for wild pandas
    buddy/movement.ts            how pandas get about (durations by distance, room on the drawing, tricks)
    buddy/canvas-buddies.tsx     pandas on the canvas (yours and wild ones), in the drawing's coordinates
    buddy/battle-screen.tsx      the battle (Motion animations of the steps the server sends)
    buddy/collection.tsx         the /buddies page: party, collection, field guide
    buddy/rarity-badge.tsx       Common, Uncommon, Rare, Super rare
    auth/auth-form.tsx           login and sign-up forms
    auth/account-forms.tsx       confirm-email, forgot-password and new-password forms
    auth/captcha.tsx             the Turnstile widget hook (waits for the check, fresh token per try)
    admin/                       dashboard toolbar (search, role), URL-driven edit panel and its forms
    landing/site-chrome.tsx      header and footer shared by the landing and pricing pages
    seasonal/                    seasonal themes: artwork (SVG), snow and petals (canvas), bats, page and menu
                                 decorations, the mode and the "hide" preference
    landing/                     the landing page's animated opening scene and editor screenshot
    billing/membership-buttons   Start membership, Manage billing, Log out
    editor/board.tsx             the infinite canvas: camera, rendering loop, pointer/touch, tools
    editor/canvas-editor.tsx     editor shell: local-first saving, live sync, presence, header, export
    editor/style-bar.tsx         per-tool options (brush, colour, width, sketchy, font)
    editor/math-card.tsx         AI result card (KaTeX)
    editor/equation-editor.tsx   LaTeX / chemistry popover with live preview
    editor/graph-editor.tsx      functions, window and grid for a graph
    editor/kanban-editor.tsx     a to-do card, column or board title
    editor/media-controls.tsx    play/pause, position and sound for a selected GIF or video
    editor/chem-panel.tsx        molar mass, balancer, periodic table
    editor/share-dialog.tsx      invite link, roles, people
    editor/flashcard-dialog.tsx  make a card from the selection
    gallery/                     overview cards, drawing grids, delete / leave
    study/                       review session, card list
    kit/                         the component kit: buttons, fields, menus, dialogs, toasts…
  db/schema.ts                   users (with roles), sessions, email codes, reset links, audit events,
                                 subscriptions, drawings, members, changes, assets, flashcards, buddies,
                                 profile pictures, preferences
  proxy.ts                       landing page or drawings at /, sign-in redirects, cookie refresh,
                                 cross-site request check
  lib/
    auth/session.ts              tokens, validation, cookies, getCurrentSession, requireUser
    auth/password.ts             Argon2id hashing, breached-password check
    auth/account.ts              create and find users
    auth/email-verification.ts   8-digit codes: send, re-send, check
    auth/password-reset.ts       reset links: send, look up, use
    auth/captcha.ts              Turnstile siteverify (server); captcha-shared.ts for the forms
    auth/rate-limit.ts           token buckets and the per-account login throttle
    auth/roles.ts                roles, what each may do (can, canManage), shared by pages and server
    seasons.ts                   seasonal themes: dates (Easter computed per year) and what each one shows
    site/settings.ts             site-wide settings (the seasonal theme, the wild pandas' rules)
    admin/query.ts               the dashboard's URL state: parse, build links, the five-page window
    admin/users.ts               dashboard queries (search, totals, account details) and the audit log
    email/send.ts                SMTP via nodemailer, or the console when SMTP_URL isn't set
    email/templates.ts           the code, reset and "password changed" emails (text and HTML)
    site-url.ts                  this site's address, and the one links in emails use
    billing/plan.ts              the plan: $1 a month, and what it includes
    billing/stripe.ts            the Stripe client and its settings
    billing/membership.ts        who's a member: getMembership, requireMember
    billing/sync.ts              Stripe customers, and copying subscriptions from Stripe
    canvas/schema.ts             drawing JSON format (zod), shared by client and server
    canvas/render.ts             Canvas 2D rendering, exports, thumbnails
    canvas/graph-render.ts       graphs: grid, axes, sampled curves
    canvas/kanban.ts             to-do boards: layout, hit-testing, card moves
    canvas/kanban-render.ts      to-do boards: drawing
    canvas/effects.ts            drawing effects: fade, pop and trace in and out (Motion)
    canvas/kanban-fx.ts          to-do board effects: glides, pop-ins, the done line, the bar (Motion)
    preferences.ts               the settings page's choices: types, defaults, parsing
    profile/                     profile pictures (URLs, type sniffing; storing and serving) and names
    canvas/geometry.ts           bounds, hit-testing, lasso, move/resize
    canvas/view-bus.ts           the open drawing's camera and elements, for pandas walking on it
    buddy/kinds.ts               rarities, coats, tricks, bamboo, wild pandas' levels
    buddy/rules.ts               the wild pandas' rules admins set: defaults, limits, the form, what they add up to
    buddy/battle.ts              the battle engine (pure; the server plays every turn with it)
    buddy/wild.ts                wild pandas turning up, battles and catches (server only)
    buddy/pathing.ts             keeping pandas off what's drawn: obstacles, a grid, A* paths
    canvas/images.ts             images, GIF and video players, local cache, uploads
    http/range.ts                HTTP Range header parsing
    collab/ops.ts                per-element operations and applyOps (client and server)
    collab/doc.ts                one tab's view: server state + pending batches, per-person undo
    collab/sync-client.ts        sending batches, the live stream, presence
    collab/hub.ts                server: LISTEN connection and event fan-out
    collab/access.ts             roles: owner, editor, viewer
    math/mathjax-engine.ts       MathJax 4 (loaded on demand): TeX/mhchem -> drawing operations
    math/layout.ts               typeset cache and drawing for equations
    math/expr.ts                 function-of-x parser for graphs
    chem/                        periodic table, formula parser and molar mass, balancer
    study/                       flashcard queries and the Leitner schedule
    local-store/                 IndexedDB outbox and images, quota fallbacks
    ai/check-math.ts             provider call + prompt (server-only)
scripts/migrate.mjs              applies the migrations in drizzle/ (npm run db:migrate)
scripts/stripe-setup.mjs         creates the Stripe product and price (npm run stripe:setup)
scripts/membership.mjs           complimentary memberships (npm run membership)
scripts/role.mjs                 roles (npm run role)
e2e/                             Puppeteer tests; mock AI, Stripe, Turnstile and mail servers; fixtures
```

### Components

The interface is built from canvas's own components in `src/components/kit`; import them from
`@/components/kit`. They use the named palette (beige, near-black, teal) directly and add `data-ui`
attributes (`data-ui="menu-trigger"`, `data-ui="side-panel"`…) that the tests select on.

| File | Components |
| --- | --- |
| `button.tsx` | `Button`: `primary` (near-black), `secondary` (white, beige edge), `ghost`, `danger`, `light` (white, for the editor's top bar and dark cards), `link`; sizes `sm` 32 px, `md` 36 px, `lg` 44 px, `xl` 53 px and `icon-sm/md/lg`; `full`, `loading` (spinner, no double submits) and `asChild` for links. `buttonClasses()` gives the same look to anything else |
| `field.tsx` | `Input`, `Textarea`, native `Select` and `Label`, white with a beige edge and a teal focus ring |
| `avatar.tsx` | `Avatar`: a round profile picture, or initials when there's none or it fails to load; `initials()` |
| `bits.tsx` | `Badge` (tones `dark`, `green`, `orange`, `red`, `neutral`), `Kbd` (`light` or `dark`), `Skeleton`, `Separator` |
| `controls.tsx` | `Switch`, `Slider` (a styled native range: `value` and `onValueChange` take a number), `Toggle`, `ToggleGroup`, `Tabs` |
| `overlays.tsx` | `Tip` (tooltip with an optional keycap), `Popover`, `Menu`, `Dialog` (`title` and `description` are props), `ConfirmDialog`, `SidePanel` |
| `toast.tsx` | `toast()`, `toast.success/.error/.info/.loading/.dismiss` and `<Toaster />` (in the root layout) |

The controls in `controls.tsx` are plain elements with the expected roles and keys (arrow keys move
through a toggle group or tabs, Home and End jump). The things that float over the page in
`overlays.tsx` use Radix underneath for focus handling, Escape, clicks outside, screen-reader roles and
staying on screen; their look and animations (`.kit-*` in `globals.css`) are canvas's own, and motion
stops when the system asks for reduced motion.

## Data model

`users`, `sessions`, `email_verification_codes` and `password_reset_tokens` are described under
[Accounts and sessions](#accounts-and-sessions); `users.role` and `audit_events` (`actor_id`,
`user_id`, `action`, `details` jsonb, `created_at`) under [Roles](#roles-and-the-admin-dashboard);
`site_settings` (`key`, `value` jsonb, `updated_by`, `updated_at`) holds the
[seasonal theme](#seasonal-themes) (`seasonal_theme`) and the wild pandas' rules (`wild_pandas`);
`users.stripe_customer_id` links an account to its Stripe customer.
`subscriptions`: `id` (Stripe's `sub_...`, or `comp_...`), `user_id` (cascade delete), `customer_id`,
`status`, `price_id`, `current_period_end`, `cancel_at` (set once cancelled), `ended_at`. See
[Memberships](#memberships).
`drawings`: `id`, `user_id` (the owner), `title`, `data` (jsonb), `thumbnail`, `version` (bumped by
every applied change), `share_token` (the invite link's secret, null when off), `share_role`,
`created_at`, `updated_at`.
`drawing_members`: `drawing_id`, `user_id`, `role` (`editor` or `viewer`), `created_at`.
`drawing_changes`: `drawing_id`, `version`, `batch_id` (unique per drawing), `client_id`, `user_id`,
`ops` (jsonb); the recent history editors catch up from, pruned to about 2,000 rows per drawing.
`assets`: `id` (generated in the browser), `drawing_id` (cascade delete), `mime_type`, `bytes`
(bytea), `byte_size`, `width`, `height`: images, GIFs and videos alike.
`flashcards`: `id`, `user_id`, `drawing_id` (set null on delete), `deck`, `front`, `back`, `image`
(bytea) with `image_mime_type`, `image_side`, `image_width`, `image_height`, and the schedule: `box`,
`due_at`, `reviews`, `lapses`, `last_reviewed_at`.
`user_avatars`: `user_id` (cascade delete), `mime_type`, `bytes` (bytea), `updated_at`; with
`users.avatar_updated_at` (null when there's no picture, otherwise its version). `user_preferences`:
`user_id`, `preferences` (jsonb: `drawEffect`, `boardEffects`), `updated_at`. See
[Settings](#settings-profile-pictures-and-effects).
`buddy_settings`: `user_id`, `settings` (jsonb: visible, wander, roam, tricks, wild, daily goal, buddies
with name, colour, spot and, for a caught one, `catchId`). `study_events`: `user_id`, `kind` (`review`
or `task`), `ref` (drawing and card id for tasks, unique per person so a card counts once), `at`.
Progress and bamboo are worked out from these when asked; the level is also kept on `users.level`.
`buddy_collection`: `id`, `user_id` (cascade delete), `name`, `rarity`, `ability`, `level`,
`caught_at`: pandas caught, for good. `buddy_encounters`: `id`, `user_id`, `name`, `rarity`, `ability`,
`level`, `status` (`wild`, `battle`, then `caught`, `won`, `lost`, `ran`, `fled` or `gone`), `state`
(jsonb: the battle), `created_at`, `expires_at`, `ended_at`. `buddy_stats`: `user_id`, `bamboo_spent`,
`caught`, `won`, `last_wild_at` (the clock for the next wild panda).

`data` is vector JSON in world coordinates, with no fixed board size:

```ts
{ version: 2, background: "#ffffff", elements: [
  { type: "stroke", brush: "ink" | "marker" | "highlighter", color, size, points, pressures? },
  { type: "eraser", size, points },                                  // pixel eraser
  { type: "line", color, size, x1, y1, x2, y2, arrow?, sketch? },
  { type: "rect" | "ellipse", color, size, fill, x, y, w, h, sketch? },
  { type: "text", text, x, y, fontSize, font: "hand" | "sans" | "mono", color },
  { type: "image" | "gif" | "video", assetId, x, y, w, h },
  { type: "math", syntax: "tex" | "chem", source, color, x, y, size, w, h },
  { type: "graph", x, y, w, h, fns: [{ expr, color }], xMin, xMax, yMin, yMax, grid },
  { type: "kanban", x, y, w, scale, title, columns: [{ id, title, color, cards: [{ id, text }] }] },
] }
```

An equation stores what was typed plus its typeset size (`w`, `h` at font size `size`), so its bounds
never depend on whether MathJax has loaded yet.

`sketch` holds the rough.js seed and roughness, so a sketchy shape looks the same every time.
Version 1 drawings (the earlier fixed-board format) are upgraded when they're opened. The view
position and zoom are remembered per drawing and per device, in `localStorage`.

## How saving works

```
 every change        ──► IndexedDB outbox (immediately) ──► Postgres and everyone on the drawing (moments later)
 image, GIF or video ──► IndexedDB (immediately)        ──► uploaded before the change that shows it is sent
```

1. **Every change is kept in the browser first**, as a batch of operations in an outbox. It stays
   there until the server has applied it, then it's removed: a fully synced drawing takes no browser
   storage beyond its images.
2. **Postgres is the source of truth.** Batches are sent at once, one request at a time, retrying with
   back-off when offline. Images are uploaded first, so nobody ever sees a missing picture.
3. **Unsynced work is restored.** If you were offline or the tab closed early, reopening the drawing
   replays the outbox on top of the server's current copy, without overwriting what others did
   meanwhile. Each tab holds a Web Lock, so a second tab never takes over a live tab's outbox. (Local
   copies left by the previous, whole-drawing format are turned into a batch the first time the drawing
   opens.)

### When browser storage runs out

IndexedDB, OPFS and the Cache API share **one quota per site**, so switching between them frees
nothing. The store (`src/lib/local-store/store.ts`) takes these steps instead:

| Step | When | What happens |
| --- | --- | --- |
| Early warning | usage passes 80 % | Asks the browser to keep the data, removes local copies of images the server already has |
| 1. Evict | a write fails | Remove local copies of images that are already on the server (oldest first), and old-format copies. Unsynced work is never removed |
| 2. Backup slot | still failing | Keep this drawing's unsynced changes, compressed, in `localStorage` (a separate ~5 MB allowance); emptied as the server confirms them |
| 3. Server only | slot full too | Nothing saved locally; every change goes straight to Postgres; images wait in memory until uploaded; a banner offers **Download backup** |
| Recovery | every 30 s, or **Free up space** | Retry IndexedDB and return to normal |

The header shows both copies at a glance (**Saved here** / **Synced**). Click it for usage, the live
connection and **Free up space**; **Export** has PNG export and backup download and load (backups
include images).

## Tests

```bash
npm run build
node e2e/mock-ai.mjs &                                   # stand-in AI on :4010
node e2e/mock-stripe.mjs &                               # stand-in Stripe on :12111
node e2e/mock-turnstile.mjs &                            # stand-in Turnstile on :4030
node e2e/mock-mail.mjs &                                 # SMTP on :2525, inbox on :2526
AI_BASE_URL=http://localhost:4010/v1 AI_MODEL=mock-vision \
STRIPE_API_BASE=http://localhost:12111 STRIPE_SECRET_KEY=sk_test_mock \
STRIPE_WEBHOOK_SECRET=whsec_mock STRIPE_PRICE_ID=price_mock \
SMTP_URL=smtp://localhost:2525 \
TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
TURNSTILE_SCRIPT_URL=http://localhost:4030/turnstile/v0/api.js \
TURNSTILE_VERIFY_URL=http://localhost:4030/turnstile/v0/siteverify npm start
AI_MODEL=mock-vision npm run test:e2e                    # in another terminal
```

`e2e/mock-stripe.mjs` answers the Stripe API calls the app makes, serves stand-in checkout and billing
portal pages, and sends webhooks signed the way Stripe signs them. `STRIPE_API_BASE` only exists for
it. `e2e/mock-turnstile.mjs` serves a widget script and `siteverify`: only tokens it issued pass, once
each, and it reports which form a token came from (real Turnstile is built to stop automated browsers,
and its test keys accept any token). `TURNSTILE_SCRIPT_URL` and `TURNSTILE_VERIFY_URL` only exist for
it. `e2e/mock-mail.mjs` keeps every email the app sends, for the tests to read codes and links from.

- `e2e/test-landing.mjs` (21 checks): `/` is the prerendered landing page when signed out and the
  drawings when signed in; the $1 membership on the page; headings, landmarks, alt text and keyboard
  focus; the sign-up, login and pricing links; the hero animation's start and end, and reduced motion; no
  sideways scrolling from 360 to 1920 px wide; no console errors or failed requests.
- `e2e/test-billing.mjs` (53 checks): the pricing page for a visitor, an unconfirmed account, a new
  account, a lapsed member and a member, with the steps marked; the landing page's links to it;
  confirming the email leading there, and everything else (the drawings, `/membership`) sending
  non-members there; backing out of Checkout; paying, and the membership being there before the
  webhook arrives; the stored customer, price and renewal date; cancelling, renewing and ending it in
  the billing portal; an editor that's open when the membership ends keeps changes locally and syncs
  them after renewing; failed payments (`past_due` keeps access, `unpaid` doesn't); unsigned, wrongly
  signed and unrelated webhooks; complimentary memberships with `npm run membership`.
- `e2e/test-auth.mjs` (36 checks): the landing page and login redirects when signed out; sign-up
  asking for the emailed code, and the code leading on to the membership page; sign-up validation and
  unique emails;
  the Argon2id hash, the cookie's flags and token format, and SHA-256 secret hash in Postgres; first
  account adopting old drawings; sign-out (session row, cookie, local copies); login with `?next=`
  (and no redirects to other sites); throttled wrong passwords; a second person can't list, open,
  fetch or upload into the first person's drawing; hourly activity refresh, tampered tokens and the
  30-day expiry; the math-check rate limit; cross-site POSTs refused.
- `e2e/test-account.mjs` (42 checks): the CAPTCHA on sign-up, login and forgot password; made-up,
  missing, reused and other-form tokens refused; pressing the button before the check is done. Email
  codes: the email and its link, the SHA-256 in Postgres, nothing else opening (pages or API) until
  confirmed, wrong codes with tries left, the one-minute wait for a new code, old and expired codes,
  5 wrong tries, logging in unconfirmed, the link opened while signed out, `?next=` surviving, and
  `npm run membership` refusing unconfirmed accounts. Password resets: the same answer for unknown
  addresses (and no email), the 256-bit token stored as SHA-256, weak and mismatched passwords,
  signing out everywhere, the old password failing and the new one working, the "password changed"
  email, used and expired links, a squatted address taken back, and the 3-emails-per-address limit.
- `e2e/test.mjs` (35 checks): every tool; select, move, delete and undo, and the outbox holding them
  while the server is unreachable; the stroke eraser; zoom and pan past the first screen; pasted and
  dropped screenshots (IndexedDB, upload, serving); the lasso math check against the mock AI; offline
  edits restored in a new tab.
- `e2e/test-quota.mjs` (17 checks): squeezes the site's quota through the Chrome DevTools Protocol and
  walks the whole fallback chain, including pasting an image when nothing fits locally.
- `e2e/test-input.mjs` (6 checks): real pen pressure, two-finger pinch zoom, and opening a version 1
  drawing.
- `e2e/test-collab.mjs` (37 checks): three people in three browsers. Invite links (members
  only), live edits both ways, cursors, simultaneous moves, per-person undo, live renames, shared
  images, offline edits merging, view-only roles enforced by the server, outsiders getting nothing,
  new links, catching up after the history was pruned, the gallery, removing, leaving and deleting.
- `e2e/test-study.mjs` (43 checks): equations (LaTeX errors, typesetting, chemistry, editing), graphs
  (parse errors, Fit, saving, drawing), the chemistry panel (molar mass, conversion, balancing ionic
  equations, the periodic table), flashcards from a selection, review and scheduling on `/study`,
  editing, starting over, deleting, and privacy.
- `e2e/test-boards.mjs` (53 checks): to-do boards (placing one, adding, opening, editing and
  deleting cards, dragging them between columns, within a column and onto another board as one
  change, dropping off the board, undo, columns, renaming, resizing, the server refusing a bad board);
  GIFs (stored as uploaded, animating, pausing, reduced motion); videos (first frame, play, pause, the
  time, byte ranges, size and type limits in the browser and on the server, a refused upload being
  undone, reloading) and a view-only collaborator playing a video but not moving cards.
- `e2e/test-buddies.mjs` (42 checks): the panda showing up with a greeting once a day, its
  progress card, dragging and arrow keys (remembered after a reload), settings from the account menu
  (another buddy, a name, a colour, the daily goal), hiding, undo and bringing them back; following
  progress (an answer counted, level 2 and its scarf, the daily goal, the end of a round, the streak, a
  to-do card moved to Done counted once); the level on their record (put there as soon as a to-do
  card is finished, left alone by events added behind the app's back until progress is read, then
  put right); and the API (time zones, limits, sign-in and membership).
  Other suites start with buddies hidden (`signUp(page, { buddies: true })` keeps them).
- `e2e/test-wild.mjs` (125 checks): older settings getting the new defaults; level 6 and its bamboo; a
  caught panda keeping its rarity; **Show me** from the card (Bao sprinting all the way across the
  screen and walking back to exactly its spot, a rare panda dancing on the spot, reduced motion);
  the buddy settings' switches in order (walking on drawings needing wandering); buddies climbing onto
  the canvas (inside the board, not over the app), walking about on the part in view and never napping,
  snacking or dancing on the move; a walking panda stopping when pressed and dancing on the spot;
  scrolling the drawing carrying them with it; zooming in and far out changing their size exactly as
  much as the drawing's, on the same spot; staying put while left zoomed out, and drawn right on their
  spots when zoomed back in; panning far away leaving them in their spots, still there on panning back,
  and still there after a reload; keeping off the drawing (stepping off shapes drawn under
  them, never setting foot on them while walking about, Bao's sprint going round them, stepping aside
  when a box is drawn right where one stands, hopping off after being put down on one); a wild panda
  turning up on the canvas (its label, a buddy
  pointing it out); a battle (the intro, the cards, the moves with Bao's own, a turn played on the
  server and shown as the server says, a stale turn and a bad switch refused, bamboo, the catch, the
  collection, the party, bamboo spent, the newcomer saying hello); running away (and closing part-way);
  wandering off when its time is up; the real 60 % chance and the 4-minute wait; a catch waiting at
  home with three out; a new member at level 1 (on their record) whose first look starts the clock
  and who then meets a common panda of level 1 or 2; the API's checks (404, 409, 410, 422, 401, 402,
  someone else's panda, wild pandas switched off, caught pandas that aren't yours or come twice); `/buddies`
  (the party, every catch, the field guide's levels, bamboo, **Out with you**); the Settings page's
  switches; the account menu opening `/buddies` where no buddies are out; and the rules admins set
  (switched off for everyone: none turn up, the wait isn't used up and the buddies are told; only
  golden pandas, from level 1, every time: none before the 2-minute wait, then one at once of that kind,
  staying the minute set, battling with the catch and run-off chances set; the field guide and its
  catching steps following along).
- `e2e/test-admin.mjs` (64 checks): `npm run role` (and its refusal for unconfirmed emails); `/admin`
  is a 404 for users and leads unconfirmed accounts to confirm first, and staff get the sidebar and
  menu links; the totals; search as you type in the address without filling the history; newest first;
  ← 1 2 3 4 5 →, page 2, Next, the window sliding (3–7 on page 5, 5–9 on the last), reload, Back,
  a page past the end, no matches; the role filter and the status totals as filters; the edit panel
  in the address and surviving a reload, with the study level on their record; saving a name (with the audit row and the history), a taken
  email, a new email, unconfirming, complimentary memberships, closing; changing roles, which take
  effect on the next page, and not your own; signing someone out everywhere and emailing a reset link.
  Support: searching, fixing a name and giving memberships, but not emails, roles or staff accounts,
  even with the fields unlocked in the browser or the form pointed at another account; an admin
  whose role is removed mid-session; and **Wild pandas** (the defaults, each kind's share, Save off until
  something changes, the summary and shares following what's typed, saving for everyone with who and
  what it adds up to, a number out of range refused by name, every kind set to never refused,
  switching them off, Reset to defaults, and support staff not getting it).
- `e2e/test-seasons.mjs` (26 checks): Automatic on a December, October, Easter-week and July day (the
  browser's clock moved to each); snow, bats and petals; the landing page staying prerendered; an
  admin choosing Christmas in July, stored with who changed it, on the landing and pricing pages;
  hiding the decorations and it being remembered; reduced motion; the menu's snow, candy canes and
  striped edge, Halloween's bats and Easter's petals there; nothing falling in the editor; the account
  menu's switch; Off; and only admins changing the setting, checked on the server.
- `e2e/test-settings.mjs` (42 checks): Settings from the account menu; a blank name refused,
  a new one saved and in the menu straight away; a file that isn't a picture turned away; a photo
  cropped to its middle as a 256 px WebP, stored, shown in the menu, served with its type, `nosniff`
  and a private per-version cache, and not to anyone signed out; choosing Trace and turning off board
  effects, kept after a reload; a drawing tracing itself in as it opens (sampled frame by frame) and
  appearing at once with effects off; a dragged to-do card still gliding just after the drop, and
  settled at once with board effects off; staff seeing and taking down a picture (with the history);
  removing your own; and the landing page's sections sliding in and back out as they're scrolled to and
  away, with nothing hidden in its HTML.

`npm run test:unit` runs quick checks of the chemistry parser and balancer, the graph expression
parser, the collaboration model (two simulated tabs against a fake server), to-do board layout and card
moves, Range header parsing, study buddy levels, streaks, lines and finished tasks, rarities (their
levels and how often each turns up), the wild pandas' rules (defaults, stored values falling back one
at a time, the admin form's numbers and its refusals, shares, how far apart, what browsers are told,
level-up lines that follow them, battles keeping their rates), wild pandas' levels, starter tricks,
bamboo, and the battle engine
(stats, who goes first, catching, switching, winning, losing, running, fleeing, and 300 random battles
that all end with energy in range), the pandas' path-finding (blocked spots, the way round a wall
through its gap checked every step of the way, no way through a wall without one, the nearest clear
spot, pen strokes cut into pieces so a drawn circle's middle is clear, erasers ignored), the seasonal
themes' dates (Easter Sundays from 2024 to 2285, and each theme's first and last day), the admin
dashboard's address handling and five-page window, the settings' parsing, profile picture URLs and type
sniffing, and the drawing and to-do board effects (what replays, what waits, ghosts, glides from a
drop, a moved board's cards not lagging), without a browser.

Each suite signs up its own account first (with a complimentary membership, except where the
membership is what's being tested). They need Chrome (`CHROME_PATH` if it isn't
`/usr/bin/google-chrome`) and `psql`, and create accounts and drawings in the database from
`DATABASE_URL`, so use a dev database.

## Notes for building on this

- **Not built yet:** two-factor sign-in and changing the email address (the Lucia guide has recipes
  for both; a changed address would need confirming again, which `email_verified` and the codes table
  already support). There's no "delete my account" either; if you add one, cancel the person's Stripe
  subscription first, or Stripe keeps charging them.
- **Rate limits live in memory**, so they reset on restart and aren't shared between server
  processes. Move them to Redis or Postgres if you run more than one.
- **Client IP** for rate limits comes from `X-Forwarded-For`. Deploy behind a proxy that sets it
  (Vercel, Fly, nginx); otherwise people could set it themselves to dodge the per-IP limits.
- **Next.js 16 Cache Components** is on. Database reads call `await io()` and render inside
  `<Suspense>`, so they run per request.
- **Images and videos live in Postgres** (bytea) to keep setup to one service, with the limits above.
  For heavy video use, move them to S3 or R2: `src/app/api/drawings/[id]/assets` and
  `src/app/api/assets/[id]` are the only places to change. Files stay until their drawing is deleted,
  even after they're taken off the canvas (undo can bring them back).
- **Uploads pass through `src/proxy.ts`**, and Next keeps only `experimental.proxyClientMaxBodySize`
  of a request body for it (52 MB in `next.config.ts`, for 50 MB videos). Raise both together.
- **Live collaboration needs a long-running server** (`next start`, a container, a VM): the event
  stream is a response that stays open, which serverless functions cut off. Each server process opens
  one extra Postgres connection for `LISTEN`; behind a proxy, make sure it doesn't buffer
  `text/event-stream` responses (the app sends `X-Accel-Buffering: no` for nginx).
- **Strokes appear for others when they're finished**, not while they're being drawn; cursors move
  live.
- `npm audit` flags esbuild's dev server, pulled in by `drizzle-kit`; drizzle-kit doesn't run it.
