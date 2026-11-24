import { Check, Cloud, HardDrive, Minus, Plus } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import editorScreenshot from "@/components/landing/editor.webp";
import { HeroDemo } from "@/components/landing/hero-demo";
import { Button, Kbd } from "@/components/kit";
import { MEMBERSHIP, MEMBERSHIP_INCLUDES } from "@/lib/billing/plan";
import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";
import { SeasonalBoardDecor, SeasonalEffects } from "@/components/seasonal/site-decor";
import {
  DOT_GRID,
  INNER,
  OUTER,
  SignedOutLinks,
  SiteFooter,
  SiteHeader,
  linkFocus,
} from "@/components/landing/site-chrome";

/**
 * The landing page. src/proxy.ts serves it at "/" to visitors without a
 * session (signed-in people get their drawings there instead), and it is
 * always reachable at /welcome. It reads no request data, so it's built once
 * as static HTML. The price comes from src/lib/billing/plan.ts.
 */

export const metadata: Metadata = {
  title: "canvas: sketch it, paste it, check it",
  description:
    `An infinite canvas for notes, math and chemistry. Write by hand or paste a screenshot, check each step with AI, work on it with classmates live and turn it into flashcards. Membership is ${MEMBERSHIP.price} ${MEMBERSHIP.per}.`,
};

const TOOLS = [
  { name: "Pen", keys: ["P"], text: "Ink that follows pen pressure, plus a marker and a highlighter." },
  {
    name: "Shapes",
    keys: ["L", "A", "R", "O"],
    text: "Lines, arrows, rectangles and ellipses. Turn on Sketchy for a hand-drawn look.",
  },
  { name: "Text", keys: ["T"], text: "Type in handwriting, sans or mono." },
  {
    name: "Images and video",
    keys: ["I"],
    text: "Paste or drop a screenshot, a GIF or a short video clip. GIFs keep moving; click a video to play it.",
  },
  { name: "Lasso", keys: ["S"], text: "Loop around anything to move, copy or check it." },
  { name: "Pan and zoom", keys: ["H", "Space"], text: "Drag the page around, pinch, or scroll with Ctrl or ⌘ held." },
  {
    name: "Equations",
    keys: ["M"],
    text: "Type LaTeX, or chemistry like 2H2 + O2 -> 2H2O, and it's typeset on the page.",
  },
  { name: "Graphs", keys: ["G"], text: "Plot up to six functions of x, like sin x or x^2 − 3x, and set the window." },
  {
    name: "To-do boards",
    keys: ["K"],
    text: "To do, Doing and Done columns right next to your notes. Drag a card along as you work through it.",
  },
];

const TOGETHER = [
  {
    title: "Draw together, live",
    text: "Share a drawing with a link. Everyone on it sees each stroke land and each cursor move, and undo only takes back your own work. Give edit or view access; only members can open shared drawings.",
  },
  {
    title: "Chemistry at hand",
    text: "Molar masses with a grams-to-moles converter, a balancer that handles ions and half equations, and a periodic table with IUPAC atomic weights. Put any result on the canvas.",
  },
  {
    title: "Flashcards from your notes",
    text: "Select part of a drawing and choose Flashcard: your work becomes the answer. Each card comes back just before you'd forget it, sooner if you didn't know it.",
  },
];

const CHECK_STEPS = [
  {
    title: "Press Check math",
    text: "It's at the top of every drawing, and on the toolbar above anything you select.",
  },
  { title: "Loop around the working", text: "Handwriting, typed text and pasted screenshots all work." },
  { title: "Read the verdict", text: "See what was read, which steps hold up, and what the wrong line should be." },
  { title: "Keep it on the page", text: "Add note to canvas writes the verdict next to your work." },
];

const SAVE_STEPS = [
  {
    when: "Instantly",
    text: "Each stroke, shape, line of text and pasted image is kept in your browser until your account has it.",
  },
  {
    when: "A moment later",
    text: "It reaches your account, ready on any device you log in from, and on the screens of anyone you share it with.",
  },
  {
    when: "If something goes wrong",
    text: "Offline, or closed the tab too soon? Unsynced changes come back the next time you open the drawing. If browser storage fills up, canvas clears copies the server already has and keeps saving.",
  },
];

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-[34px] leading-[1.1] font-bold tracking-[-0.02em] text-balance sm:text-[40px]">
      {children}
    </h2>
  );
}

/** A cursor arrow with its owner's name, as collaborators see each other. */
function Cursor({ name, color, className }: { name: string; color: string; className: string }) {
  return (
    <span className={cn("absolute flex flex-col items-start", className)}>
      <svg width="16" height="22" viewBox="0 0 16 22" className="drop-shadow-sm">
        <path d="M1 1v17l4.6-4.4 3 6.8 3-1.3-2.9-6.5h6.3z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="ml-3 -mt-1 rounded-md px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: color }}>
        {name}
      </span>
    </span>
  );
}

/** A still from a shared drawing: two people at work, a balanced equation, a flashcard made from it. */
function TogetherScene() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-xl bg-white p-6 ring-1 ring-grey-900/5 sm:min-h-[460px] sm:p-10"
      style={DOT_GRID}
    >
      <p className="inline-block rounded-lg bg-grey-900 px-3 py-1.5 text-xs font-semibold text-white">
        CuSO<sub>4</sub>·5H<sub>2</sub>O = 249.677 g/mol
      </p>
      <p className="mt-10 font-serif text-[26px] whitespace-nowrap text-grey-900 sm:text-[34px]">
        4Fe + 3O<sub>2</sub> <span className="px-1">⟶</span> 2Fe<sub>2</sub>O<sub>3</sub>
      </p>
      <svg viewBox="0 0 300 24" className="mt-1 h-5 w-[230px] sm:w-[300px]" fill="none">
        <path d="M4 14 C 60 6, 140 20, 296 9" stroke="#277c78" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <Cursor name="Maya" color="#277c78" className="top-[160px] left-[66%] sm:top-[150px] sm:left-[62%]" />

      <svg viewBox="0 0 220 110" className="mt-8 h-[90px] w-[180px] sm:h-[110px] sm:w-[220px]" fill="none">
        <path d="M6 55 H214 M110 6 V104" stroke="#b3b3b3" strokeWidth="1.5" />
        <path
          d="M6 55 C 30 10, 52 10, 76 55 S 122 100, 146 55 S 192 10, 214 40"
          stroke="#3f82b2"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
      <Cursor name="Alex" color="#c94736" className="top-[250px] left-[40%] sm:top-[300px] sm:left-[30%]" />

      <div className="relative mt-8 ml-auto w-full max-w-[270px] rounded-xl bg-white p-4 shadow-float ring-1 ring-grey-900/5 sm:absolute sm:right-8 sm:bottom-8 sm:mt-0 sm:w-[270px]">
        <p className="text-xs text-grey-500">Flashcard</p>
        <p className="mt-1 text-[15px] leading-snug font-bold">Balance the rusting of iron</p>
        <div className="mt-4 grid grid-cols-3 gap-1.5 text-center text-[11px] font-bold text-white">
          <span className="rounded-md bg-red py-1.5">
            Again
            <span className="block font-normal opacity-80">10 min</span>
          </span>
          <span className="rounded-md bg-grey-900 py-1.5">
            Good
            <span className="block font-normal opacity-80">1 day</span>
          </span>
          <span className="rounded-md bg-green py-1.5">
            Easy
            <span className="block font-normal opacity-80">3 days</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader account={<SignedOutLinks />} />

      <main className="flex-1">
        {/* ------------------------------------------------------------ hero: a piece of canvas */}
        <section aria-labelledby="hero-title" className="px-3 sm:px-6">
          <div className="relative mx-auto max-w-[1392px] overflow-hidden rounded-xl bg-white" style={DOT_GRID}>
            <SeasonalBoardDecor />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-12 px-5 pt-10 pb-14 sm:px-12 sm:pt-14 sm:pb-20 xl:grid-cols-[minmax(0,1fr)_632px] xl:items-center xl:gap-10 xl:px-16 xl:pt-20 xl:pb-24">
              <div>
                <h1
                  id="hero-title"
                  className="text-[46px] leading-none font-extrabold tracking-[-0.035em] sm:text-[64px] xl:text-[72px]"
                >
                  <span className="block">Sketch it,</span>
                  <span className="block">paste it,</span>
                  <span className="block">check it</span>
                </h1>
                <p className="mt-7 max-w-[30rem] text-lg leading-relaxed text-grey-500 sm:text-xl sm:leading-relaxed">
                  An infinite canvas for notes, math and chemistry. Write by hand or paste a screenshot, loop around your
                  working, and AI checks each step.
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <Button asChild size="xl">
                    <Link href="/signup">Create account</Link>
                  </Button>
                  <Button asChild variant="secondary" size="xl">
                    <Link href="/login">Log in</Link>
                  </Button>
                </div>
                <p className="mt-4 text-sm text-grey-500">
                  {MEMBERSHIP.price} {MEMBERSHIP.per}. Cancel any time.{" "}
                  <Link href="/pricing" className={cn(linkFocus, "font-bold text-grey-900 underline underline-offset-4")}>
                    See what&apos;s included
                  </Link>
                </p>
              </div>

              <HeroDemo />
            </div>

            {/* The editor's zoom control, for the feel of the real thing */}
            <div
              aria-hidden
              className="absolute right-5 bottom-5 hidden items-center gap-5 rounded-lg bg-white px-3.5 py-2 text-sm shadow-float md:flex"
            >
              <Minus className="size-4" />
              <span className="tabular-nums">100%</span>
              <Plus className="size-4" />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ tools */}
        <section aria-labelledby="tools-title" className={cn(OUTER, "py-20 sm:py-28")}>
          <div className={INNER}>
            <div className="grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-16">
              <Reveal>
                <SectionHeading id="tools-title">A canvas that keeps going</SectionHeading>
                <p className="mt-4 text-lg leading-relaxed text-grey-500">
                  Pan in any direction and zoom from a whole page of notes down to a single digit. There&apos;s no edge
                  to run into.
                </p>
              </Reveal>
              <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
                {TOOLS.map((tool, i) => (
                  <Reveal key={tool.name} delay={(i % 3) * 0.06}>
                    <dt className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-bold">
                      {tool.name}
                      <span className="flex gap-1">
                        {tool.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                    </dt>
                    <dd className="mt-1.5 text-[15px] leading-relaxed text-grey-500">{tool.text}</dd>
                  </Reveal>
                ))}
              </dl>
            </div>

            <Reveal className="mt-14">
              <Image
                src={editorScreenshot}
                alt="The canvas editor: the tool sidebar, pen options, a pasted textbook example with a highlight and a red note, handwritten working with a boxed answer, and a hand-drawn graph."
                sizes="(min-width: 1392px) 1216px, (min-width: 640px) calc(100vw - 144px), calc(100vw - 64px)"
                placeholder="blur"
                className="h-auto w-full rounded-xl shadow-float ring-1 ring-grey-900/10"
              />
            </Reveal>
          </div>
        </section>

        {/* ------------------------------------------------------------ checking */}
        <section aria-labelledby="check-title" className={cn(OUTER, "pb-20 sm:pb-28")}>
          <div className={INNER}>
            <Reveal className="max-w-[40rem]">
              <SectionHeading id="check-title">Find the step that went wrong</SectionHeading>
              <p className="mt-4 text-lg leading-relaxed text-grey-500">
                A right or wrong answer only gets you so far. canvas reads your working line by line, marks each step,
                and shows what the line that slipped should say.
              </p>
            </Reveal>

            <ol className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 xl:grid-cols-4">
              {CHECK_STEPS.map((step, i) => (
                <Reveal as="li" key={step.title} delay={i * 0.06}>
                  <span className="grid size-8 place-items-center rounded-full bg-grey-900 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-bold">{step.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-grey-500">{step.text}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ together + study */}
        <section aria-labelledby="together-title" className={cn(OUTER, "pb-20 sm:pb-28")}>
          <div className={INNER}>
            <div className="grid gap-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center lg:gap-16">
              <Reveal>
                <SectionHeading id="together-title">Study it together, then remember it</SectionHeading>
                <ul className="mt-8 space-y-7">
                  {TOGETHER.map((item) => (
                    <li key={item.title}>
                      <h3 className="font-bold">{item.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-grey-500">{item.text}</p>
                    </li>
                  ))}
                </ul>
              </Reveal>
              <Reveal>
                <TogetherScene />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ saving */}
        <section aria-labelledby="saving-title" className={cn(OUTER, "pb-20 sm:pb-28")}>
          <div className={INNER}>
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
              <Reveal>
                <SectionHeading id="saving-title">Saved the moment you lift the pen</SectionHeading>
                <p className="mt-4 max-w-[34rem] text-lg leading-relaxed text-grey-500">
                  There&apos;s no save button. Every drawing shows where your work is safe, the same way it does here.
                </p>
                <div
                  aria-hidden
                  className="mt-8 inline-flex items-center gap-5 rounded-lg bg-white px-4 py-3 text-sm font-bold"
                >
                  <span className="flex items-center gap-2">
                    <HardDrive className="size-4" /> Saved here
                  </span>
                  <span className="flex items-center gap-2">
                    <Cloud className="size-4" /> Synced
                  </span>
                </div>
                <p className="mt-8 max-w-[34rem] text-[15px] leading-relaxed text-grey-500">
                  Drawings are private to your account until you share them. Passwords are only ever stored as Argon2id
                  hashes, and you stay logged in until you&apos;ve been away for 30 days.
                </p>
              </Reveal>

              <ol className="space-y-9 border-l-2 border-grey-900/10 pl-8 lg:mt-3">
                {SAVE_STEPS.map((step, i) => (
                  <Reveal as="li" key={step.when} delay={i * 0.06} className="relative">
                    <span
                      aria-hidden
                      className="absolute top-1 -left-[41px] size-4 rounded-full border-[3px] border-background bg-green"
                    />
                    <h3 className="font-bold">{step.when}</h3>
                    <p className="mt-1.5 max-w-[34rem] text-[15px] leading-relaxed text-grey-500">{step.text}</p>
                  </Reveal>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ membership */}
        <section aria-labelledby="start-title" className="px-3 sm:px-6">
          <Reveal className="mx-auto grid max-w-[1392px] gap-12 rounded-xl bg-grey-900 px-5 py-14 text-white sm:px-12 sm:py-16 lg:grid-cols-2 lg:items-center xl:px-16 xl:py-20">
            <div>
              <h2
                id="start-title"
                className="text-[34px] leading-[1.1] font-bold tracking-[-0.02em] text-balance sm:text-[40px]"
              >
                One membership, {MEMBERSHIP.price} {MEMBERSHIP.per}
              </h2>
              <p className="mt-4 max-w-[28rem] text-lg leading-relaxed text-grey-300">
                Everything on this page is included. Get your membership, and your first drawing is one click away.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild variant="light" size="xl">
                  <Link href="/pricing">Get membership</Link>
                </Button>
                <Link
                  href="/login"
                  className={cn(
                    linkFocus,
                    "px-3 py-2 text-sm font-bold underline underline-offset-4 hover:text-grey-300",
                  )}
                >
                  Log in
                </Link>
              </div>
            </div>

            <div className="rounded-xl bg-white/[0.06] p-6 ring-1 ring-white/10 sm:p-8">
              <p className="flex items-baseline gap-2">
                <span className="text-[56px] leading-none font-extrabold tracking-[-0.03em]">{MEMBERSHIP.price}</span>
                <span className="text-lg text-grey-300">{MEMBERSHIP.per}</span>
              </p>
              <ul className="mt-6 space-y-3">
                {MEMBERSHIP_INCLUDES.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-relaxed text-grey-300">
                Billed monthly through Stripe, in US dollars. If you cancel, your drawings are kept for when you come
                back.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
      <SeasonalEffects />
    </div>
  );
}
