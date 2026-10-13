import path from "node:path";
import { InvalidArgumentError } from "commander";
import { editorProblem } from "../graph/editor.js";

export function parsePositiveInt(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new InvalidArgumentError("Expected a positive integer.");
  return number;
}

/** `--editor`: a built-in editor name, "none" or a URL template. */
export function parseEditor(value: string): string {
  const problem = editorProblem(value);
  if (problem) throw new InvalidArgumentError(problem);
  return value;
}

/** The editor from LOGICTRAIL_EDITOR, or an error message when it isn't usable. */
export function editorFromEnv(): { editor?: string; problem?: string } {
  const value = process.env.LOGICTRAIL_EDITOR?.trim();
  if (!value) return {};
  const problem = editorProblem(value);
  return problem ? { problem: `LOGICTRAIL_EDITOR: ${problem}` } : { editor: value };
}

/** A written file as the user would type it: "./.logictrail/x.html", or absolute outside cwd. */
export function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file) || file;
  return relative.startsWith("..") ? file : `./${relative.split(path.sep).join("/")}`;
}
