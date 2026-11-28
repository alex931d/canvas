// Unit checks for the pure parts of the new features: the chemistry
// parser, molar masses and the balancer, the graph expression parser, the
// collaboration document model (two simulated tabs and a fake server),
// to-do board layout and card moves, byte ranges for video, the schemas,
// the study buddies' levels, streaks and lines, the seasonal themes' dates,
// tracing pictures into strokes, frames as slides (order, what a frame
// carries, the journey's camera path), who may do what in a team workspace,
// the board's own parts (the camera, drawing a stroke or shape, keys, the
// clipboard, the tool registry), and the free plan (what needs the
// membership, saving in the browser).
//   npm run test:unit
import { balanceEquation } from "../src/lib/chem/balance";
import { ELEMENTS } from "../src/lib/chem/elements";
import { molarMass, parseSpecies, speciesToMhchem, speciesToText } from "../src/lib/chem/formula";
import { elementBox, hitTest, insideFrame, scaleElement, slidesOf } from "../src/lib/canvas/geometry";
import { cameraFor, flight, journeyVeil, reorderSlides, slideRect } from "../src/lib/canvas/present";
import { assignableRoles, canManageMember, drawingRoleFrom } from "../src/lib/workspaces/roles";
import { Camera } from "../src/components/editor/board/camera";
import { BoardClipboard, cloneElements } from "../src/components/editor/board/clipboard";
import { DraftSession } from "../src/components/editor/board/drafts";
import { frameBox, nextSlide, withFrameContents } from "../src/components/editor/board/frames";
import { Shortcuts } from "../src/components/editor/board/shortcuts";
import { DraftOutbox, MAX_PIECE_COORDS, PeerDrafts } from "../src/lib/collab/peer-drafts";
import { initials } from "../src/components/editor/board/avatars";
import { DEFAULT_STYLE, ToolRegistry } from "../src/components/editor/tools";
import {
  addColumn,
  dropSlot,
  findCard,
  finishedCards,
  kanbanLayout,
  kanbanMinWidth,
  kanbanPartAt,
  moveCard,
  newKanban,
  progress,
  removeColumn,
  wrapText,
} from "../src/lib/canvas/kanban";
import {
  assetIdsOf,
  DEFAULT_PRESENTATION,
  elementSchema,
  normalizePresentation,
  type CanvasElement,
  type FrameElement,
  type KanbanElement,
} from "../src/lib/canvas/schema";
import { parseRange } from "../src/lib/http/range";
import { buildGrid, clearLine, edgeSpots, findPath, freeSpots, isFree, nearestFree, obstaclesOf, pathClear, touchesDrawing } from "../src/lib/buddy/pathing";
import { afterReview, levelUp } from "../src/lib/buddy/lines";
import { accessoriesFor, DEFAULT_SETTINGS, levelFor, settingsSchema, streakFrom, type Progress } from "../src/lib/buddy/shared";
import { CollabDoc, type RemoteChange } from "../src/lib/collab/doc";
import { canUse, MEMBER_FEATURES } from "../src/lib/billing/plan";
import { redisUrl } from "../src/lib/redis-url";
import { envValue, redactSecrets } from "../src/lib/env-value";
import { aiMonthlyLimit, allowance, allowanceResetsAt, allowanceUsedMessage, usageMonth } from "../src/lib/billing/ai-allowance";
import { parseJsonReply } from "../src/lib/ai/json-reply";
import { applyOps, type DocOp } from "../src/lib/collab/ops";
import { compileExpression, ExprError, formatTick, niceStep } from "../src/lib/math/expr";
import { easterSunday, resolveTheme, themeForDate } from "../src/lib/seasons";
import { adminHref, pageWindow, parseAdminQuery } from "../src/lib/admin/query";
import { ElementEffects, inkLength, MAX_ANIMATED, staggerStep, traceDuration } from "../src/lib/canvas/effects";
import { KanbanEffects } from "../src/lib/canvas/kanban-fx";
import { DEFAULT_PREFERENCES, parsePreferences } from "../src/lib/preferences";
import { act, BattleError, catchChance, makeFighter, ratesOf, startBattle, viewOf, type BattleState } from "../src/lib/buddy/battle";
import { ABILITY_POOL, bambooFor, DEFAULT_KINDS, pickRarity, raritiesAt, rollWild, starterAbility } from "../src/lib/buddy/kinds";
import { apartText, DEFAULT_RULES, firstLevel, openingsOf, rulesFrom, rulesFromForm, sharesAt } from "../src/lib/buddy/rules";
import { avatarUrl, sniffImageType } from "../src/lib/profile/avatar";
import { solveTriangle, triangleCorners } from "../src/lib/math/triangle";
import { exactTrig, parseAngle, radiansTex, referenceAngle, unitPoint } from "../src/lib/math/trig";
import { lintProof, normalizeStatement, parseProofVerdict, proofToText } from "../src/lib/math/proof";
import { stoichiometry } from "../src/lib/chem/stoich";
import { isProblem, parseWorksheetReply, problemsFromElements, shuffled, withAnswers } from "../src/lib/math/worksheet";
import { proofFigure, triangleFigure, unitCircleFigure, worksheetFigure, PAGE } from "../src/lib/math/figures";
import { stepsToTex } from "../src/lib/math/steps";
import { combinedGas, idealGas } from "../src/lib/chem/gas";
import { dilution, molarity, ph } from "../src/lib/chem/solution";
import { findInk, simplify, traceStrokes, type Pixels } from "../src/lib/canvas/trace";

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const near = (label: string, got: number, want: number, tol = 1e-3) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  got ${got} want ${want}`}`);
};

eq("118 elements", ELEMENTS.length, 118);
eq("unique symbols", new Set(ELEMENTS.map((e) => e.symbol)).size, 118);
const mm = (f: string) => molarMass(parseSpecies(f).counts).total;
near("H2O", mm("H2O"), 18.015);
near("CO2", mm("CO2"), 44.009);
near("NaCl", mm("NaCl"), 58.44, 0.01);
near("C6H12O6", mm("C6H12O6"), 180.156);
near("Ca(OH)2", mm("Ca(OH)2"), 74.092);
near("CuSO4·5H2O", mm("CuSO4·5H2O"), 249.68, 0.01);
near("CuSO4.5H2O", mm("CuSO4.5H2O"), 249.68, 0.01);
near("K4[Fe(CN)6]", mm("K4[Fe(CN)6]"), 368.35, 0.01);
near("(NH4)2SO4", mm("(NH4)2SO4"), 132.14, 0.01);
near("Fe2(SO4)3", mm("Fe2(SO4)3"), 399.858);
const s1 = parseSpecies("Fe3+"); eq("Fe3+ charge", [s1.body, s1.charge], ["Fe", 3]);
const s2 = parseSpecies("NO3-"); eq("NO3- charge", [s2.body, s2.charge], ["NO3", -1]);
const s3 = parseSpecies("SO42-"); eq("SO42-", [s3.body, s3.charge], ["SO4", -2]);
const s4 = parseSpecies("SO4^2-"); eq("SO4^2-", [s4.body, s4.charge], ["SO4", -2]);
const s5 = parseSpecies("Fe^{3+}"); eq("Fe^{3+}", [s5.body, s5.charge], ["Fe", 3]);
const s6 = parseSpecies("Fe+3"); eq("Fe+3", [s6.body, s6.charge], ["Fe", 3]);
const s7 = parseSpecies("2H2O(l)"); eq("2H2O(l)", [s7.coefficient, s7.body, s7.state], [2, "H2O", "l"]);
const s8 = parseSpecies("SO₄²⁻"); eq("unicode SO4 2-", [s8.body, s8.charge], ["SO4", -2]);
const s9 = parseSpecies("Hg22+"); eq("Hg22+", [s9.body, s9.charge], ["Hg2", 2]);
const s10 = parseSpecies("e-"); eq("electron", [s10.isElectron, s10.charge], [true, -1]);
const err = (f: string) => { try { parseSpecies(f); return "no error"; } catch (e) { return (e as Error).message; } };
eq("lowercase hint", err("h2o"), 'Element symbols start with a capital letter: try "H".');
eq("unknown", err("Xq2"), '"Xq" isn\'t an element symbol.');
eq("unclosed", err("Ca(OH2"), 'A bracket is never closed: add ")".');
eq("mhchem", speciesToMhchem(parseSpecies("SO42-")), "SO4^{2-}");
eq("text", speciesToText(parseSpecies("SO42-")), "SO₄²⁻");
eq("text hydrate", speciesToText(parseSpecies("CuSO4·5H2O")), "CuSO₄·5H₂O");

const b = (e: string) => { const r = balanceEquation(e); return r.ok ? r.text : "ERR: " + r.error; };
eq("rust", b("Fe + O2 -> Fe2O3"), "4Fe + 3O₂ → 2Fe₂O₃");
eq("water", b("H2 + O2 -> H2O"), "2H₂ + O₂ → 2H₂O");
eq("water no spaces", b("H2+O2->H2O"), "2H₂ + O₂ → 2H₂O");
eq("combustion", b("C3H8 + O2 → CO2 + H2O"), "C₃H₈ + 5O₂ → 3CO₂ + 4H₂O");
eq("existing coefficients ignored", b("2H2 + 2O2 = 2H2O"), "2H₂ + O₂ → 2H₂O");
eq("haber", b("N2 + H2 <=> NH3"), "N₂ + 3H₂ ⇌ 2NH₃");
eq("redox ionic", b("MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O"), "MnO₄⁻ + 5Fe²⁺ + 8H⁺ → Mn²⁺ + 5Fe³⁺ + 4H₂O");
eq("half reaction", b("Fe3+ + e- -> Fe2+"), "Fe³⁺ + e⁻ → Fe²⁺");
eq("states", b("Ag+(aq) + Cl-(aq) -> AgCl(s)"), "Ag⁺(aq) + Cl⁻(aq) → AgCl(s)");
eq("dichromate", b("Cr2O72- + H+ + I- -> Cr3+ + I2 + H2O"), "Cr₂O₇²⁻ + 14H⁺ + 6I⁻ → 2Cr³⁺ + 3I₂ + 7H₂O");
eq("glucose", b("C6H12O6 + O2 -> CO2 + H2O"), "C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O");
eq("KMnO4 HCl", b("KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2"), "2KMnO₄ + 16HCl → 2KCl + 2MnCl₂ + 8H₂O + 5Cl₂");
eq("one side only", b("H2 + O2 -> NaCl"), "ERR: H appears only on the left, so this can't balance. Check the formulas.");
eq("no arrow", b("H2 + O2"), "ERR: Put an arrow between reactants and products, like H2 + O2 -> H2O.");
eq("ambiguous", b("H2 + O2 -> H2O + H2O2"), "ERR: There's more than one way to balance this. It may be two reactions in one: balance them separately.");
const r = balanceEquation("Fe + O2 -> Fe2O3");
eq("mhchem out", r.ok && r.mhchem, "4Fe + 3O2 -> 2Fe2O3");
eq("rows", r.ok && r.rows, [{ symbol: "Fe", left: 4, right: 4 }, { symbol: "O", left: 6, right: 6 }]);

const f = (src: string, x: number) => compileExpression(src)(x);
near("x^2-3x+2 at 3", f("x^2 - 3x + 2", 3), 2);
near("y= prefix", f("y = 2x + 1", 2), 5);
near("sin x", f("sin x", Math.PI / 2), 1);
near("2sin(3x)", f("2sin(3x)", Math.PI / 6), 2);
near("sin^2 x + cos^2 x", f("sin^2 x + cos^2 x", 0.7), 1);
near("sin^-1(x)", f("sin^-1(x)", 1), Math.PI / 2);
near("|x - 1|", f("|x - 1|", -2), 3);
near("2|x|", f("2|x|", -2), 4);
near("e^(-x^2)", f("e^(-x^2)", 1), Math.exp(-1));
near("-x^2", f("-x^2", 3), -9);
near("2^-1", f("2^-1", 0), 0.5);
near("x(x+1)", f("x(x+1)", 2), 6);
near("(x+1)(x-1)", f("(x+1)(x-1)", 3), 8);
near("ln x", f("ln x", Math.E), 1);
near("log(2, x)", f("log(2, x)", 8), 3);
near("log x", f("log x", 1000), 3);
near("sqrt x + 1", f("sqrt x + 1", 4), 3);
near("sinx", f("sinx", Math.PI / 2), 1);
near("xsinx", f("xsinx", Math.PI / 2), Math.PI / 2);
near("pix", f("pix", 2), 2 * Math.PI);
near("sin x cos x", f("sin x cos x", Math.PI / 4), 0.5);
near("3.5e-2x", f("3.5e-2x", 100), 3.5);
near("2e", f("2e", 0), 2 * Math.E);
near("x2", f("x2", 3), 6);
near("1/x", f("1/x", 4), 0.25);
near("x/2/2", f("x/2/2", 8), 2);
near("2^3^2", f("2^3^2", 0), 512);
near("√x", f("√x", 9), 3);
near("π", f("π x", 1), Math.PI);
near("min", f("max(x, 2)", 1), 2);
near("f(x)=", f("f(x) = 3", 0), 3);
const xe = (src: string) => { try { compileExpression(src); return "no error"; } catch (e) { return e instanceof ExprError ? e.message : "OTHER " + e; } };
eq("y var", xe("x + y"), 'Write the function of x only, like "x^2 + 1".');
eq("t var", xe("t^2"), 'Use x as the variable ("t" isn\'t defined).');
eq("misspelt fn", xe("sinn(x)"), "\"sinn\" isn't a function I know. Try sin, cos, sqrt, ln, log, abs or exp.");
eq("unknown fn", xe("foo(x)"), '"foo" isn\'t a function I know. Try sin, cos, sqrt, ln, log, abs or exp.');
eq("unclosed", xe("sin(x"), '"sin(" is never closed: add ")".');
eq("dangling", xe("x +"), "The function ends too early: something is missing at the end.");
eq("bad char", xe("x # 2"), '"#" can\'t be used here.');
eq("empty", xe(""), "Type a function of x, like x^2 or sin(x).");
eq("niceStep", [niceStep(20), niceStep(1), niceStep(7)], [2, 0.1, 1]);
eq("formatTick", [formatTick(0.30000000000000004, 0.1), formatTick(-2, 1), formatTick(1e-17, 0.5)], ["0.3", "−2", "0.0"]);


// ------------------------------------------------ collaboration model

const t = (id: string, text = id) => ({ id, type: "text" as const, x: 0, y: 0, text, color: "#000000", fontSize: 20, font: "sans" as const });
const ids = (els: { id: string }[]) => els.map((e) => e.id).join("");

// applyOps basics
eq("append", ids(applyOps([t("a")], [{ t: "add", el: t("b") }])), "ab");
eq("anchored chain", ids(applyOps([t("x"), t("y")], [{ t: "add", el: t("a"), after: "x" }, { t: "add", el: t("b"), after: "a" }])), "xaby");
eq("bottom", ids(applyOps([t("x")], [{ t: "add", el: t("a"), after: null }])), "ax");
eq("missing anchor -> top", ids(applyOps([t("x")], [{ t: "add", el: t("a"), after: "zz" }])), "xa");
eq("set missing ignored", ids(applyOps([t("x")], [{ t: "set", el: t("q") }])), "x");
eq("del", ids(applyOps([t("x"), t("y")], [{ t: "del", id: "x" }])), "y");
const big = Array.from({ length: 20000 }, (_, i) => t("e" + i));
const t0 = Date.now();
const cleared = applyOps(big, big.map((e) => ({ t: "del" as const, id: e.id })));
const restored = applyOps(cleared, big.map((e, i) => ({ t: "add" as const, el: e, after: i ? big[i - 1].id : null })));
eq("20k clear+restore order", restored.map((e) => e.id).join(",") === big.map((e) => e.id).join(","), true);
console.log("   (20k clear+restore took", Date.now() - t0, "ms)");

// Two docs + a fake server
let serverEls: CanvasElement[] = [t("base")];
let version = 0;
const log: RemoteChange[] = [];
const A = new CollabDoc({ elements: serverEls, version });
const B = new CollabDoc({ elements: serverEls, version });
const send = (doc: CollabDoc) => {
  const res = doc.unsent().map((b) => {
    serverEls = applyOps(serverEls, b.ops);
    version++;
    log.push({ v: version, b: b.id, ops: JSON.parse(JSON.stringify(b.ops)) as DocOp[] });
    return { id: b.id, version };
  });
  doc.acknowledge(res);
};
const deliver = (doc: CollabDoc) => { for (const c of log) doc.applyRemote(c); };

A.dispatch({ type: "add", elements: [t("a1")] });
B.dispatch({ type: "add", elements: [t("b1")] });
eq("A shows own change", ids(A.elements), "basea1");
send(A); send(B);
deliver(A); deliver(B);
eq("converge after concurrent adds A", ids(A.elements), "basea1b1");
eq("converge after concurrent adds B", ids(B.elements), "basea1b1");
eq("nothing pending", [A.getSnapshot().unsynced, B.getSnapshot().unsynced], [0, 0]);
// concurrent edit of different elements
const a1 = A.elements.find((e) => e.id === "a1")!;
A.dispatch({ type: "update", elements: [{ ...a1, text: "A edit" } as CanvasElement] });
const b1 = B.elements.find((e) => e.id === "b1")!;
B.dispatch({ type: "update", elements: [{ ...b1, text: "B edit" } as CanvasElement] });
send(B); send(A); deliver(A); deliver(B);
const texts = (els: readonly CanvasElement[]) => els.map((e) => (e.type === "text" ? e.text : e.type));
eq("both edits kept", texts(A.elements), ["base", "A edit", "B edit"]);
eq("B same", JSON.stringify(A.elements) === JSON.stringify(B.elements), true);
// per-user undo: A undoes its edit, B's edit stays
A.dispatch({ type: "undo" });
send(A); deliver(A); deliver(B);
eq("A undo only reverts A", texts(B.elements), ["base", "a1", "B edit"]);
// B deletes a1 while A edits it: deletion wins
const a1b = A.elements.find((e) => e.id === "a1")!;
A.dispatch({ type: "update", elements: [{ ...a1b, text: "late" } as CanvasElement] });
B.dispatch({ type: "remove", ids: ["a1"] });
send(B); send(A); deliver(A); deliver(B);
eq("delete beats concurrent edit", ids(A.elements), "baseb1");
eq("B agrees", ids(B.elements), "baseb1");
// B undoes its delete: a1 comes back in its old place
B.dispatch({ type: "undo" });
send(B); deliver(A); deliver(B);
eq("undo delete restores position", ids(A.elements), "basea1b1");
// clear + undo restores order
B.dispatch({ type: "clear" });
send(B); deliver(A); deliver(B);
eq("cleared", ids(A.elements), "");
B.dispatch({ type: "undo" });
send(B); deliver(A); deliver(B);
eq("undo clear restores all in order", ids(A.elements), "basea1b1");
// redo after undo
B.dispatch({ type: "redo" });
send(B); deliver(A); deliver(B);
eq("redo clear", ids(A.elements), "");
B.dispatch({ type: "undo" }); send(B); deliver(A); deliver(B);
// gap detection and reset
const C = new CollabDoc({ elements: [t("base")], version: 0 });
eq("gap detected", C.applyRemote(log[2]), "gap");
C.dispatch({ type: "add", elements: [t("c1")] });
C.reset({ elements: serverEls, version });
eq("reset keeps unsent local work on top", ids(C.elements), "basea1b1c1");
send(C); deliver(C); deliver(A);
eq("C's change reaches A", ids(A.elements), "basea1b1c1");
eq("identity kept for own echo", A.elements.find((e) => e.id === "c1") !== C.elements.find((e) => e.id === "c1"), true);
// dedupe ack for already-included batch
const D = new CollabDoc({ elements: serverEls, version });
D.restore([{ id: log[log.length - 1].b, ops: log[log.length - 1].ops }]);
D.acknowledge([{ id: log[log.length - 1].b, version: log[log.length - 1].v }]);
eq("restored batch already on server settles", D.getSnapshot().unsynced, 0);
// the free plan: batches kept in this browser instead of on a server
const Free = new CollabDoc({ elements: [t("base")], version: 0 });
const settled: string[] = [];
Free.connect({ onLocalBatch: () => {}, onSettled: (ids) => settled.push(...ids) });
Free.dispatch({ type: "add", elements: [t("l1")] });
Free.dispatch({ type: "add", elements: [t("l2")] });
const firstTwo = Free.unsent().map((b) => b.id);
Free.dispatch({ type: "add", elements: [t("l3")] });
Free.confirmLocal(firstTwo);
eq("confirming kept batches leaves later ones pending", [Free.getSnapshot().unsynced, Free.getSnapshot().version], [1, 2]);
eq("and what's shown is unchanged", ids(Free.elements), "basel1l2l3");
eq("settled batches are reported", settled, firstTwo);
Free.confirmLocal(Free.unsent().map((b) => b.id));
eq("with nothing pending, the saved copy is what's shown", [Free.serverElements === Free.elements, Free.getSnapshot().unsynced], [true, 0]);
Free.dispatch({ type: "undo" });
eq("undo still works after saving", ids(Free.elements), "basel1l2");
// ------------------------------------------------ where Redis is
eq("REDIS_URL is used as is", redisUrl({ REDIS_URL: " redis://localhost:6379 " }), "redis://localhost:6379");
eq(
  "Upstash's REST URL and token make a TLS connection with the token as password",
  redisUrl({ UPSTASH_REDIS_REST_URL: "https://example-123.upstash.io", UPSTASH_REDIS_REST_TOKEN: "abc/+=" }),
  "rediss://default:abc%2F%2B%3D@example-123.upstash.io:6379",
);
eq(
  "REDIS_URL wins over Upstash's",
  redisUrl({ REDIS_URL: "redis://a:1", UPSTASH_REDIS_REST_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }),
  "redis://a:1",
);
eq("AI allowance is 250 a month unless set", [aiMonthlyLimit({}), aiMonthlyLimit({ AI_MONTHLY_CALLS: "100" }), aiMonthlyLimit({ AI_MONTHLY_CALLS: "lots" })], [250, 100, 250]);
eq("calls count against the UTC month", [usageMonth(new Date("2026-11-30T23:59:59Z")), usageMonth(new Date("2026-12-01T00:00:00Z"))], ["2026-11-01", "2026-12-01"]);
eq("the allowance starts over on the 1st", allowanceResetsAt(new Date("2026-12-15T10:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
eq("what's left never goes below 0", [allowance(12, 250).left, allowance(300, 250).left], [238, 0]);
eq("the used-up message", allowanceUsedMessage(allowance(250, 250, new Date("2026-11-27T12:00:00Z"))), "You've used all 250 AI checks and worksheets for this month. They start over on December 1.");
eq("quotes pasted around values are dropped", [envValue("A", { A: ' "abc" ' }), envValue("A", { A: "abc\"" }), envValue("A", { A: "''" }), envValue("A", {})], ["abc", "abc", undefined, undefined]);
eq(
  "a stray quote on REDIS_URL is dropped",
  redisUrl({ REDIS_URL: 'rediss://default:t@host.upstash.io:6379"' }),
  "rediss://default:t@host.upstash.io:6379",
);
eq(
  "quoted Upstash settings work",
  redisUrl({ UPSTASH_REDIS_REST_URL: '"https://b.upstash.io"', UPSTASH_REDIS_REST_TOKEN: "'tok'" }),
  "rediss://default:tok@b.upstash.io:6379",
);
eq(
  "Upstash's REST URL pasted as REDIS_URL",
  redisUrl({ REDIS_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok" }),
  "rediss://default:tok@b.upstash.io:6379",
);
eq("passwords in errors are masked", redactSecrets("connect EINVAL //default:s3cret@host:6379 and redis://u:p@x"), "connect EINVAL //default:***@host:6379 and redis://u:***@x");
eq("thinking before the JSON is skipped", parseJsonReply('<think>maybe {"a":0}</think>\n{"a":1}'), { a: 1 });
eq("a proof verdict after thinking", parseProofVerdict('<think>{x}</think>{"valid":true,"summary":"ok","lines":[]}', 0)?.valid, true);
eq("a URL without its token is nothing", redisUrl({ UPSTASH_REDIS_REST_URL: "https://b.upstash.io" }), null);
eq(
  "on the VPS, Upstash's wins over the bundled Redis, which is used otherwise",
  [
    redisUrl({ BUNDLED_REDIS_URL: "redis://redis:6379", UPSTASH_REDIS_REST_URL: "b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" }),
    redisUrl({ BUNDLED_REDIS_URL: "redis://redis:6379" }),
  ],
  ["rediss://default:t@b.upstash.io:6379", "redis://redis:6379"],
);
// ------------------------------------------------ plans
eq(
  "only members can use member features",
  (["math-check", "chemistry", "flashcards", "sharing", "workspaces", "server-storage"] as const).map(
    (f) => `${canUse("free", f)}${canUse("member", f)}`,
  ),
  Array(6).fill("falsetrue"),
);
eq("every member feature has an upgrade prompt", Object.values(MEMBER_FEATURES).every((f) => f.title && f.text), true);
// ------------------------------------------------ to-do boards
let n = 0;
const nid = () => `id${++n}`;
const kb0 = newKanban({ id: "kb", x: 100, y: 50, scale: 1, ids: nid });
const withCards = (el: KanbanElement, col: number, texts: string[]): KanbanElement => ({
  ...el,
  columns: el.columns.map((c, i) => (i === col ? { ...c, cards: [...c.cards, ...texts.map((text) => ({ id: nid(), text }))] } : c)),
});
const kb = withCards(withCards(kb0, 0, ["Read ch. 4", "Redox", "Lab report"]), 1, ["Revise"]);
const titles = (el: KanbanElement) => el.columns.map((c) => c.cards.map((k) => k.text).join(",")).join(" | ");
eq("new board columns", kb0.columns.map((c) => c.title), ["To do", "Doing", "Done"]);
eq("new board is valid", elementSchema.safeParse(kb).success, true);
const L = kanbanLayout(kb);
eq("three columns side by side", L.columns.map((c) => Math.round(c.rect.x - kb.x)), [14, 244, 474]);
eq("columns share one height", new Set(L.columns.map((c) => c.rect.h)).size, 1);
eq("height grows with cards", L.h > kanbanLayout(kb0).h, true);
eq("box matches layout", elementBox(kb), { x: 100, y: 50, w: L.w, h: L.h });
const c0 = L.columns[0].cards[0].rect;
eq("card hit", kanbanPartAt(kb, { x: c0.x + 5, y: c0.y + 5 }), { kind: "card", columnId: kb.columns[0].id, cardId: kb.columns[0].cards[0].id });
eq("add button hit", kanbanPartAt(kb, { x: L.columns[1].add.x + 4, y: L.columns[1].add.y + 4 }).kind, "add");
eq("header hit", kanbanPartAt(kb, { x: L.columns[2].header.x + 30, y: L.columns[2].header.y + 10 }).kind, "header");
eq("title hit", kanbanPartAt(kb, { x: L.title.x + 4, y: L.title.y + 4 }).kind, "title");
eq("drop above first card", dropSlot(kb, { x: c0.x + 5, y: c0.y + 2 }).index, 0);
eq("drop below last card", dropSlot(kb, { x: c0.x + 5, y: L.h + kb.y }).index, 3);
eq("drop beside the board picks the nearest column", dropSlot(kb, { x: kb.x + L.w + 50, y: c0.y }).columnId, kb.columns[2].id);
const redox = kb.columns[0].cards[1].id;
const toDone = moveCard(kb, kb, { cardId: redox, columnId: kb.columns[2].id, index: 0 });
eq("move to another column", toDone && titles(toDone[0]), "Read ch. 4,Lab report | Revise | Redox");
const reorder = moveCard(kb, kb, { cardId: redox, columnId: kb.columns[0].id, index: 2 });
eq("reorder within a column", reorder && titles(reorder[0]), "Read ch. 4,Lab report,Redox | Revise | ");
eq("drop where it was changes nothing", moveCard(kb, kb, { cardId: redox, columnId: kb.columns[0].id, index: 1 }), null);
const other = newKanban({ id: "kb2", x: 1000, y: 50, scale: 2, ids: nid });
const across = moveCard(kb, other, { cardId: redox, columnId: other.columns[1].id, index: 0 });
eq("move across boards changes both", across?.map((b) => b.id), ["kb", "kb2"]);
eq("card left the first board", across && findCard(across[0], redox), null);
eq("card arrived on the second", across && titles(across[1]), " | Redox | ");
eq("missing card: no move", moveCard(kb, kb, { cardId: "nope", columnId: kb.columns[0].id, index: 0 }), null);
eq("progress counts the last column", progress(toDone![0]), { total: 4, done: 1 });
const wider = addColumn(kb, "c4");
eq("add column", wider.columns.length, 4);
eq("board grows by a column", Math.round(kanbanLayout(wider).columns[0].rect.w), Math.round(L.columns[0].rect.w));
eq("remove column", removeColumn(wider, "c4").columns.length, 3);
eq("can't remove the last column", removeColumn({ ...kb, columns: [kb.columns[0]] }, kb.columns[0].id).columns.length, 1);
const bigBoard = scaleElement(kb, elementBox(kb), { x: 100, y: 50, w: L.w * 2, h: L.h * 2 });
eq("corner resize scales the board", [bigBoard.type === "kanban" && bigBoard.scale, Math.round(elementBox(bigBoard).h)], [2, Math.round(L.h * 2)]);
const wide = scaleElement(kb, elementBox(kb), { x: 100, y: 50, w: L.w * 1.5, h: L.h });
eq("shift resize only widens", [wide.type === "kanban" && wide.scale, Math.round(elementBox(wide).w)], [1, Math.round(L.w * 1.5)]);
const thin = scaleElement(kb, elementBox(kb), { x: 100, y: 50, w: 50, h: L.h });
eq("never narrower than its columns", Math.round(elementBox(thin).w), Math.round(kanbanMinWidth(3, 1)));
eq("long words wrap", wrapText("x".repeat(80), 100).length > 1, true);
eq("newlines kept", wrapText("a\nb", 500), ["a", "b"]);
eq("7 columns refused", elementSchema.safeParse({ ...kb, columns: [...kb.columns, ...kb.columns, kb.columns[0]] }).success, false);
eq("empty card refused", elementSchema.safeParse(withCards(kb0, 0, ["  "])).success, false);

// ------------------------------------------------ media
const gif = { id: "g", type: "gif", assetId: "7a0e1f5c-3c6b-4c51-9a55-0e7a6c7b6f11", x: 0, y: 0, w: 320, h: 180 };
const vid = { ...gif, id: "v", type: "video", assetId: "0d6f5c8e-2b1a-4f3e-8d7c-6b5a4f3e2d1c" };
eq("gif element valid", elementSchema.safeParse(gif).success, true);
eq("video element valid", elementSchema.safeParse(vid).success, true);
eq("asset ids include GIFs and videos", [...assetIdsOf([gif, vid] as CanvasElement[])].length, 2);
eq("range: first bytes", parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
eq("range: open-ended is capped", parseRange("bytes=100-", 10_000_000, 1000), { start: 100, end: 1099 });
eq("range: open-ended near the end", parseRange("bytes=900-", 1000), { start: 900, end: 999 });
eq("range: suffix", parseRange("bytes=-100", 1000), { start: 900, end: 999 });
eq("range: end past the file is trimmed", parseRange("bytes=0-5000", 1000), { start: 0, end: 999 });
eq("range: past the end", parseRange("bytes=1000-", 1000), "invalid");
eq("range: backwards", parseRange("bytes=50-10", 1000), "invalid");
eq("range: several ranges ignored", parseRange("bytes=0-1,5-6", 1000), null);
eq("range: none", parseRange(null, 1000), null);

// ------------------------------------------------ study buddies
eq("level 1 at 0 points", levelFor(0), { level: 1, floor: 0, next: 20 });
eq("level 2 at 20", levelFor(20).level, 2);
eq("level 3 just below 100", levelFor(99).level, 3);
eq("top level", levelFor(5000), { level: 10, floor: 1000, next: null });
eq("unlocks by level", [accessoriesFor(1), accessoriesFor(4), accessoriesFor(9)], [[], ["scarf", "glasses"], ["scarf", "glasses", "cap"]]);
eq("level-up line names the unlock", levelUp(4), "Level 4! I got reading glasses.");
eq("streak: today and the two days before", streakFrom(["2026-11-18", "2026-11-17", "2026-11-16", "2026-11-14"], "2026-11-18"), 3);
eq("streak still counts from yesterday", streakFrom(["2026-11-17", "2026-11-16"], "2026-11-18"), 2);
eq("streak broken", streakFrom(["2026-11-15"], "2026-11-18"), 0);
eq("streak across a month end", streakFrom(["2026-12-01", "2026-11-30"], "2026-12-01"), 2);
eq("default settings are valid", settingsSchema.safeParse(DEFAULT_SETTINGS).success, true);
eq("four buddies refused", settingsSchema.safeParse({ ...DEFAULT_SETTINGS, buddies: Array(4).fill(DEFAULT_SETTINGS.buddies[0]) }).success, false);
const prog = (reviews: number): Progress => ({ today: { reviews, tasks: 0 }, streak: 1, points: reviews, level: 1, levelFloor: 0, nextLevel: 20 });
eq("first answer gets a word", afterReview("good", prog(1), { answered: 1, missed: 0 }) !== null, true);
eq("most answers get nothing", afterReview("good", prog(3), { answered: 3, missed: 0 }), null);
eq("every fifth card today", afterReview("easy", prog(10), { answered: 4, missed: 0 })?.startsWith("10 cards today."), true);
eq("first miss gets encouragement, the next doesn't", [afterReview("again", prog(2), { answered: 2, missed: 1 }) !== null, afterReview("again", prog(3), { answered: 3, missed: 2 })], [true, null]);
const todoBoard = withCards(kb0, 0, ["Essay"]);
const essay = todoBoard.columns[0].cards[0].id;
const moved = moveCard(todoBoard, todoBoard, { cardId: essay, columnId: todoBoard.columns[2].id, index: 0 })!;
eq("a card moved to Done is finished", finishedCards([todoBoard], moved), [essay]);
eq("one already in Done isn't", finishedCards(moved, moved), []);
eq("a card added straight to Done isn't", finishedCards([kb0], [withCards(kb0, 2, ["New"])]), []);
eq("one-column boards have no Done", finishedCards([{ ...todoBoard, columns: [todoBoard.columns[0]] }], [{ ...todoBoard, columns: [todoBoard.columns[0]] }]), []);

// ------------------------------------------------------------ seasonal themes
eq("Easter Sundays", [2024, 2025, 2026, 2027, 2038, 2285].map(easterSunday), [
  { month: 3, day: 31 },
  { month: 4, day: 20 },
  { month: 4, day: 5 },
  { month: 3, day: 28 },
  { month: 4, day: 25 },
  { month: 3, day: 22 },
]);
const on = (y: number, m: number, d: number) => themeForDate(new Date(y, m - 1, d, 12));
eq("Christmas runs December 1–26", [on(2026, 11, 30), on(2026, 12, 1), on(2026, 12, 26), on(2026, 12, 27)], [null, "christmas", "christmas", null]);
eq("Halloween runs October 15–31", [on(2026, 10, 14), on(2026, 10, 15), on(2026, 10, 31), on(2026, 11, 1)], [null, "halloween", "halloween", null]);
eq("Easter runs Palm Sunday to Easter Monday (2026: Mar 29 – Apr 6)", [on(2026, 3, 28), on(2026, 3, 29), on(2026, 4, 5), on(2026, 4, 6), on(2026, 4, 7)], [null, "easter", "easter", "easter", null]);
eq("…and moves with the calendar (2027: Mar 21 – Mar 29)", [on(2027, 3, 20), on(2027, 3, 21), on(2027, 3, 29), on(2027, 3, 30)], [null, "easter", "easter", null]);
eq("a forced theme or off ignores the date", [resolveTheme("halloween", new Date(2026, 5, 1)), resolveTheme("off", new Date(2026, 11, 10)), resolveTheme("auto", new Date(2026, 11, 10))], ["halloween", null, "christmas"]);

// ------------------------------------------------------------ admin dashboard URLs
eq("the five-page window", [pageWindow(1, 9), pageWindow(5, 9), pageWindow(9, 9), pageWindow(2, 3)], [[1, 2, 3, 4, 5], [3, 4, 5, 6, 7], [5, 6, 7, 8, 9], [1, 2, 3]]);
const parsed = parseAdminQuery({ q: " ada ", role: "admin", status: "members", page: "3", user: "nope" });
eq("parsing the address ignores what doesn't make sense", parsed, { q: "ada", role: "admin", status: "members", page: 3, user: null });
eq("bad pages and roles fall back", parseAdminQuery({ page: "-2", role: "owner" }), { q: "", role: null, status: null, page: 1, user: null });
eq("a new search goes back to page 1", adminHref(parsed, { q: "grace" }), "/admin?q=grace&role=admin&status=members");
eq("changing the page keeps the search", adminHref(parsed, { page: 4 }), "/admin?q=ada&role=admin&status=members&page=4");

// ------------------------------------------------------------ settings and profile pictures
eq("preferences: junk falls back to the defaults", parsePreferences({ drawEffect: "sparkles", boardEffects: "yes" }), DEFAULT_PREFERENCES);
eq("preferences: valid choices are kept", parsePreferences({ drawEffect: "trace", boardEffects: false }), { drawEffect: "trace", boardEffects: false });
eq("preferences: nothing stored yet", parsePreferences(null), DEFAULT_PREFERENCES);
eq("no picture, no URL", avatarUrl("u1", null), null);
eq("the URL carries the picture's version", avatarUrl("u1", new Date(1_800_000_000_000)), "/api/avatars/u1?v=" + (1_800_000_000_000).toString(36));
const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(12).fill(0)]);
eq("sniffing picture types from their first bytes", [
  sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
  sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)),
  sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])),
  sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
  sniffImageType(new TextEncoder().encode("GIF89a.........")),
], ["image/png", "image/jpeg", "image/webp", null, null]);

// ------------------------------------------------------------ drawing effects
const fxStroke = (id: string, x = 0): CanvasElement => ({ id, type: "stroke", brush: "ink", color: "#201f24", size: 4, points: [x, 0, x + 300, 0, x + 300, 400] });
eq("ink length follows the stroke", inkLength(fxStroke("a")), 700);
eq("traces take 0.3–1 s, longer for longer lines", [traceDuration(fxStroke("a"), 0.01), traceDuration(fxStroke("a"), 1), traceDuration(fxStroke("a"), 8)], [0.3, 0.6875, 1]);
eq("a batch is staggered to fit its time", [staggerStep(1, 1), staggerStep(10, 1.1), Math.round(staggerStep(100, 1.1) * 1000)], [0, 0.06, 11]);
let frames = 0;
const off = new ElementEffects("off", () => frames++);
eq("effects off: nothing waits or animates", [off.enabled, off.busy, off.stateOf(fxStroke("a"))], [false, false, undefined]);
const pop = new ElementEffects("pop", () => frames++);
eq("a drawing that's opening stays hidden until its replay", pop.stateOf(fxStroke("a")), { kind: "pop", t: 0 });
const view = { x: 0, y: 0, w: 1000, h: 800 };
pop.open([fxStroke("a"), fxStroke("b", 5000)], view, 1);
eq("…then only what's in view replays", [!!pop.stateOf(fxStroke("a")), pop.stateOf(fxStroke("b", 5000))], [true, undefined]);
pop.finishAll();
eq("finishing jumps to the end", [pop.busy, pop.stateOf(fxStroke("a"))], [false, undefined]);
const many = Array.from({ length: MAX_ANIMATED + 1 }, (_, i) => fxStroke(`m${i}`));
const crowded = new ElementEffects("trace", () => frames++);
crowded.open(many, view, 1);
eq("a very full view just appears", [crowded.busy, crowded.stateOf(many[0])], [false, undefined]);
pop.leave(fxStroke("a"));
eq("an erased element stays as a ghost while it leaves", [[...pop.ghosts()].length, pop.isLeaving("a"), pop.stateOf(fxStroke("a"))], [1, true, undefined]);
pop.dispose();
const traceFx = new ElementEffects("trace", () => frames++);
traceFx.open([], view, 1);
traceFx.leave(fxStroke("a"));
eq("a traced element fades out (a trace doesn't run backwards)", [...traceFx.ghosts()].map((g) => g.state.kind), ["fade"]);
traceFx.dispose();

// ------------------------------------------------------------ to-do board effects
const fxBoard = newKanban({ id: "kb", x: 0, y: 0, scale: 1, ids: (() => { let n = 0; return () => `k${n++}`; })() });
const firstCol = fxBoard.columns[0];
const withTwo: KanbanElement = { ...fxBoard, columns: fxBoard.columns.map((c, i) => (i === 0 ? { ...c, cards: [{ id: "c1", text: "Read chapter 4" }, { id: "c2", text: "Problem set" }] } : c)) };
const lastCol = withTwo.columns[withTwo.columns.length - 1];
const finished = moveCard(withTwo, withTwo, { cardId: "c1", columnId: lastCol.id, index: 0 })![0] as KanbanElement;
const kfx = new KanbanEffects(true, () => frames++);
kfx.change(withTwo, finished);
const glide = kfx.card("kb", "c1");
eq("a moved card starts where it was and glides to its slot", [!!glide && Math.abs(glide.dx) > 10, glide?.strike], [true, 0]);
eq("the card under it moves up from its old place", (kfx.card("kb", "c2")?.dy ?? 0) > 0, true);
eq("the progress bar starts from the old share", kfx.progress("kb"), 0);
kfx.dispose();
kfx.noteDrop("kb", "c1", { x: 900, y: 900 });
kfx.change(withTwo, finished);
const dropped = kfx.card("kb", "c1");
const slot = kanbanLayout(finished).columns.at(-1)!.cards[0].rect;
eq("a dropped card glides from where it was let go", [dropped?.dx, dropped?.dy], [900 - slot.x, 900 - slot.y]);
kfx.dispose();
kfx.noteDrop("kb", "c1", { x: 900, y: 900 }, [finished]);
kfx.change(withTwo, finished);
eq("after a drag, only the dropped card moves (the preview already opened its slot) and gets crossed out", [!!kfx.card("kb", "c1"), kfx.card("kb", "c1")?.strike, kfx.card("kb", "c2")], [true, 0, undefined]);
kfx.dispose();
const shifted = { ...withTwo, x: withTwo.x + 120, y: withTwo.y + 40 };
kfx.change(withTwo, shifted);
eq("moving the whole board doesn't make cards lag behind", [kfx.card("kb", "c1"), kfx.busy], [undefined, false]);
const added: KanbanElement = { ...withTwo, columns: withTwo.columns.map((c) => (c.id === firstCol.id ? { ...c, cards: [...c.cards, { id: "c3", text: "New" }] } : c)) };
kfx.change(withTwo, added);
eq("a new card pops in", [kfx.card("kb", "c3")?.alpha, kfx.card("kb", "c3")?.scale], [0, 0.9]);
kfx.setEnabled(false);
kfx.change(withTwo, finished);
eq("board effects off: no animations", kfx.busy, false);

// ------------------------------------------------------------ panda battles
/** A repeatable random sequence (mulberry32). */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const always = (v: number) => () => v;
eq("which rarities turn up at each level", [1, 2, 3, 5, 7].map((l) => raritiesAt(l).join(",")), ["common", "common", "common,uncommon", "common,uncommon,rare", "common,uncommon,rare,superRare"]);
{
  const rng = seeded(3);
  const first = Array.from({ length: 300 }, () => rollWild(1, rng));
  eq(
    "wild pandas turn up from level 1: common ones, level 1 or 2",
    [first.every((w) => w?.rarity === "common"), Math.min(...first.map((w) => w!.level)), Math.max(...first.map((w) => w!.level))],
    [true, 1, 2],
  );
}
{
  const rng = seeded(7);
  const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, superRare: 0 };
  for (let i = 0; i < 20000; i++) counts[pickRarity(10, rng)!]++;
  const shares = [counts.common, counts.uncommon, counts.rare, counts.superRare].map((n) => n / 200);
  eq("rarities come about as often as their weights say (58/28/11/3, within 2 points)", [58, 28, 11, 3].every((want, i) => Math.abs(shares[i] - want) < 2), true, );
  const wild = Array.from({ length: 400 }, () => rollWild(4, rng)!);
  eq("at level 4: only common and uncommon, levels 3–5", [new Set(wild.map((w) => w.rarity)).size, Math.min(...wild.map((w) => w.level)), Math.max(...wild.map((w) => w.level))], [2, 3, 5]);
  eq("every wild trick suits its rarity", wild.every((w) => ABILITY_POOL[w.rarity].includes(w.ability)), true);
}
eq("Bao sprints; other made-up buddies get a common trick", [starterAbility("bao"), ABILITY_POOL.common.includes(starterAbility("b1x9")), starterAbility("b1x9") === starterAbility("b1x9")], ["sprint", true, true]);
eq("bamboo: 5 to start and one per 10 points, less what's been offered", [bambooFor(0, 0), bambooFor(37, 2), bambooFor(5, 9)], [5, 6, 0]);
eq("old buddy settings get the new switches", (({ roam, tricks, wild }) => ({ roam, tricks, wild }))(settingsSchema.parse({ visible: true, wander: true, dailyGoal: 20, buddies: [{ id: "bao", name: "Bao", color: "#277c78", x: null, y: null }] })), { roam: false, tricks: true, wild: true });
eq("levelling up mentions what can turn up now", [levelUp(2), levelUp(5), levelUp(9)], ["Level 2! I got a scarf.", "Level 5! Rare pandas can turn up now.", "Level 9!"]);

const mochi = { id: "mochi", name: "Mochi", rarity: "common" as const, ability: "sprint" as const, color: "#277c78" };
const bao = { id: "bao", name: "Bao", rarity: "common" as const, ability: "nap" as const, color: "#c94736" };
const pip = { id: "wild", name: "Pip", rarity: "rare" as const, ability: "roll" as const, level: 3, color: "" };
eq("a level 3 common panda: energy, strength, speed (sprinters are quick)", (({ maxHp, attack, speed }) => ({ maxHp, attack, speed }))(makeFighter({ ...mochi, level: 3 })), { maxHp: 42, attack: 12, speed: 24 });
eq("a rare one is tougher", makeFighter({ ...pip }).maxHp, 51);
const opened = startBattle({ team: [mochi, bao], wild: pip, yourLevel: 3, bamboo: 4 });
eq("a battle starts with the wild panda and your first buddy", opened.steps.map((s) => s.text), ["A rare panda wanders up: it's Pip!", "Go, Mochi!"]);
const fresh = opened.state;
eq("…your buddies fight at your level", fresh.you.map((b) => b.level), [3, 3]);
eq("the weaker it is, the likelier bamboo works; rarer is harder", [
  catchChance({ ...fresh.wild, hp: fresh.wild.maxHp }, 3) < catchChance({ ...fresh.wild, hp: 5 }, 3),
  catchChance({ ...makeFighter({ ...pip, rarity: "common" }), hp: 5 }, 3) > catchChance({ ...fresh.wild, hp: 5 }, 3),
], [true, true]);
{
  const r = act(fresh, { type: "move", move: "special" }, always(0.5));
  eq("Dash goes first even against something as quick", r.steps[0].text, "Mochi used Dash!");
  eq("…and does damage", [r.state.wild.hp < fresh.wild.hp, r.steps.some((s) => s.fx?.kind === "hit" && s.fx.side === "wild")], [true, true]);
  eq("the old state is left alone", fresh.wild.hp, fresh.wild.maxHp);
}
{
  const r = act(fresh, { type: "bamboo" }, always(0));
  eq("bamboo that's taken: three nibbles and it joins you", [r.state.over, r.steps[0].fx, r.state.bamboo], ["caught", { kind: "bamboo", wobbles: 3, caught: true }, 3]);
  const no = act(fresh, { type: "bamboo" }, always(0.99));
  eq("bamboo pushed away: the wild panda gets its turn", [no.state.over, no.steps[0].fx, no.steps[1].text, no.steps[2].text], [null, { kind: "bamboo", wobbles: 0, caught: false }, "Pip pushed it away!", "Pip used Roll!"]);
  let threw = "";
  try {
    act({ ...fresh, bamboo: 0 }, { type: "bamboo" }, Math.random);
  } catch (e) {
    threw = e instanceof BattleError ? e.message : "";
  }
  eq("no bamboo left: refused", threw, "You're out of bamboo. Study a little to earn more.");
}
{
  const nearlyOut: BattleState = { ...fresh, you: fresh.you.map((b, i) => (i === 0 ? { ...b, hp: 1 } : b)) };
  // rng 0.5: the wild panda swipes first (Mochi's Bump has no priority, and Pip is quicker).
  const slow: BattleState = { ...nearlyOut, you: nearlyOut.you.map((b) => ({ ...b, speed: 1 })) };
  const r = act(slow, { type: "move", move: "bump" }, always(0.5));
  eq("worn out with another buddy left: you must pick one", [r.state.mustSwitch, r.state.over, r.steps.at(-1)?.text], [true, null, "Who's next?"]);
  let blocked = false;
  try {
    act(r.state, { type: "move", move: "bump" }, always(0.5));
  } catch {
    blocked = true;
  }
  eq("…nothing else until you do", blocked, true);
  const sw = act(r.state, { type: "switch", to: 1 }, always(0.5));
  eq("…and that switch is free (no wild turn)", [sw.state.active, sw.steps.map((s) => s.text)], [1, ["Go, Bao!"]]);
  const alone: BattleState = { ...slow, you: [slow.you[0]] };
  eq("worn out with nobody left: the battle's lost", act(alone, { type: "move", move: "bump" }, always(0.5)).state.over, "lost");
}
{
  const weak: BattleState = { ...fresh, wild: { ...fresh.wild, hp: 1 } };
  const r = act(weak, { type: "move", move: "special" }, always(0.5));
  eq("wearing it out ends it (it wanders off, uncaught)", [r.state.over, r.steps.at(-1)?.text], ["won", "Pip wanders off for a rest."]);
  let over = false;
  try {
    act(r.state, { type: "run" }, Math.random);
  } catch {
    over = true;
  }
  eq("nothing more once it's over", over, true);
  eq("running away always works", act(fresh, { type: "run" }, Math.random).state.over, "ran");
}
{
  const seq = [0.99, 0.99];
  const r = act({ ...fresh, turn: 1 }, { type: "move", move: "stare" }, () => seq.shift() ?? 0.01);
  eq("a rare panda may run off from the second turn", r.state.over, "fled");
  const early = act({ ...fresh, turn: 0 }, { type: "move", move: "stare" }, () => 0.01);
  eq("…but not before", early.state.over === "fled", false);
}
{
  let ok = true;
  let longest = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed);
    let { state } = startBattle({ team: [mochi, bao], wild: { ...pip, rarity: (["common", "uncommon", "rare", "superRare"] as const)[seed % 4] }, yourLevel: 1 + (seed % 9), bamboo: 3 });
    let turns = 0;
    while (!state.over && turns < 200) {
      const live = state.you.map((b, i) => [b, i] as const).filter(([b, i]) => b.hp > 0 && i !== state.active);
      const roll = rng();
      const action = state.mustSwitch
        ? { type: "switch" as const, to: live[0][1] }
        : roll < 0.15 && state.bamboo > 0
          ? { type: "bamboo" as const }
          : { type: "move" as const, move: (["bump", "swipe", "stare", "special"] as const)[Math.floor(rng() * 4)] };
      state = act(state, action, rng).state;
      turns++;
      if (state.you.some((b) => b.hp < 0 || b.hp > b.maxHp) || state.wild.hp < 0 || state.wild.hp > state.wild.maxHp) ok = false;
    }
    if (!state.over) ok = false;
    longest = Math.max(longest, turns);
  }
  eq("300 random battles all end, with energy always in range", [ok, longest < 60], [true, true]);
}

// ------------------------------------------------------------ wild panda rules (admins change these)
eq("rules: nothing stored is the defaults", rulesFrom(undefined), DEFAULT_RULES);
eq("…the defaults are today's numbers", [DEFAULT_RULES.on, DEFAULT_RULES.chance, DEFAULT_RULES.gapMinutes, DEFAULT_RULES.stayMinutes, DEFAULT_RULES.kinds.rare], [true, 0.6, 4, 3, { weight: 11, minLevel: 5, levelBonus: 1, catchRate: 0.38, flee: 0.06 }]);
eq(
  "rules: an out-of-range value falls back by itself, the rest are kept",
  (({ on, chance, gapMinutes, kinds }) => [on, chance, gapMinutes, kinds.rare, kinds.common])(rulesFrom({ on: false, chance: 7, gapMinutes: 10, kinds: { rare: { weight: -5, minLevel: 2 } } })),
  [false, 0.6, 10, { ...DEFAULT_KINDS.rare, minLevel: 2 }, DEFAULT_KINDS.common],
);
eq("rules: junk is the defaults", [rulesFrom("nope"), rulesFrom([1, 2])], [DEFAULT_RULES, DEFAULT_RULES]);
const ruleForm = (over: Record<string, string | null> = {}) => {
  const fd = new FormData();
  const base: Record<string, string> = { on: "on", chance: "60", gapMinutes: "4", stayMinutes: "3" };
  for (const [r, k] of Object.entries(DEFAULT_KINDS)) {
    base[`${r}.weight`] = String(k.weight);
    base[`${r}.minLevel`] = String(k.minLevel);
    base[`${r}.levelBonus`] = String(k.levelBonus);
    base[`${r}.catchRate`] = String(Math.round(k.catchRate * 100));
    base[`${r}.flee`] = String(Math.round(k.flee * 100));
  }
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
};
eq("the admin form: today's numbers read back as the defaults", rulesFromForm(ruleForm()).rules, DEFAULT_RULES);
eq("…switched off when the switch isn't sent", rulesFromForm(ruleForm({ on: null })).rules?.on, false);
eq(
  "…percents become fractions, minutes stay minutes",
  (({ chance, gapMinutes, stayMinutes, kinds }) => [chance, gapMinutes, stayMinutes, kinds.superRare.catchRate, kinds.superRare.flee])(
    rulesFromForm(ruleForm({ chance: "100", gapMinutes: "1", stayMinutes: "10", "superRare.catchRate": "50", "superRare.flee": "0" })).rules!,
  ),
  [1, 1, 10, 0.5, 0],
);
eq(
  "…numbers out of range, or not whole, are refused by name",
  rulesFromForm(ruleForm({ chance: "0", "rare.weight": "abc", "superRare.flee": "51", "common.minLevel": "2.5", stayMinutes: "" })).errors,
  {
    chance: "From 1 to 100 %.",
    stayMinutes: "A whole number from 1 to 30.",
    "common.minLevel": "A whole number from 1 to 10.",
    "rare.weight": "A whole number from 0 to 1000.",
    "superRare.flee": "From 0 to 50 %.",
  },
);
eq(
  "…and so is every kind set to never",
  rulesFromForm(ruleForm({ "common.weight": "0", "uncommon.weight": "0", "rare.weight": "0", "superRare.weight": "0" })).errors,
  { form: "Give at least one kind a chance to turn up, or switch wild pandas off instead." },
);
eq("shares at the top level: 58/28/11/3 %", Object.values(sharesAt(10, DEFAULT_KINDS)).map((s) => Math.round(s * 100)), [58, 28, 11, 3]);
eq("…at level 1, all common", Object.values(sharesAt(1, DEFAULT_KINDS)), [1, 0, 0, 0]);
const goldOnly = { ...DEFAULT_KINDS, common: { ...DEFAULT_KINDS.common, weight: 0 }, uncommon: { ...DEFAULT_KINDS.uncommon, weight: 0 }, rare: { ...DEFAULT_KINDS.rare, weight: 0 }, superRare: { ...DEFAULT_KINDS.superRare, minLevel: 1, levelBonus: 4 } };
eq("kinds set to never don't turn up; the rest from their own level", [raritiesAt(10, goldOnly).join(), pickRarity(1, Math.random, goldOnly), firstLevel(goldOnly)], ["superRare", "superRare", 1]);
eq("…with their own level above yours", rollWild(2, always(0.5), goldOnly)?.level, 2 + 0 + 4);
eq("the first level anyone meets one", [firstLevel(DEFAULT_KINDS), firstLevel({ ...DEFAULT_KINDS, common: { ...DEFAULT_KINDS.common, weight: 0 } })], [1, 3]);
eq("how far apart they turn up", [apartText(DEFAULT_RULES), apartText({ chance: 1, gapMinutes: 1 }), apartText({ chance: 0.05, gapMinutes: 10 })], ["about one every 6½ minutes", "about one every 1 minute", "about one every 3½ hours"]);
eq("what browsers are told", openingsOf({ ...DEFAULT_RULES, on: false, kinds: goldOnly }), { on: false, stayMinutes: 3, from: { common: null, uncommon: null, rare: null, superRare: 1 } });
eq(
  "levelling up follows the rules: the first level they meet one, and new kinds",
  [levelUp(3, { common: 3, uncommon: 3, rare: 5, superRare: null }), levelUp(5, { common: 1, uncommon: 3, rare: null, superRare: 5 }), levelUp(7, { common: 1, uncommon: 3, rare: 5, superRare: null })],
  ["Level 3! Wild pandas can find your drawings now.", "Level 5! Super rare pandas can turn up now.", "Level 7!"],
);
{
  const easy = startBattle({ team: [mochi, bao], wild: pip, yourLevel: 3, bamboo: 4, rates: { catchRate: 0.9, flee: 0 } });
  const usual = startBattle({ team: [mochi, bao], wild: pip, yourLevel: 3, bamboo: 4 });
  eq("a battle keeps the rates it started with (its rarity's by default)", [easy.state.rates, usual.state.rates], [{ catchRate: 0.9, flee: 0 }, { catchRate: 0.38, flee: 0.06 }]);
  const tired = (s: BattleState): BattleState => ({ ...s, wild: { ...s.wild, hp: 5 } });
  eq("…and bamboo works by them", viewOf(tired(easy.state)).chance > viewOf(tired(usual.state)).chance, true);
  const legacy = { ...usual.state, rates: undefined };
  eq("battles from before keep their rarity's numbers", ratesOf(legacy), { catchRate: 0.38, flee: 0.06 });
  // Your buddies at level 10, so staring it down for a while wears nobody out.
  const runner = startBattle({ team: [mochi, bao], wild: pip, yourLevel: 10, bamboo: 4, rates: { catchRate: 0.38, flee: 1 } }).state;
  let s = runner;
  for (let i = 0; i < 2 && !s.over && !s.mustSwitch; i++) s = act(s, { type: "move", move: "stare" }, always(0.5)).state;
  eq("one set to always run off goes at the end of turn two", [s.turn, s.over], [2, "fled"]);
  let calm = startBattle({ team: [mochi, bao], wild: pip, yourLevel: 10, bamboo: 4, rates: { catchRate: 0.38, flee: 0 } }).state;
  for (let i = 0; i < 6 && !calm.over && !calm.mustSwitch; i++) calm = act(calm, { type: "move", move: "stare" }, seeded(40 + i)).state;
  eq("…and one set to never doesn't", [calm.turn >= 3, calm.over === "fled"], [true, false]);
}

// ------------------------------------------------------------ pandas keeping off the drawing
{
  const room = { x: 0, y: 100, w: 1000, h: 500 };
  const body = { hw: 25, h: 66 };
  // A wall down the middle with a gap near the bottom, and a box.
  const wall: CanvasElement = { id: crypto.randomUUID(), type: "rect", color: "#201f24", size: 2, fill: null, x: 480, y: 0, w: 40, h: 480 };
  const box: CanvasElement = { id: crypto.randomUUID(), type: "rect", color: "#201f24", size: 2, fill: null, x: 100, y: 250, w: 200, h: 150 };
  const obstacles = obstaclesOf([wall, box]);
  const g = buildGrid(room, obstacles, body, 20, 6);
  eq("a spot over the box is blocked, clear paper isn't", [isFree(g, { x: 200, y: 360 }), isFree(g, { x: 800, y: 300 })], [false, true]);
  eq("standing just under the box counts as on it (its body rises over it)", touchesDrawing({ x: 200, y: 420 }, body, obstacles), true);
  eq("…but well below it doesn't", touchesDrawing({ x: 200, y: 520 }, body, obstacles), false);
  const from = { x: 360, y: 200 };
  const to = { x: 800, y: 200 };
  eq("a straight walk through the wall isn't clear", clearLine(g, from, to), false);
  const path = findPath(g, from, to);
  const blockedOnWay = path ? !pathClear(g, path) : true;
  eq("the way round goes through the gap, never over anything", [!!path, blockedOnWay, path?.some((p) => p.y > 480 + body.h)], [true, false, true]);
  // Every point along the way keeps the whole panda off both shapes.
  let touching = 0;
  if (path) {
    for (let i = 1; i < path.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const p = { x: path[i - 1].x + ((path[i].x - path[i - 1].x) * k) / 20, y: path[i - 1].y + ((path[i].y - path[i - 1].y) * k) / 20 };
        if (touchesDrawing(p, body, obstacles)) touching++;
      }
    }
  }
  eq("…checked every step of the way", touching, 0);
  eq("it's straightened (only turns where it must)", (path?.length ?? 99) <= 5, true);
  eq("a blocked spot can't be a destination", findPath(g, from, { x: 500, y: 200 }), null);
  const near = nearestFree(g, { x: 200, y: 330 });
  eq("the nearest clear spot to one on the box is off it", !!near && !touchesDrawing(near, body, obstacles), true);
  const sealed = buildGrid(room, obstaclesOf([{ ...wall, id: crypto.randomUUID(), y: 0, h: 700 }]), body, 20, 6);
  eq("with no gap, there's no way across", findPath(sealed, from, to), null);
  eq("free spots and edge spots are on clear paper", [freeSpots(g).every((p) => isFree(g, p)), edgeSpots(g, "left").length > 0], [true, true]);
  // A long scribble is cut into pieces: the space it curls round stays walkable.
  const loop: number[] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) loop.push(700 + Math.cos(a) * 200, 350 + Math.sin(a) * 200);
  const scribble: CanvasElement = { id: crypto.randomUUID(), type: "stroke", color: "#201f24", size: 4, points: loop };
  const pieces = obstaclesOf([scribble]);
  eq("a pen stroke becomes many small pieces", pieces.length > 15 && pieces.every((p) => p.w < 80 && p.h < 80), true);
  eq("…so the middle of a drawn circle is clear", touchesDrawing({ x: 700, y: 380 }, body, pieces), false);
  eq("erasers aren't obstacles", obstaclesOf([{ id: crypto.randomUUID(), type: "eraser", size: 20, points: [0, 0, 500, 500] }]).length, 0);
}

// ------------------------------------------------------------ tracing pictures into strokes
{
  /** A white picture with ink painted by `paint(x, y)` (true = ink), optionally light-on-dark and grainy. */
  const picture = (w: number, h: number, paint: (x: number, y: number) => boolean, { dark = false, noise = 0, seed = 7 } = {}): Pixels => {
    const data = new Uint8ClampedArray(w * h * 4);
    let r = seed;
    const rand = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = paint(x, y) ? (dark ? 235 : 30) : dark ? 40 : 245;
        v += (rand() - 0.5) * noise;
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    return { width: w, height: h, data };
  };
  const nearSegment = (x: number, y: number, ax: number, ay: number, bx: number, by: number, r: number) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= r;
  };
  const span = (pts: number[], axis: 0 | 1) => {
    const v = pts.filter((_, k) => k % 2 === axis);
    return Math.max(...v) - Math.min(...v);
  };
  const barPic = () => picture(200, 60, (x, y) => x >= 20 && x < 180 && y >= 26 && y < 34);

  const bar = traceStrokes(barPic());
  eq("a bar becomes one straight stroke along its middle", [bar.strokes.length, bar.strokes[0]?.points.length], [1, 4]);
  eq(
    "…as long as the bar, as wide as its ink",
    [span(bar.strokes[0].points, 0) >= 150, Math.abs(bar.strokes[0].points[1] - 30) <= 1, bar.thickness >= 6 && bar.thickness <= 9],
    [true, true, true],
  );

  const ring = traceStrokes(picture(120, 120, (x, y) => Math.abs(Math.hypot(x - 60, y - 60) - 40) <= 3));
  const loop = ring.strokes[0]?.points ?? [];
  eq(
    "a ring becomes one closed loop",
    [ring.strokes.length, Math.hypot(loop[0] - loop[loop.length - 2], loop[1] - loop[loop.length - 1]) < 2, Math.round(span(loop, 0) / 10)],
    [1, true, 8],
  );

  const plus = traceStrokes(picture(100, 100, (x, y) => nearSegment(x, y, 20, 50, 80, 50, 3) || nearSegment(x, y, 50, 20, 50, 80, 3)));
  eq(
    "a plus sign: four arms from its middle, no stubs",
    [plus.strokes.filter((s) => s.points.length >= 4).length, plus.strokes.every((s) => span(s.points, 0) + span(s.points, 1) >= 20)],
    [4, true],
  );

  const dots = traceStrokes(picture(160, 60, (x, y) => (x >= 20 && x < 140 && y >= 18 && y < 24) || Math.hypot(x - 80, y - 42) <= 5));
  const dot = dots.strokes.find((s) => span(s.points, 0) + span(s.points, 1) < 4);
  eq("a dot under a line stays a dot, as big as it is", [dots.strokes.length, !!dot, (dot?.size ?? 0) >= 7], [2, true, true]);

  const grainy = traceStrokes(
    picture(200, 80, (x, y) => (x >= 20 && x < 180 && y >= 36 && y < 44) || (x * 7 + y * 13) % 97 === 0, { noise: 30 }),
  );
  eq("specks and grain don't become strokes", grainy.strokes.length, 1);

  const board = traceStrokes(picture(200, 60, (x, y) => x >= 20 && x < 180 && y >= 26 && y < 34, { dark: true, noise: 20 }));
  eq("light writing on a dark background is read the right way round", [board.darkBackground, board.strokes.length], [true, 1]);
  eq(
    "…unless told otherwise",
    traceStrokes(picture(200, 60, (x, y) => x >= 20 && x < 180 && y >= 26 && y < 34, { dark: true }), { darkBackground: false }).darkBackground,
    false,
  );

  // Shade across a photo: the paper goes from bright to dim; only the line is ink.
  const shaded = barPic();
  for (let i = 0; i < shaded.data.length; i += 4) {
    const f = 1 - (((i / 4) % 200) / 200) * 0.55;
    for (let c = 0; c < 3; c++) shaded.data[i + c] *= f;
  }
  eq("shade across a photo doesn't turn into ink", traceStrokes(shaded).strokes.length, 1);

  eq("an empty picture gives no strokes", traceStrokes(picture(80, 40, () => false)).strokes.length, 0);
  eq("findInk boxes the writing", findInk(picture(200, 100, (x, y) => x >= 50 && x < 150 && y >= 40 && y < 60)), { x: 50, y: 40, w: 100, h: 20 });
  eq(
    "…leaving out a page edge cut off at the border",
    findInk(picture(200, 100, (x, y) => (x >= 50 && x < 150 && y >= 40 && y < 60) || x < 4)),
    { x: 50, y: 40, w: 100, h: 20 },
  );
  eq("simplify keeps corners and drops the points in between", simplify([0, 0, 1, 0.1, 2, 0, 3, 0, 3, 1, 3, 2], 0.5), [0, 0, 3, 0, 3, 2]);
  eq(
    "traced strokes fit the stroke schema",
    elementSchema.safeParse({ id: "t", type: "stroke", color: "#201f24", size: bar.strokes[0].size, brush: "marker", points: bar.strokes[0].points })
      .success,
    true,
  );
}


// ------------------------------------------------------------ frames and slides
{
  const frame = (id: string, x: number, y: number, w: number, h: number, order: number): FrameElement => ({
    id,
    type: "frame",
    x,
    y,
    w,
    h,
    title: `Slide ${id}`,
    order,
  });
  const a = frame("a", 0, 0, 1600, 900, 2);
  const b = frame("b", 2000, 0, 1600, 900, 1);
  const c = frame("c", 0, 1200, 800, 600, 2);
  eq("slides go by order, then top to bottom", slidesOf([a, b, c]).map((f) => f.id), ["b", "a", "c"]);
  eq("frames fit the schema", elementSchema.safeParse(a).success, true);
  eq("a frame needs a title", elementSchema.safeParse({ ...a, title: " " }).success, false);
  const ink: CanvasElement = { id: "s", type: "stroke", color: "#000", size: 4, points: [100, 100, 300, 200] };
  const half: CanvasElement = { id: "r", type: "rect", color: "#000", size: 2, fill: null, x: 1500, y: 100, w: 300, h: 100 };
  eq("a frame carries only what's wholly inside it", insideFrame([a, ink, half, b], a).map((e) => e.id), ["s"]);
  eq("frames are hit on their edge", hitTest(a, { x: 0, y: 450 }, 4), true);
  eq("not in the middle, so what's drawn inside stays clickable", hitTest(a, { x: 800, y: 450 }, 4), false);
  eq("moving slide 3 to the front renumbers 1, 2, 3", reorderSlides(slidesOf([a, b, c]), 2, 0).map((f) => [f.id, f.order]), [
    ["c", 1],
    ["b", 2],
    ["a", 3],
  ]);
  eq("moving to where it already is changes nothing", reorderSlides([{ ...b, order: 1 }, { ...a, order: 2 }], 1, 1), []);
  const screen = { w: 1280, h: 800 };
  const r = slideRect(elementBox(a), screen, 20);
  eq("a 16:9 slide fills the width of a 16:10 screen, centred", [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)], [
    20,
    51,
    1240,
    698,
  ]);
  const from = cameraFor(elementBox(a), screen);
  const to = cameraFor(elementBox(b), screen);
  const fly = flight(from, to, screen);
  eq("the journey starts on the first frame", fly.at(0), from);
  eq("and ends on the next", fly.at(1), to);
  const mid = fly.at(0.5);
  eq("halfway, it's between them", mid.cx > from.cx && mid.cx < to.cx, true);
  eq("pulled back to show both", mid.scale < Math.min(from.scale, to.scale), true);
  eq("far frames take longer, within bounds", fly.duration >= 650 && fly.duration <= 1800, true);
  const zoomOnly = flight(from, { ...from, scale: from.scale * 4 }, screen);
  eq("zooming in place stays put", Math.round(zoomOnly.at(0.5).cx), Math.round(from.cx));
  near("the stage covers the canvas when resting", journeyVeil(0), 1);
  near("…and again on arrival", journeyVeil(1), 1);
  eq("and mostly lifts mid-flight", journeyVeil(0.5) < 0.2, true);
  eq("a stored style that isn't known falls back", normalizePresentation({ style: "spin" }), DEFAULT_PRESENTATION);
  eq("a stored style is kept", normalizePresentation({ style: "journey", stage: "paper", numbers: false }), {
    style: "journey",
    stage: "paper",
    numbers: false,
  });
}

// ------------------------------------------------------------ workspace roles
{
  eq("owners, admins and editors edit a workspace's drawings", ["owner", "admin", "editor"].map((r) => drawingRoleFrom(r as "owner")), [
    "editor",
    "editor",
    "editor",
  ]);
  eq("viewers view them", drawingRoleFrom("viewer"), "viewer");
  eq("and outsiders get nothing", drawingRoleFrom(null), null);
  eq("owners can make admins", assignableRoles("owner"), ["admin", "editor", "viewer"]);
  eq("admins can't", assignableRoles("admin"), ["editor", "viewer"]);
  eq("editors give no roles", assignableRoles("editor"), []);
  eq("owners manage admins", canManageMember("owner", "admin"), true);
  eq("admins manage editors and viewers", [canManageMember("admin", "editor"), canManageMember("admin", "viewer")], [true, true]);
  eq("but not other admins, or the owner", [canManageMember("admin", "admin"), canManageMember("admin", "owner")], [false, false]);
  eq("editors manage nobody, not even viewers", canManageMember("editor", "viewer"), false);
  eq("nobody manages the owner", canManageMember("owner", "owner"), false);
}

// ------------------------------------------------------------ the board's parts
{
  const cam = new Camera(100, 50, 2);
  eq("the camera maps screen to world", cam.toWorld(20, 10), { x: 110, y: 55 });
  eq("and back", cam.toScreen({ x: 110, y: 55 }), { x: 20, y: 10 });
  const zoomed = cam.zoomedAt(200, 100, 4);
  eq("zooming keeps the point under the pointer", zoomed.toWorld(200, 100), cam.toWorld(200, 100));
  eq("zoom stops at 800%", new Camera(0, 0, 50).z, 8);
  eq("and at 10%", cam.zoomedAt(0, 0, 0.001).z, 0.1);
  eq("panning moves by screen pixels", cam.panned(40, -20).toWorld(0, 0), { x: 120, y: 40 });
  const fit = Camera.fitting({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1200, h: 800 }, 4);
  near("fitting fills 85% of the width", fit.z, (1200 * 0.85) / 1000);
  eq("centred", fit.center({ w: 1200, h: 800 }), { x: 500, y: 250 });
  const beside = Camera.fitting({ x: 0, y: 0, w: 1000, h: 500 }, { w: 1200, h: 800 }, 4, 400);
  near("beside a panel it fits what's left", beside.z, (800 * 0.85) / 1000);
  const pinch = cam.pinched({ x: 0, y: 0 }, 100, { x: 0, y: 0 }, 200);
  eq("spreading two fingers zooms in around them", [pinch.z, pinch.toWorld(0, 0)], [4, cam.toWorld(0, 0)]);
  eq("a saved camera reads back", Camera.parse(JSON.parse(JSON.stringify(cam))), cam);
  eq("anything else doesn't", [Camera.parse({ x: 1, y: "2", z: 1 }), Camera.parse(null)], [null, null]);

  const slide = () => ({ title: "Slide 1", order: 1 });
  const pen = DraftSession.start("pen", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  pen.addSamples([{ x: 0.1, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 3 }], 1);
  const stroke = pen.finish(1, () => ({ x: 0, y: 0, w: 1, h: 1 }));
  eq("a pen stroke skips samples closer than a step", stroke?.type === "stroke" ? stroke.points : null, [0, 0, 5, 0, 10, 3]);
  const snap = pen.snapshot();
  pen.addSamples([{ x: 20, y: 20 }], 1);
  eq("a snapshot doesn't change as the stroke goes on", snap.type === "stroke" && snap.points.length, 6);
  const long = DraftSession.start("pen", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  const samples = Array.from({ length: 20_005 }, (_, i) => ({ x: i + 1, y: 0 }));
  const cut = long.addSamples(samples, 0.5);
  eq("a very long stroke is cut, and carries on", [cut?.type, long.draft.type === "stroke" && long.draft.points.length < 100], ["stroke", true]);
  eq("the whole-stroke eraser has no draft", DraftSession.start("eraser", { x: 0, y: 0 }, DEFAULT_STYLE, { slide }), null);
  const rect = DraftSession.start("rect", { x: 10, y: 10 }, DEFAULT_STYLE, { slide })!;
  rect.reshape({ x: 40, y: 20 }, true, "16:9");
  eq("Shift keeps rectangles square", rect.draft.type === "rect" && [rect.draft.w, rect.draft.h], [30, 30]);
  const line = DraftSession.start("line", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  line.reshape({ x: 10, y: 1 }, true, "16:9");
  eq("and lines on 45° steps", line.draft.type === "line" && line.draft.y2, 0);
  const dot = DraftSession.start("rect", { x: 10, y: 10 }, DEFAULT_STYLE, { slide })!;
  eq("a click with a shape tool draws nothing", dot.finish(1, () => ({ x: 0, y: 0, w: 1, h: 1 })), null);
  const frame = DraftSession.start("frame", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  frame.reshape({ x: 160, y: 10 }, false, "16:9");
  eq("frames keep their shape while drawn", frame.draft.type === "frame" && [frame.draft.w, frame.draft.h], [160, 90]);
  const clicked = DraftSession.start("frame", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  const placed = clicked.finish(1, () => ({ x: -50, y: -25, w: 100, h: 50 }));
  eq("a click places a frame where it's told", placed?.type === "frame" && [placed.x, placed.w, placed.title], [-50, 100, "Slide 1"]);
  const graph = DraftSession.start("graph", { x: 0, y: 0 }, DEFAULT_STYLE, { slide })!;
  const g = graph.finish(2, () => ({ x: 0, y: 0, w: 1, h: 1 }));
  eq("a click with the graph tool makes one 480 × 320 on screen", g?.type === "graph" && [g.w, g.h], [240, 160]);

  const box = frameBox({ x: 0, y: 0 }, { x: 0, y: 0, w: 100, h: 100 }, "16:9", { w: 1000, h: 800 }, 1);
  near("a frame around something takes the frame shape", box.w / box.h, 16 / 9, 0.01);
  const viewFrame = frameBox({ x: 500, y: 400 }, null, "1:1", { w: 1000, h: 800 }, 1);
  eq("a clicked frame is most of the view, centred", [viewFrame.w, viewFrame.h, viewFrame.x + viewFrame.w / 2], [480, 480, 500]);
  const f1: CanvasElement = { id: "f", type: "frame", x: 0, y: 0, w: 100, h: 100, title: "Intro", order: 3.5 };
  const inside: CanvasElement = { id: "i", type: "rect", color: "#000", size: 2, fill: null, x: 10, y: 10, w: 20, h: 20 };
  eq("new slides go after the last", nextSlide([f1]), { title: "Slide 2", order: 4 });
  eq("frames carry what's inside", withFrameContents([f1, inside], new Set(["f"])).map((e) => e.id), ["f", "i"]);

  const keys = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;
  eq("P picks the pen", Shortcuts.commandFor(keys("p"), false), { kind: "tool", tool: "pen" });
  eq("but not when viewing only", Shortcuts.commandFor(keys("p"), true), null);
  eq("a key event with no key name (autofill) does nothing", Shortcuts.commandFor({ ...keys("p"), key: undefined as unknown as string }, false), null);
  eq("viewers can still lasso", Shortcuts.commandFor(keys("s"), true), { kind: "tool", tool: "lasso" });
  eq("I adds a picture", Shortcuts.commandFor(keys("i"), false), { kind: "action", action: "media" });
  eq("⌘D duplicates", Shortcuts.commandFor(keys("d", { metaKey: true }), false), { kind: "duplicate" });
  eq("viewers can copy but not cut", [Shortcuts.commandFor(keys("c", { ctrlKey: true }), true)?.kind, Shortcuts.commandFor(keys("x", { ctrlKey: true }), true)], ["copy", null]);
  eq("Shift+arrow nudges ten pixels", Shortcuts.commandFor(keys("ArrowLeft", { shiftKey: true }), false), { kind: "nudge", dx: -10, dy: 0, alone: false });
  eq("Alt+arrow moves a frame alone", Shortcuts.commandFor(keys("ArrowUp", { altKey: true }), false), { kind: "nudge", dx: 0, dy: -1, alone: true });
  eq("Shift+1 fits everything", Shortcuts.commandFor(keys("!", { shiftKey: true }), false), { kind: "fit-all" });

  const registry = ToolRegistry.shared;
  eq("one registry for the app", registry === ToolRegistry.shared, true);
  eq("every tool is in a dock group", registry.tools.every((t) => registry.groupOf(t.id)), true);
  eq("and every action", registry.actions.every((a) => registry.groupOf(a.id)), true);
  eq("keys are unique", new Set([...registry.tools, ...registry.actions].map((t) => t.key)).size, registry.tools.length + registry.actions.length);

  const clip = BoardClipboard.shared;
  eq("one clipboard for the tab", clip === BoardClipboard.shared, true);
  eq("ordinary text isn't copied elements", clip.read("hello"), null);
  eq("copied elements come back from their text", clip.read("canvas-elements:v1:" + JSON.stringify([inside]))?.[0]?.id, "i");
  const copies = cloneElements([inside], 10);
  eq("pasted copies get new ids, moved", [copies[0].id !== "i", copies[0].type === "rect" && copies[0].x], [true, 20]);
}

// ------------------------------------------------------------ strokes shared as they're drawn
{
  const out = new DraftOutbox();
  const inbox = new PeerDrafts();
  eq("nothing to send when not drawing", out.take(), undefined);
  const live: CanvasElement = { id: "s1", type: "stroke", color: "#000", size: 4, points: [0, 0, 1, 1], pressures: [0.5, 0.6] };
  out.set(live);
  const p1 = out.take()!;
  eq("the first piece starts at 0", [p1.from, p1.el.type === "stroke" && p1.el.points], [0, [0, 0, 1, 1]]);
  eq("then nothing until it grows", out.take(), undefined);
  if (live.type === "stroke") {
    live.points.push(2, 2, 3, 3);
    live.pressures!.push(0.7, 0.8);
  }
  const p2 = out.take()!;
  eq("then only the new points", [p2.from, p2.el.type === "stroke" && p2.el.points, p2.el.type === "stroke" && p2.el.pressures], [4, [2, 2, 3, 3], [0.7, 0.8]]);
  inbox.apply("tab", p1);
  const joined = inbox.apply("tab", p2);
  eq("the other side puts it back together", joined?.type === "stroke" && [joined.points, joined.pressures], [[0, 0, 1, 1, 2, 2, 3, 3], [0.5, 0.6, 0.7, 0.8]]);
  eq("a piece that doesn't follow on is ignored", inbox.apply("tab", { from: 20, el: { ...live, points: [9, 9] } })?.type === "stroke" && (inbox.apply("tab", undefined) as { points: number[] }).points.length, 8);
  const big: CanvasElement = { id: "s2", type: "stroke", color: "#000", size: 4, points: Array.from({ length: 1500 }, (_, i) => i) };
  out.set(big);
  const first = out.take()!;
  eq("long strokes go in pieces small enough for the bus", [first.from, first.el.type === "stroke" && first.el.points.length], [0, MAX_PIECE_COORDS]);
  eq("and the rest is still waiting", out.pending, true);
  out.set(null);
  eq("lifting the pointer sends null once", [out.take(), out.take()], [null, undefined]);
  const shape: CanvasElement = { id: "r", type: "rect", color: "#000", size: 2, fill: null, x: 0, y: 0, w: 10, h: 10 };
  out.set(shape);
  eq("shapes go whole", out.take()?.el.type, "rect");
  eq("and again only when they change", out.take(), undefined);
  if (shape.type === "rect") shape.w = 20;
  eq("like this", out.take()?.el.type === "rect", true);

  inbox.apply("tab", null, 1000);
  eq("a finished draft stays a moment, until it lands", inbox.visible(() => false, 1500).length, 1);
  eq("and goes once it has", inbox.visible((id) => id === "s1", 1600).length, 0);
  inbox.apply("other", { from: 0, el: shape }, 0);
  inbox.apply("other", null, 0);
  eq("or after a moment if it never does", inbox.visible(() => false, 2000).length, 0);
  inbox.apply("gone", { from: 0, el: shape }, 0);
  eq("drafts left behind mid-stroke go after 30 s", inbox.visible(() => false, 31_000).length, 0);

  eq("initials for people without a picture", [initials("Maya Chen"), initials("cher"), initials("  ")], ["MC", "CH", "?"]);
}

{
  // ---------------------------------------------------------------- triangles
  const tri = (i: Parameters<typeof solveTriangle>[0]) => solveTriangle(i);
  const sss = tri({ a: 3, b: 4, c: 5 });
  eq("SSS 3-4-5 is right", sss.ok && [sss.case, sss.right], ["SSS", true]);
  if (sss.ok) {
    near("SSS angle C = 90", sss.solutions[0].triangle.C, 90);
    near("SSS angle A", sss.solutions[0].triangle.A, 36.8699);
    near("SSS area 6", sss.solutions[0].area, 6);
    eq("SSS shows the law of cosines", sss.solutions[0].steps.some((s) => s.includes("\\cos A")), true);
  }
  eq("SSS that can't close", tri({ a: 1, b: 2, c: 3 }).ok, false);
  const sas = tri({ a: 5, b: 7, C: 49 });
  eq("SAS case", sas.ok && sas.case, "SAS");
  if (sas.ok) {
    near("SAS c", sas.solutions[0].triangle.c, 5.3, 0.01);
    near("SAS angles add to 180", sas.solutions[0].triangle.A + sas.solutions[0].triangle.B + sas.solutions[0].triangle.C, 180);
    near("SAS obtuse angle found right", sas.solutions[0].triangle.B, 85.6, 0.1);
  }
  const right = tri({ a: 3, b: 4, C: 90 });
  eq("a right angle uses Pythagoras", right.ok && right.solutions[0].steps[1].includes("Pythagoras"), true);
  const asa = tri({ A: 40, B: 60, c: 10 });
  eq("ASA case", asa.ok && asa.case, "ASA");
  if (asa.ok) near("ASA a", asa.solutions[0].triangle.a, 6.527, 0.01);
  const aas = tri({ A: 40, B: 60, a: 10 });
  eq("AAS case", aas.ok && aas.case, "AAS");
  if (aas.ok) near("AAS b", aas.solutions[0].triangle.b, 13.473, 0.01);
  const two = tri({ A: 30, a: 6, b: 10 });
  eq("SSA ambiguous: two triangles", two.ok && two.solutions.length, 2);
  if (two.ok) {
    near("SSA first B", two.solutions[0].triangle.B, 56.44, 0.01);
    near("SSA second B", two.solutions[1].triangle.B, 123.56, 0.01);
  }
  eq("SSA one triangle", (() => { const r = tri({ A: 30, a: 12, b: 10 }); return r.ok && r.solutions.length; })(), 1);
  const none = tri({ A: 30, a: 3, b: 10 });
  eq("SSA none", none.ok ? "ok" : none.error.startsWith("No triangle"), true);
  eq("three angles only", tri({ A: 50, B: 60, C: 70 }).ok, false);
  eq("too many angles", tri({ A: 100, B: 90, a: 3 }).ok, false);
  eq("four values", tri({ a: 1, b: 1, c: 1, A: 60 }).ok, false);
  if (sss.ok) {
    const k = triangleCorners(sss.solutions[0].triangle, 100);
    near("corner B on the x axis", k.B[0], 100);
    near("corner C above A-B", k.C[1], -48);
  }

  // ---------------------------------------------------------------- trig
  eq("sin 150", exactTrig("sin", 150).tex, "\\frac{1}{2}");
  eq("cos 135", exactTrig("cos", 135).tex, "-\\frac{\\sqrt{2}}{2}");
  eq("tan 240", exactTrig("tan", 240).tex, "\\sqrt{3}");
  eq("sec 300", exactTrig("sec", 300).tex, "2");
  eq("csc 210", exactTrig("csc", 210).tex, "-2");
  eq("cot 330", exactTrig("cot", 330).tex, "-\\sqrt{3}");
  eq("tan 90 undefined", exactTrig("tan", 90).undefined, true);
  eq("cot 180 undefined", exactTrig("cot", 180).undefined, true);
  eq("sin 270", exactTrig("sin", 270).tex, "-1");
  eq("cos -60 coterminal", exactTrig("cos", -60).tex, "\\frac{1}{2}");
  eq("sin 20 is a decimal", [exactTrig("sin", 20).exact, exactTrig("sin", 20).tex], [false, "0.342"]);
  eq("quadrant step", exactTrig("cos", 135).steps.some((s) => s.includes("quadrant II")), true);
  eq("parse degrees", parseAngle("150", "deg"), 150);
  eq("parse 5pi/6", parseAngle("5pi/6", "rad"), 150);
  eq("parse π", parseAngle("π", "rad"), 180);
  eq("parse -3π/2", parseAngle("-3π/2", "rad"), -270);
  eq("parse junk", parseAngle("abc", "rad"), null);
  eq("radians tex", [radiansTex(150), radiansTex(180), radiansTex(-90), radiansTex(0)], ["\\frac{5\\pi}{6}", "\\pi", "-\\frac{\\pi}{2}", "0"]);
  eq("reference angles", [referenceAngle(210), referenceAngle(300), referenceAngle(-30)], [30, 60, 30]);
  eq("unit point 225", [unitPoint(225).xTex, unitPoint(225).yTex], ["-\\frac{\\sqrt{2}}{2}", "-\\frac{\\sqrt{2}}{2}"]);

  // ---------------------------------------------------------------- proofs
  const proof = {
    given: "AB ≅ CD; BC ≅ DA",
    prove: "△ABC ≅ △CDA",
    rows: [
      { statement: "AB ≅ CD", reason: "Given" },
      { statement: "BC ≅ DA", reason: "Given" },
      { statement: "AC ≅ CA", reason: "Reflexive property" },
      { statement: "△ABC ≅ △CDA", reason: "SSS" },
    ],
  };
  eq("a well formed proof", lintProof(proof), []);
  eq("missing reason", lintProof({ ...proof, rows: [...proof.rows.slice(0, 3), { statement: "△ABC ≅ △CDA", reason: "" }] }).map((i) => i.row), [4]);
  eq("wrong last line", lintProof({ ...proof, rows: proof.rows.slice(0, 3) }).map((i) => i.message.startsWith("The last")), [true]);
  eq("Given that wasn't given", lintProof({ ...proof, rows: [{ statement: "AC ≅ BD", reason: "Given" }, ...proof.rows] }).map((i) => i.row), [1]);
  eq("latex and symbols compare equal", normalizeStatement("\\triangle ABC \\cong \\triangle CDA"), normalizeStatement("△ABC ≅ △CDA"));
  eq("proof as text", proofToText(proof).split("\n")[3], "1. AB ≅ CD | Given");
  const v = parseProofVerdict('```json\n{"valid":false,"summary":"Line 3 needs work","lines":[{"ok":true,"note":""},{"ok":false,"note":"why?"}]}\n```', 3);
  eq("proof verdict parsed", v && [v.valid, v.lines.map((l) => l.ok), v.lines[1].note], [false, [true, false, true], "why?"]);
  eq("proof verdict junk", parseProofVerdict("no json here", 2), null);

  // ---------------------------------------------------------------- stoichiometry
  const st = stoichiometry("H2 + O2 -> H2O", [{ value: 4, unit: "g" }, { value: 16, unit: "g" }], { 0: 15 });
  eq("limiting reagent", st.ok && st.limiting.species.body, "O2");
  if (st.ok) {
    near("water made", st.products[0].grams, 18.015, 0.01);
    near("hydrogen left", st.reactants[0].leftGrams, 1.984, 0.01);
    near("percent yield", st.products[0].percentYield!, 83.26, 0.05);
  }
  const st2 = stoichiometry("Fe + O2 -> Fe2O3", [{ value: 2, unit: "mol" }, undefined]);
  eq("excess reactant left blank", st2.ok && [st2.limiting.species.body, +st2.products[0].moles.toFixed(3)], ["Fe", 1]);
  eq("no amounts", stoichiometry("H2 + O2 -> H2O", []).ok, false);

  // ---------------------------------------------------------------- gas laws
  const g1 = idealGas({ n: { value: 1 }, T: { value: 0, unit: "C" }, P: { value: 1, unit: "atm" } });
  eq("molar volume key", g1.ok && g1.key, "V");
  if (g1.ok) near("molar volume at STP", g1.value, 22.41, 0.01);
  const g2 = idealGas({ P: { value: 101.325, unit: "kPa" }, V: { value: 22414, unit: "mL" }, T: { value: 273.15, unit: "K" } });
  if (g2.ok) near("moles from kPa and mL", g2.value, 1, 0.001);
  else eq("moles from kPa and mL", g2.error, "ok");
  eq("ideal gas needs three", idealGas({ P: { value: 1, unit: "atm" } }).ok, false);
  const boyle = combinedGas({ P1: 1, V1: 10, P2: 2, pUnit: "atm", vUnit: "L", tUnit: "K" });
  eq("Boyle's law", boyle.ok && [boyle.key, boyle.value, boyle.steps[0].includes("Boyle")], ["V2", 5, true]);
  const charles = combinedGas({ V1: 2, T1: 27, T2: 127, pUnit: "atm", vUnit: "L", tUnit: "C" });
  if (charles.ok) near("Charles's law with °C", charles.value, 2.6662, 0.001);
  else eq("Charles's law with °C", charles.error, "ok");
  const comb = combinedGas({ P1: 1, V1: 2, T1: 300, P2: 2, V2: 1, pUnit: "atm", vUnit: "L", tUnit: "K" });
  if (comb.ok) near("combined T2", comb.value, 300);
  const combP = combinedGas({ V1: 2, T1: 300, P2: 2, V2: 1, T2: 300, pUnit: "atm", vUnit: "L", tUnit: "K" });
  if (combP.ok) near("combined P1", combP.value, 1);
  else eq("combined P1", combP.error, "ok");
  eq("two blanks", combinedGas({ P1: 1, V1: 2, pUnit: "atm", vUnit: "L", tUnit: "K" }).ok, false);

  // ---------------------------------------------------------------- solutions and pH
  const m1 = molarity({ formula: "NaCl", grams: 58.44, liters: 2 });
  if (m1.ok) near("molarity from grams", m1.value, 0.5, 0.001);
  else eq("molarity from grams", m1.error, "ok");
  const m2 = molarity({ formula: "NaOH", molarity: 0.1, liters: 0.25 });
  if (m2.ok) near("grams needed", m2.value, 0.99997, 0.001);
  eq("molarity needs two", molarity({ liters: 1 }).ok, false);
  const dl = dilution({ M1: 6, V1: 50, M2: 1.5 });
  eq("dilution V2", dl.ok && dl.value, 200);
  eq("dilution can't concentrate", dilution({ M1: 1, V1: 10, V2: 5 }).ok, false);
  const p1 = ph({ kind: "strong-acid", value: 0.01 });
  if (p1.ok) near("strong acid pH", p1.pH, 2);
  const p2 = ph({ kind: "strong-base", value: 0.005, ions: 2 });
  if (p2.ok) near("Ca(OH)2 pH", p2.pH, 12);
  const p3 = ph({ kind: "weak-acid", value: 0.1, k: 1.8e-5 });
  if (p3.ok) near("acetic acid pH", p3.pH, 2.875, 0.005);
  const p4 = ph({ kind: "pOH", value: 4 });
  if (p4.ok) eq("pOH to pH", [+p4.pH.toFixed(2), p4.steps.at(-1)], [10, "\\text{Basic}"]);
  eq("negative concentration", ph({ kind: "H", value: -1 }).ok, false);
}

const figureTests = (async () => {
  // ---------------------------------------------------------------- worksheets
  const m = (id: string, source: string, x: number, y: number, syntax: "tex" | "chem" = "tex") =>
    ({ id, type: "math" as const, syntax, source, color: "#000000", x, y, size: 20, w: 100, h: 24 });
  const els = [m("c", "x^2 = 9", 0, 200), m("b", "3x = 12", 300, 5), m("a", "2x + 1 = 5", 0, 0), m("h", "H2 + O2 -> H2O", 0, 100, "chem")];
  eq("equations in reading order, chemistry left out", problemsFromElements(els), ["2x + 1 = 5", "3x = 12", "x^2 = 9"]);
  eq("only the selected ones", problemsFromElements(els, new Set(["c"])), ["x^2 = 9"]);
  eq(
    "labels, answers and working aren't problems",
    ["90^\\circ", "c = 5", "\\theta = \\frac{3\\pi}{4}", "(-\\frac{\\sqrt{2}}{2},\\ \\frac{1}{2})", "\\begin{array}{l} a \\end{array}", "x = 4"].map(isProblem),
    [false, false, false, false, false, false],
  );
  eq("problems are", ["2x + 3 = 11", "x^2 - 9 = 0", "\\int_0^1 x\\,dx", "y = 2x + 1", "\\frac{3}{4} + \\frac{1}{6}"].map(isProblem), [true, true, true, true, true]);
  const ws = parseWorksheetReply({ title: "Linear", problems: [{ prompt: "2x=4", answer: "x=2" }, "y+1=2", { nope: 1 }, { prompt: "" }] }, "Fallback");
  eq("worksheet reply parsed", ws && [ws.title, ws.instructions, ws.problems], ["Linear", "Show your work.", [{ prompt: "2x=4", answer: "x=2" }, { prompt: "y+1=2", answer: null }]]);
  eq("worksheet reply with nothing usable", parseWorksheetReply({ problems: [] }, "x"), null);
  eq("worksheet fallback title", parseWorksheetReply({ problems: ["a"] }, "Topic")?.title, "Topic");
  eq("answers laid on the drawing's problems", withAnswers(["a", "b"], ws), [{ prompt: "a", answer: "x=2" }, { prompt: "b", answer: null }]);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sh = shuffled([1, 2, 3, 4, 5], rnd);
  eq("shuffle keeps every item", sh.slice().sort(), [1, 2, 3, 4, 5]);

  // ---------------------------------------------------------------- figures
  const measure = async (tex: string) => ({ width: Math.min(20, tex.length * 0.3), height: 1.2 });
  const sas = solveTriangle({ a: 5, b: 7, C: 49 });
  if (sas.ok) {
    const fig = await triangleFigure(sas.solutions[0], sas.case, "#112233", measure);
    eq("triangle: three sides drawn", fig.filter((p) => p.type === "line").length, 3);
    eq("triangle: corners named", fig.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).slice(0, 3), ["A", "B", "C"]);
    eq("triangle: working typeset", fig.some((p) => p.type === "math" && p.source.startsWith("\\begin{array}")), true);
    eq("every equation fits the canvas's limit", fig.every((p) => p.type !== "math" || p.source.length <= 2000), true);
  }
  const right = solveTriangle({ a: 3, b: 4, c: 5 });
  if (right.ok) eq("right angle gets its square", (await triangleFigure(right.solutions[0], "SSS", "#000000", measure)).filter((p) => p.type === "line").length, 5);
  const circle = await unitCircleFigure(150, "deg", { tex: "\\frac12", steps: ["\\sin 150^\\circ = \\frac12"] }, "#000000", measure);
  eq("unit circle: 16 special angles marked", circle.filter((p) => p.type === "ellipse" && p.w === 8).length, 16);
  eq("unit circle: the angle's point", circle.some((p) => p.type === "math" && p.source === "(-\\frac{\\sqrt{3}}{2},\\ \\frac{1}{2})"), true);
  const pf = await proofFigure(
    { given: "a", prove: "b", rows: [{ statement: "a", reason: "Given" }, { statement: "b", reason: "Magic" }] },
    { valid: false, summary: "Line 2 needs a real reason.", lines: [{ ok: true, note: "" }, { ok: false, note: "No such theorem." }] },
    "#000000",
  );
  const texts = pf.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
  eq("proof table: numbered statements and reasons", ["1.  a", "Given", "2.  b", "Magic"].every((t) => texts.includes(t)), true);
  eq("proof table: marks and notes", [texts.includes("✓"), texts.includes("✗"), texts.includes("No such theorem.")], [true, true, true]);
  const many = { title: "Practice", instructions: "Solve.", problems: Array.from({ length: 12 }, (_, i) => ({ prompt: `x + ${i} = ${i * 2}`, answer: `x = ${i}` })) };
  const wf = await worksheetFigure(many, "#000000", measure, { workSpace: 130 });
  const frames = wf.filter((p) => p.type === "frame") as { title: string; x: number; y: number }[];
  eq("worksheet pages and answer key", frames.map((f) => f.title), ["Practice (page 1)", "Practice (page 2)", "Practice (page 3)", "Answer key"]);
  eq("answer key beside the first page", [frames[3].x, frames[3].y], [PAGE.w + 80, 0]);
  const inside = wf.filter((p) => p.type === "math" && p.x < PAGE.w);
  eq("every problem on a page", inside.every((p) => p.type === "math" && (p.y % (PAGE.h + 80)) + p.h <= PAGE.h), true);
  eq("twelve problems placed", inside.length, 12);
  eq("steps as one block", stepsToTex(["a", "b"]), "\\begin{array}{l} \\displaystyle a \\\\[6pt] \\displaystyle b \\end{array}");
})();

void figureTests.then(() => {
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
});
