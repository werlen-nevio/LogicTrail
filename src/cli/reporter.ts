import pc from "picocolors";
import type { Reporter } from "../reporter.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Human-friendly progress output on stderr; animated only on a TTY. */
export class TerminalReporter implements Reporter {
  private readonly interactive: boolean;
  private lastProgress = 0;
  private progressVisible = false;

  constructor(
    private readonly stream: NodeJS.WriteStream = process.stderr,
    private readonly verbose = false,
  ) {
    this.interactive = Boolean(stream.isTTY) && !process.env.CI;
  }

  header(version: string): void {
    this.write(`${pc.bold("LogicTrail")} ${pc.dim(`v${version}`)}\n`);
  }

  phase(title: string): void {
    this.clearProgress();
    this.write(`\n${title.endsWith('"') ? title : `${title}…`}\n`);
  }

  success(message: string): void {
    this.clearProgress();
    this.write(`${pc.green("✓")} ${message}\n`);
  }

  info(message: string): void {
    this.clearProgress();
    this.write(`${pc.dim(message)}\n`);
  }

  warn(message: string): void {
    this.clearProgress();
    this.write(`${pc.yellow("!")} ${pc.yellow(message)}\n`);
  }

  debug(message: string): void {
    if (!this.verbose) return;
    this.clearProgress();
    this.write(`${pc.dim(`  · ${message}`)}\n`);
  }

  error(message: string, hints: readonly string[] = []): void {
    this.clearProgress();
    this.write(`\n${pc.red("✗")} ${message}\n`);
    for (const hint of hints) this.write(`  ${pc.dim(hint)}\n`);
  }

  progress(label: string, done: number, total: number): void {
    if (!this.interactive || total < 50) return;
    const now = Date.now();
    if (done < total && now - this.lastProgress < 80) return;
    this.lastProgress = now;
    this.stream.write(`\r${pc.dim(`${label} ${done}/${total}`)}\x1b[K`);
    this.progressVisible = true;
    if (done >= total) this.clearProgress();
  }

  activity(label: string): () => void {
    this.clearProgress();
    if (!this.interactive) {
      this.write(`${pc.dim(`${label}…`)}\n`);
      return () => undefined;
    }
    let frame = 0;
    const started = Date.now();
    const render = (): void => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      this.stream.write(
        `\r${pc.cyan(SPINNER[frame % SPINNER.length] ?? "")} ${label}… ${pc.dim(`${seconds}s`)}\x1b[K`,
      );
      frame++;
    };
    render();
    const timer = setInterval(render, 90);
    return () => {
      clearInterval(timer);
      this.stream.write("\r\x1b[K");
    };
  }

  private clearProgress(): void {
    if (this.progressVisible) {
      this.stream.write("\r\x1b[K");
      this.progressVisible = false;
    }
  }

  private write(text: string): void {
    this.stream.write(text);
  }
}
