import type { LogicEdge, LogicNode, LogicTrailGraph, SourceEvidence } from "../graph/model.js";
import { NODE_ICONS, NODE_TYPE_LABELS } from "../render/theme.js";
import { clear, copyText, h, icon } from "./dom.js";
import { renderSnippet } from "./highlight.js";
import { renderMarkdown } from "./markdown.js";
import { asText } from "../util/text.js";

export interface PanelContext {
  graph: LogicTrailGraph;
  nodes: ReadonlyMap<string, LogicNode>;
  edges: ReadonlyMap<string, LogicEdge>;
  incoming: ReadonlyMap<string, LogicEdge[]>;
  outgoing: ReadonlyMap<string, LogicEdge[]>;
  onSelectNode: (id: string) => void;
  onClose: () => void;
}

const CLOSE_ICON = "M4 4l8 8M12 4l-8 8";

const METADATA_LABELS: readonly [string, string][] = [
  ["method", "Method"],
  ["path", "Path"],
  ["framework", "Framework"],
  ["system", "System"],
  ["model", "Model"],
  ["operation", "Operation"],
  ["access", "Access"],
  ["service", "Service"],
  ["package", "Package"],
  ["category", "Category"],
  ["channel", "Channel"],
  ["event", "Event"],
  ["url", "URL"],
  ["status", "Status"],
  ["errorName", "Error"],
  ["message", "Message"],
  ["test", "Condition"],
  ["signature", "Signature"],
  ["async", "Async"],
  ["pages", "Pages"],
  ["envVars", "Environment"],
  ["directives", "Directives"],
];

export class Panel {
  constructor(
    private readonly root: HTMLElement,
    private readonly context: PanelContext,
  ) {}

  showOverview(): void {
    const { graph } = this.context;
    const section = h("section", { class: "panel__section" });
    section.append(h("p", { class: "eyebrow" }, "Flow"), h("h1", {}, graph.title));
    if (graph.title.trim().toLowerCase() !== graph.query.trim().toLowerCase()) {
      section.appendChild(h("p", { class: "question" }, `“${graph.query}”`));
    }
    for (const warning of graph.analysis.warnings)
      section.appendChild(h("div", { class: "notice" }, warning));

    section.appendChild(h("h2", {}, "Explanation"));
    const prose = h("div", { class: "prose" });
    prose.appendChild(renderMarkdown(graph.explanation));
    section.appendChild(prose);

    if (graph.entryPoints.length > 0) {
      section.appendChild(h("h2", {}, "Entry points"));
      section.appendChild(
        this.nodeList(graph.entryPoints.flatMap((id) => this.context.nodes.get(id) ?? [])),
      );
    }

    section.appendChild(h("h2", {}, "Analysis"));
    const inferred = graph.edges.filter((edge) => edge.source === "inferred").length;
    const stats = h("div", { class: "stats" });
    const stat = (value: number | string, label: string): HTMLElement =>
      h(
        "div",
        { class: "stat" },
        h("div", { class: "stat__value" }, value),
        h("div", { class: "stat__label" }, label),
      );
    stats.append(
      stat(graph.nodes.length, "nodes in flow"),
      stat(graph.edges.length, inferred > 0 ? `edges (${inferred} inferred)` : "edges"),
      stat(graph.analysis.stats.files, "files indexed"),
      stat(graph.analysis.stats.symbols, "symbols"),
    );
    section.appendChild(stats);
    const provider =
      graph.analysis.provider === "static"
        ? "Static analysis only (no LLM)"
        : `Semantic layer: ${graph.analysis.model ?? graph.analysis.provider}`;
    section.appendChild(
      h(
        "p",
        { class: "footer-note" },
        `${provider} · ${graph.analysis.repository} · generated ${new Date(graph.analysis.generatedAt).toLocaleString()}`,
      ),
    );

    section.appendChild(h("h2", {}, "Shortcuts"));
    const shortcuts = h("div", { class: "shortcuts" });
    for (const [key, text] of [
      ["/", "Search nodes"],
      ["F", "Fit to screen"],
      ["+ / −", "Zoom"],
      ["↑ / ↓", "Previous / next step"],
      ["T", "Toggle theme"],
      ["Esc", "Clear selection"],
    ] as const) {
      shortcuts.append(h("kbd", {}, key), h("span", {}, text));
    }
    section.appendChild(shortcuts);
    this.replace(section);
  }

  showNode(node: LogicNode): void {
    const { incoming, outgoing, graph } = this.context;
    const section = h("section", { class: "panel__section" });
    section.appendChild(this.header(typeChip(node.type)));
    section.appendChild(h("div", { class: "node-title" }, node.label));
    if (node.file) section.appendChild(this.location(node.file, node.line));

    if (node.description) {
      section.appendChild(h("p", { class: "description" }, node.description));
      const note =
        node.descriptionSource === "llm"
          ? `Description by ${graph.analysis.model ?? "the LLM"}`
          : node.descriptionSource === "doc"
            ? "From the doc comment"
            : "Generated from code facts";
      section.appendChild(h("span", { class: "source-note" }, note));
    }

    const badges = h("div", { class: "badges" });
    if (graph.entryPoints.includes(node.id))
      badges.appendChild(h("span", { class: "badge" }, "Entry point"));
    if (node.metadata?.async === true) badges.appendChild(h("span", { class: "badge" }, "async"));
    if (badges.childElementCount > 0) section.appendChild(badges);

    const callers =
      node.type === "condition"
        ? this.directRelations(incoming.get(node.id), "from")
        : this.logicalCallers(node.id);
    const callees =
      node.type === "condition"
        ? this.directRelations(outgoing.get(node.id), "to")
        : this.logicalCallees(node.id);
    section.appendChild(h("h2", {}, `Called by · ${callers.length}`));
    section.appendChild(
      callers.length > 0
        ? this.relationList(callers)
        : h("p", { class: "empty" }, "Nothing in this flow."),
    );
    section.appendChild(h("h2", {}, `Calls · ${callees.length}`));
    section.appendChild(
      callees.length > 0
        ? this.relationList(callees)
        : h("p", { class: "empty" }, "Nothing in this flow."),
    );

    if (node.snippet) {
      section.appendChild(h("h2", {}, "Source"));
      section.appendChild(renderSnippet(node.snippet, node.line));
    }
    if (node.evidence && node.evidence.length > 0) {
      section.appendChild(h("h2", {}, "Evidence"));
      section.appendChild(this.evidenceList(node.evidence));
    }
    const metadata = this.metadata(node);
    if (metadata) {
      section.appendChild(h("h2", {}, "Details"));
      section.appendChild(metadata);
    }
    this.replace(section);
  }

  showEdge(edge: LogicEdge): void {
    const { nodes } = this.context;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    const section = h("section", { class: "panel__section" });
    const chip = h(
      "span",
      { class: "type-chip", style: "--chip: var(--lt-accent)" },
      `${edge.type} relationship`,
    );
    section.appendChild(this.header(chip));
    section.appendChild(
      h("div", { class: "node-title" }, `${from?.label ?? edge.from} → ${to?.label ?? edge.to}`),
    );

    const badges = h("div", { class: "badges" });
    if (edge.source === "inferred") {
      badges.appendChild(
        h(
          "span",
          { class: "badge badge--inferred" },
          `Inferred · ${Math.round(edge.confidence * 100)}% confidence`,
        ),
      );
    } else {
      badges.appendChild(
        h(
          "span",
          { class: "badge" },
          edge.confidence < 1
            ? `Static · ${Math.round(edge.confidence * 100)}% match`
            : "Proven by source",
        ),
      );
    }
    if (edge.branch)
      badges.appendChild(h("span", { class: "badge badge--branch" }, `branch: ${edge.branch}`));
    if (edge.label && edge.label !== edge.branch)
      badges.appendChild(h("span", { class: "badge" }, edge.label));
    section.appendChild(badges);

    if (edge.reason) {
      section.appendChild(h("h2", {}, "Why it is inferred"));
      section.appendChild(h("p", { class: "description" }, edge.reason));
    }
    section.appendChild(h("h2", {}, "Endpoints"));
    section.appendChild(
      this.nodeList([from, to].filter((node): node is LogicNode => node !== undefined)),
    );
    section.appendChild(h("h2", {}, "Evidence"));
    section.appendChild(
      edge.evidence && edge.evidence.length > 0
        ? this.evidenceList(edge.evidence)
        : h("p", { class: "empty" }, "No call site proves this relationship."),
    );
    this.replace(section);
  }

  private replace(section: HTMLElement): void {
    clear(this.root);
    this.root.appendChild(section);
    this.root.scrollTop = 0;
  }

  private header(chip: HTMLElement): HTMLElement {
    const close = h("button", {
      class: "icon-button",
      type: "button",
      title: "Back to overview (Esc)",
      "aria-label": "Close details",
    });
    close.appendChild(icon(CLOSE_ICON, 14));
    close.querySelector("svg")?.setAttribute("stroke", "currentColor");
    close.querySelector("svg")?.setAttribute("stroke-width", "1.6");
    close.querySelector("svg")?.setAttribute("stroke-linecap", "round");
    close.addEventListener("click", () => this.context.onClose());
    return h("div", { class: "panel__header" }, chip, close);
  }

  private location(file: string, line: number | undefined): HTMLElement {
    const text = `${file}${line ? `:${line}` : ""}`;
    const wrapper = h("div", { class: "location" }, h("span", {}, text));
    const copy = h("button", { class: "text-button", type: "button" }, "Copy");
    copy.addEventListener("click", () => {
      void copyText(text).then((ok) => {
        copy.textContent = ok ? "Copied" : "Copy failed";
        window.setTimeout(() => (copy.textContent = "Copy"), 1200);
      });
    });
    wrapper.appendChild(copy);
    const rootPath = this.context.graph.analysis.rootPath;
    if (rootPath) {
      const absolute = `${rootPath.replace(/\\/g, "/").replace(/\/$/, "")}/${file}`;
      const href = `vscode://file/${encodeURI(absolute.startsWith("/") ? absolute.slice(1) : absolute)}${line ? `:${line}` : ""}`;
      wrapper.appendChild(h("a", { href, title: "Open in VS Code" }, "Open in editor"));
    }
    return wrapper;
  }

  private nodeList(nodes: readonly LogicNode[]): HTMLElement {
    const list = h("ul", { class: "link-list" });
    for (const node of nodes) {
      const button = h(
        "button",
        { type: "button" },
        h("span", { class: "link-list__dot", style: `--swatch: var(--lt-c-${node.type})` }),
        h("span", { class: "link-list__label" }, node.label),
        h("span", { class: "link-list__kind" }, NODE_TYPE_LABELS[node.type]),
      );
      button.addEventListener("click", () => this.context.onSelectNode(node.id));
      list.appendChild(h("li", {}, button));
    }
    return list;
  }

  /** Callees including those reached through this node's own branches. */
  private logicalCallees(id: string, via?: string, seen = new Set<string>()): Relation[] {
    const relations: Relation[] = [];
    for (const edge of this.context.outgoing.get(id) ?? []) {
      const target = this.context.nodes.get(edge.to);
      if (!target) continue;
      if (
        target.type === "condition" &&
        target.metadata?.owner === this.ownerOf(id) &&
        !seen.has(target.id)
      ) {
        seen.add(target.id);
        relations.push(...this.logicalCallees(target.id, `${target.label}`, seen));
        continue;
      }
      const branch = via && edge.branch ? `${via} → ${edge.branch}` : via;
      relations.push({ node: target, edge, ...(branch ? { via: branch } : {}) });
    }
    return relations;
  }

  /** Callers, mapping branch nodes back to the function that owns them. */
  private logicalCallers(id: string): Relation[] {
    const relations: Relation[] = [];
    for (const edge of this.context.incoming.get(id) ?? []) {
      let source = this.context.nodes.get(edge.from);
      if (!source) continue;
      let via: string | undefined;
      if (source.type === "condition") {
        via = edge.branch ? `${source.label} → ${edge.branch}` : source.label;
        const owner = this.context.nodes.get(asText(source.metadata?.owner));
        if (owner) source = owner;
      }
      relations.push({ node: source, edge, ...(via ? { via } : {}) });
    }
    return relations;
  }

  private directRelations(
    edges: readonly LogicEdge[] | undefined,
    side: "from" | "to",
  ): Relation[] {
    return (edges ?? []).flatMap((edge) => {
      const node = this.context.nodes.get(side === "from" ? edge.from : edge.to);
      return node ? [{ node, edge }] : [];
    });
  }

  private ownerOf(id: string): string {
    const node = this.context.nodes.get(id);
    return node?.type === "condition" ? asText(node.metadata?.owner, id) : id;
  }

  private relationList(relations: readonly Relation[]): HTMLElement {
    const list = h("ul", { class: "link-list" });
    for (const { node: other, edge, via } of relations) {
      const kind = [
        edge.type === "condition" ? "branch" : edge.type,
        via ? `if ${via}` : edge.label,
      ]
        .filter(Boolean)
        .join(" · ");
      const button = h(
        "button",
        { type: "button", title: `Go to ${other.label}` },
        h("span", { class: "link-list__dot", style: `--swatch: var(--lt-c-${other.type})` }),
        h("span", { class: "link-list__label" }, other.label),
        edge.source === "inferred"
          ? h("span", { class: "badge badge--inferred" }, "inferred")
          : null,
        h("span", { class: "link-list__kind" }, kind),
      );
      button.addEventListener("click", () => this.context.onSelectNode(other.id));
      list.appendChild(h("li", {}, button));
    }
    return list;
  }

  private evidenceList(evidence: readonly SourceEvidence[]): HTMLElement {
    const list = h("ul", { class: "evidence" });
    for (const item of evidence) {
      list.appendChild(
        h(
          "li",
          {},
          h(
            "div",
            { class: "evidence__head" },
            h("span", { class: "badge" }, item.kind),
            `${item.file}:${item.line}`,
          ),
          item.text ? h("div", { class: "evidence__text" }, item.text) : null,
        ),
      );
    }
    return list;
  }

  private metadata(node: LogicNode): HTMLElement | undefined {
    const metadata = node.metadata ?? {};
    const table = h("dl", { class: "meta-table" });
    for (const [key, label] of METADATA_LABELS) {
      const value = metadata[key];
      if (value === undefined || value === null || value === "" || value === false) continue;
      if (key === "path" && node.type !== "route") continue;
      const display = asText(value) || JSON.stringify(value);
      table.append(h("dt", {}, label), h("dd", {}, display));
    }
    return table.childElementCount > 0 ? table : undefined;
  }
}

interface Relation {
  node: LogicNode;
  edge: LogicEdge;
  /** The branch this relationship sits in, e.g. "!user → no". */
  via?: string;
}

export function typeChip(type: LogicNode["type"]): HTMLElement {
  const chip = h("span", { class: "type-chip", style: `--chip: var(--lt-c-${type})` });
  chip.appendChild(icon(NODE_ICONS[type], 13));
  chip.appendChild(document.createTextNode(NODE_TYPE_LABELS[type]));
  return chip;
}
