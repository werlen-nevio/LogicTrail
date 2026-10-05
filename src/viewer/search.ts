import type { LogicNode } from "../graph/model.js";
import { NODE_TYPE_LABELS } from "../render/theme.js";
import { clear, h } from "./dom.js";

const MAX_RESULTS = 12;

interface Match {
  node: LogicNode;
  rank: number;
}

/** Node search: filters as you type, highlights matches, Enter jumps to the best one. */
export class NodeSearch {
  private matches: Match[] = [];
  private active = 0;

  constructor(
    private readonly input: HTMLInputElement,
    private readonly results: HTMLElement,
    private readonly nodes: readonly LogicNode[],
    private readonly onPreview: (ids: ReadonlySet<string> | null) => void,
    private readonly onPick: (id: string) => void,
  ) {
    input.addEventListener("input", () => this.update());
    input.addEventListener("focus", () => {
      if (input.value.trim()) this.update();
    });
    input.addEventListener("keydown", (event) => this.onKeyDown(event));
    input.addEventListener("blur", () => window.setTimeout(() => this.close(), 120));
  }

  focus(): void {
    this.input.focus();
    this.input.select();
  }

  reset(): void {
    this.input.value = "";
    this.close();
    this.onPreview(null);
  }

  private update(): void {
    const query = this.input.value.trim().toLowerCase();
    if (!query) {
      this.close();
      this.onPreview(null);
      return;
    }
    this.matches = this.nodes
      .map((node) => ({ node, rank: rank(node, query) }))
      .filter((match) => match.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.node.label.localeCompare(b.node.label));
    this.active = 0;
    this.onPreview(new Set(this.matches.map((match) => match.node.id)));
    this.render();
  }

  private render(): void {
    clear(this.results);
    this.results.hidden = false;
    if (this.matches.length === 0) {
      this.results.appendChild(h("div", { class: "search__empty" }, "No matching nodes"));
      return;
    }
    this.matches.slice(0, MAX_RESULTS).forEach((match, index) => {
      const location = match.node.file
        ? `${match.node.file}${match.node.line ? `:${match.node.line}` : ""}`
        : NODE_TYPE_LABELS[match.node.type];
      const item = h(
        "button",
        {
          class: "search__item",
          type: "button",
          role: "option",
          "aria-selected": index === this.active ? "true" : "false",
        },
        h("span", { class: "link-list__dot", style: `--swatch: var(--lt-c-${match.node.type})` }),
        h("span", { class: "search__label" }, match.node.label),
        h("span", { class: "search__file" }, location),
      );
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.pick(index);
      });
      this.results.appendChild(item);
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = Math.min(this.matches.length, MAX_RESULTS);
      if (count === 0) return;
      this.active = (this.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      this.render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.pick(this.active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.reset();
      this.input.blur();
    }
  }

  private pick(index: number): void {
    const match = this.matches[index];
    if (!match) return;
    this.close();
    this.onPick(match.node.id);
  }

  private close(): void {
    this.results.hidden = true;
    clear(this.results);
  }
}

function rank(node: LogicNode, query: string): number {
  const label = node.label.toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  if (node.file?.toLowerCase().includes(query)) return 40;
  if (node.type.includes(query)) return 30;
  if (node.description?.toLowerCase().includes(query)) return 20;
  return 0;
}
