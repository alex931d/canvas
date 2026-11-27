/** Working lines as one left-aligned equation block, for placing on the canvas. */
export function stepsToTex(steps: string[]): string {
  return `\\begin{array}{l} ${steps.map((s) => `\\displaystyle ${s}`).join(" \\\\[6pt] ")} \\end{array}`;
}
