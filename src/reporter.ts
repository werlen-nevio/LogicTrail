/**
 * Progress reporting used by the pipeline. The CLI provides a terminal
 * implementation; library users get a silent one unless they pass their own.
 */
export interface Reporter {
  /** A new phase starts, e.g. "Indexing repository". */
  phase(title: string): void;
  /** A completed step, e.g. "427 files". */
  success(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  /** Only shown in verbose mode. */
  debug(message: string): void;
  /** Determinate progress within the current phase. */
  progress(label: string, done: number, total: number): void;
  /** Indeterminate work; returns a function that stops the activity indicator. */
  activity(label: string): () => void;
}

export const silentReporter: Reporter = {
  phase: () => undefined,
  success: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  progress: () => undefined,
  activity: () => () => undefined,
};
