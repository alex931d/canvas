/**
 * Functions of x for graphs, typed the way students write them:
 *
 *   y = x^2 - 3x + 2     sin x     2sin(3x)     sin^2 x     |x - 1|
 *   sqrt(x)   e^(-x^2)   ln x   log(2, x)   1/x   pi*x   3.5e-2x
 *
 * Parsed by hand into a tree of closures: no eval, no Function(), so text
 * from a shared drawing can only ever compute a number.
 */

export class ExprError extends Error {}

export type Compiled = (x: number) => number;

type Fn1 = (a: number) => number;

const FUNCS1: Record<string, Fn1> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (a) => 1 / Math.cos(a),
  csc: (a) => 1 / Math.sin(a),
  cot: (a) => 1 / Math.tan(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  sgn: Math.sign,
};

const FUNCS2: Record<string, (a: number, b: number) => number> = {
  min: Math.min,
  max: Math.max,
  mod: (a, b) => ((a % b) + b) % b,
  // log(base, x)
  log: (b, a) => Math.log(a) / Math.log(b),
};

const INVERSE: Record<string, string> = { sin: "asin", cos: "acos", tan: "atan" };

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

/** Every name, longest first, so "sinh" wins over "sin" and "exp" over "e". */
const NAMES = [...new Set([...Object.keys(FUNCS1), ...Object.keys(FUNCS2), ...Object.keys(CONSTANTS), "x"])].sort(
  (a, b) => b.length - a.length,
);

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "name"; v: string; at: number }
  | { t: "op"; v: string; at: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (num && (/\d/.test(ch) || ch === ".")) {
      out.push({ t: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    if (/[a-zA-Zπ√]/.test(ch)) {
      const word = src.slice(i).match(/^[a-zA-Zπ√]+(?:2|10)?/)![0];
      // "log2"/"log10" keep their digits; other trailing digits are numbers.
      const run = /^log(2|10)$/.test(word) ? word : word.replace(/\d+$/, "");
      out.push(...splitNames(run, i));
      i += run.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "**") {
      out.push({ t: "op", v: "^", at: i });
      i += 2;
      continue;
    }
    const op = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-" }[ch] ?? ch;
    if ("+-*/^(),|".includes(op)) {
      out.push({ t: "op", v: op, at: i });
      i++;
      continue;
    }
    throw new ExprError(`"${ch}" can't be used here.`);
  }
  return out;
}

/** "xsinx" → x, sin, x. */
function splitNames(word: string, at: number): Token[] {
  const out: Token[] = [];
  let rest = word.replace(/π/g, "pi").replace(/√/g, "sqrt");
  let offset = 0;
  while (rest) {
    const lower = rest.toLowerCase();
    const name = NAMES.find((n) => lower.startsWith(n));
    if (!name) {
      const bad = rest.match(/^[a-z]+/i)?.[0] ?? rest[0];
      // "sinn": a misspelt function, not a function times n.
      const last = out.at(-1)?.v;
      if (last && (last in FUNCS1 || last in FUNCS2)) {
        throw new ExprError(`"${word}" isn't a function I know. Try sin, cos, sqrt, ln, log, abs or exp.`);
      }
      if (/^y$/i.test(bad)) throw new ExprError('Write the function of x only, like "x^2 + 1".');
      if (/^[a-wz]$/i.test(bad)) throw new ExprError(`Use x as the variable ("${bad}" isn't defined).`);
      throw new ExprError(`"${bad}" isn't a function I know. Try sin, cos, sqrt, ln, log, abs or exp.`);
    }
    out.push({ t: "name", v: name, at: at + offset });
    rest = rest.slice(name.length);
    offset += name.length;
  }
  return out;
}

class Parser {
  private i = 0;
  private absDepth = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Compiled {
    if (this.tokens.length === 0) throw new ExprError("Type a function of x, like x^2 or sin(x).");
    const node = this.sum();
    const extra = this.peek();
    if (extra) {
      if (extra.v === ")") throw new ExprError('There\'s a ")" without a matching "(".');
      throw new ExprError(`Unexpected "${extra.v}".`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private isOp(v: string) {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }

  private sum(): Compiled {
    let left = this.product();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.tokens[this.i++].v;
      const right = this.product();
      const a = left;
      left = op === "+" ? (x) => a(x) + right(x) : (x) => a(x) - right(x);
    }
    return left;
  }

  /** Can the next token start a factor (for implicit multiplication)? */
  private startsFactor(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.t === "num" || t.t === "name") return true;
    if (t.t === "op" && t.v === "(") return true;
    if (t.t === "op" && t.v === "|") return this.absDepth === 0;
    return false;
  }

  private product(): Compiled {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = this.tokens[this.i++].v;
        const right = this.unary();
        const a = left;
        left = op === "*" ? (x) => a(x) * right(x) : (x) => a(x) / right(x);
      } else if (this.startsFactor()) {
        const right = this.power();
        const a = left;
        left = (x) => a(x) * right(x);
      } else {
        return left;
      }
    }
  }

  private unary(): Compiled {
    if (this.isOp("-")) {
      this.i++;
      const inner = this.unary();
      return (x) => -inner(x);
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Compiled {
    const base = this.primary();
    if (this.isOp("^")) {
      this.i++;
      const exp = this.unary();
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  private primary(): Compiled {
    const t = this.peek();
    if (!t) throw new ExprError("The function ends too early: something is missing at the end.");
    this.i++;
    if (t.t === "num") {
      const v = t.v;
      return () => v;
    }
    if (t.t === "name") {
      if (t.v === "x") return (x) => x;
      if (t.v in CONSTANTS) {
        const v = CONSTANTS[t.v];
        return () => v;
      }
      return this.call(t.v);
    }
    if (t.v === "(") {
      const inner = this.sum();
      if (!this.isOp(")")) throw new ExprError('A "(" is never closed: add ")".');
      this.i++;
      return inner;
    }
    if (t.v === "|") {
      this.absDepth++;
      const inner = this.sum();
      this.absDepth--;
      if (!this.isOp("|")) throw new ExprError('An absolute value "|" is never closed.');
      this.i++;
      return (x) => Math.abs(inner(x));
    }
    if (t.v === ")") throw new ExprError('There\'s a ")" without a matching "(".');
    throw new ExprError(`Something is missing before "${t.v}".`);
  }

  private call(name: string): Compiled {
    // sin^2 x = (sin x)^2; sin^-1 x = arcsin x
    let power: Compiled | null = null;
    if (this.isOp("^")) {
      this.i++;
      const negative = this.isOp("-");
      const next = this.tokens[this.i + (negative ? 1 : 0)];
      if (negative && next?.t === "num" && next.v === 1 && INVERSE[name]) {
        this.i += 2;
        name = INVERSE[name];
      } else {
        power = this.unary();
      }
    }
    let result: Compiled;
    if (this.isOp("(")) {
      this.i++;
      const args = [this.sum()];
      while (this.isOp(",")) {
        this.i++;
        args.push(this.sum());
      }
      if (!this.isOp(")")) throw new ExprError(`"${name}(" is never closed: add ")".`);
      this.i++;
      if (args.length === 1) {
        const f = FUNCS1[name];
        if (!f) throw new ExprError(`${name} needs two numbers, like ${name}(x, 2).`);
        const [a] = args;
        result = (x) => f(a(x));
      } else if (args.length === 2) {
        const f = FUNCS2[name];
        if (!f) throw new ExprError(`${name} takes one number.`);
        const [a, b] = args;
        result = (x) => f(a(x), b(x));
      } else {
        throw new ExprError(`${name} takes at most two numbers.`);
      }
    } else {
      // "sin x", "sin 2x", "ln x^2": a run of simple factors, no + or -.
      const f = FUNCS1[name];
      if (!f) throw new ExprError(`${name} needs brackets, like ${name}(x, 2).`);
      if (!this.peek() || !this.startsFactor()) throw new ExprError(`${name} needs something to work on, like ${name}(x).`);
      let arg = this.power();
      while (this.peek()?.t === "num" || (this.peek()?.t === "name" && !(this.peek()!.v in FUNCS1))) {
        const next = this.power();
        const a = arg;
        arg = (x) => a(x) * next(x);
      }
      const a = arg;
      result = (x) => f(a(x));
    }
    if (power) {
      const p = power;
      const r = result;
      return (x) => Math.pow(r(x), p(x));
    }
    return result;
  }
}

/** Strip "y =", "f(x) =" so either form works. */
export function stripLhs(src: string): string {
  return src.replace(/^\s*(y|[a-z]\s*\(\s*x\s*\))\s*=\s*/i, "");
}

/** Compile; throws ExprError with a message meant for the student. */
export function compileExpression(src: string): Compiled {
  if (src.length > 200) throw new ExprError("That's too long for one function.");
  return new Parser(tokenize(stripLhs(src))).parse();
}

const cache = new Map<string, Compiled | ExprError>();

/** Cached compile that never throws (for rendering). */
export function compiledOrError(src: string): Compiled | ExprError {
  let hit = cache.get(src);
  if (!hit) {
    try {
      hit = compileExpression(src);
    } catch (err) {
      hit = err instanceof ExprError ? err : new ExprError("That function can't be read.");
    }
    if (cache.size > 500) cache.clear();
    cache.set(src, hit);
  }
  return hit;
}

/** Tick spacing of 1, 2 or 5 × 10^n giving about `target` ticks. */
export function niceStep(span: number, target = 8): number {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}

/** Tick label without float noise: 0.30000000000000004 → "0.3". */
export function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const s = (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(Math.min(decimals, 8));
  return s.replace("-", "−");
}
