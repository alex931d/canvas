// Unit checks for the pure parts of the new features: the chemistry
// parser, molar masses and the balancer, the graph expression parser, the
// collaboration document model (two simulated tabs and a fake server),
// to-do board layout and card moves, byte ranges for video, the schemas,
// the seasonal themes' dates, tracing pictures into strokes, and frames
// as slides (order, what a frame carries, the journey's camera path), who
// may do what in a team workspace, the board's own parts (the camera,
// drawing a stroke or shape, keys, the clipboard, the tool registry), and
// the free plan (what needs the membership, saving in the browser).
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
import { CollabDoc, type RemoteChange } from "../src/lib/collab/doc";
import { canUse, MEMBER_FEATURES } from "../src/lib/billing/plan";
import { applyOps, type DocOp } from "../src/lib/collab/ops";
import { compileExpression, ExprError, formatTick, niceStep } from "../src/lib/math/expr";
import { easterSunday, resolveTheme, themeForDate } from "../src/lib/seasons";
import { adminHref, pageWindow, parseAdminQuery } from "../src/lib/admin/query";
import { ElementEffects, inkLength, MAX_ANIMATED, staggerStep, traceDuration } from "../src/lib/canvas/effects";
import { KanbanEffects } from "../src/lib/canvas/kanban-fx";
import { DEFAULT_PREFERENCES, parsePreferences } from "../src/lib/preferences";
import { avatarUrl, sniffImageType } from "../src/lib/profile/avatar";
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

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
