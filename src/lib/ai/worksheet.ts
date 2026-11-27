import "server-only";

import { parseWorksheetReply, type Worksheet, type WorksheetRequest } from "@/lib/math/worksheet";
import { AiError, askAi, parseJsonReply } from "./chat";

/**
 * Practice problems and answer keys for worksheets: problems on a topic,
 * more like the ones on a drawing, or the answers to the drawing's own.
 */

const SHAPE = `Reply with JSON only, no prose around it, in this shape:
{
  "title": "a short worksheet title",
  "instructions": "one short line for the student, e.g. Solve for x. Show your work.",
  "problems": [{ "prompt": "LaTeX of the problem; words go in \\\\text{}", "answer": "LaTeX of the final answer only" }]
}
Write LaTeX that MathJax can typeset (no \\begin{document}, no dollar signs). Keep every prompt to one or two short lines.`;

const LEVEL = {
  gentle: "warm-up level: one or two steps each, friendly numbers",
  standard: "standard homework level",
  challenge: "challenge level: several steps, less friendly numbers, still solvable by hand",
};

function prompt(req: WorksheetRequest): { system: string; user: string; title: string } {
  switch (req.mode) {
    case "topic":
      return {
        title: req.topic,
        system: `You write math practice worksheets for students. Write exactly ${req.count} problems on the topic given, ${LEVEL[req.level]}, starting easier and getting harder. Every problem must have one clear answer, and the answer must be correct: work each one out before you write it.\n\n${SHAPE}`,
        user: `Topic: ${req.topic}`,
      };
    case "similar":
      return {
        title: "Practice",
        system: `You write math practice worksheets for students. You get problems a student has been working on. Write exactly ${req.count} new problems that practise the same skills, ${LEVEL[req.level]}. Don't copy the originals. Every problem must have one clear answer, and the answer must be correct: work each one out before you write it.\n\n${SHAPE}`,
        user: `The student's problems, one per line:\n${req.problems.join("\n")}`,
      };
    case "key":
      return {
        title: "Worksheet",
        system: `You write answer keys for math worksheets. You get the worksheet's problems, one per line, in LaTeX. Keep every prompt exactly as given, in the same order, and give each one's final answer. If a line is already a worked equation rather than a question, its answer is what it simplifies or solves to. Work each one out before you write it.\n\n${SHAPE}`,
        user: req.problems.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      };
  }
}

export async function makeWorksheet(req: WorksheetRequest): Promise<Worksheet> {
  const { system, user, title } = prompt(req);
  const text = await askAi({
    name: "worksheet maker",
    system,
    user,
    temperature: req.mode === "key" ? 0 : 0.7,
    tooLong: "The AI took too long to write the worksheet. Try fewer problems.",
  });
  let raw: unknown = null;
  try {
    raw = parseJsonReply(text);
  } catch {
    /* handled below */
  }
  const sheet = parseWorksheetReply(raw, title);
  if (!sheet) throw new AiError("The AI didn't return any problems. Try again, or change the topic.", 502);
  return sheet;
}
