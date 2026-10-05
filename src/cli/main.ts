#!/usr/bin/env node
import { createProgram } from "./program.js";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  console.error(`\nUnexpected error: ${(error as Error).stack ?? String(error)}`);
  console.error("Please report this at https://github.com/werlen-nevio/LogicTrail/issues");
  process.exitCode = 1;
}
