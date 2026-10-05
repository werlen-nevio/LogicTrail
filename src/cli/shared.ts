import path from "node:path";
import { InvalidArgumentError } from "commander";

export function parsePositiveInt(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new InvalidArgumentError("Expected a positive integer.");
  return number;
}

/** A written file as the user would type it: "./.logictrail/x.html", or absolute outside cwd. */
export function displayPath(file: string): string {
  const relative = path.relative(process.cwd(), file) || file;
  return relative.startsWith("..") ? file : `./${relative.split(path.sep).join("/")}`;
}
