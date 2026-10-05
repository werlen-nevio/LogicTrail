import type { LogicEdge, LogicNode } from "../graph/model.js";
import { loadViewerData } from "./data.js";
import { storageGet, storageSet, svgElement } from "./dom.js";
import { Panel } from "./panel.js";
import { PanZoom } from "./panzoom.js";
import { NodeSearch } from "./search.js";

const THEME_KEY = "logictrail-theme";

type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

function main(): void {
  const data = loadViewerData();
  const { graph, layout } = data;
  const app = document.querySelector<HTMLElement>(".app");
  const canvas = document.getElementById("canvas");
  const svg = document.getElementById("graph");
  const viewport = document.getElementById("viewport") as SVGGElement | null;
  const panelRoot = document.getElementById("panel");
  const searchInput = document.getElementById("search") as HTMLInputElement | null;
  const searchResults = document.getElementById("search-results");
  const zoomIndicator = document.getElementById("zoom-indicator");
  if (!app || !canvas || !svg || !viewport || !panelRoot || !searchInput || !searchResults) return;

  const nodes = new Map<string, LogicNode>(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map<string, LogicEdge>(graph.edges.map((edge) => [edge.id, edge]));
  const incoming = new Map<string, LogicEdge[]>();
  const outgoing = new Map<string, LogicEdge[]>();
  for (const edge of graph.edges) {
    (outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from))?.push(edge);
    (incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to))?.push(edge);
  }
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  const nodeElements = new Map<string, SVGGElement>();
  for (const element of svg.querySelectorAll<SVGGElement>(".lt-node")) {
    const id = element.dataset.id;
    if (id) nodeElements.set(id, element);
  }
  const edgeElements = new Map<string, SVGGElement>();
  for (const element of svg.querySelectorAll<SVGGElement>(".lt-edge")) {
    const id = element.dataset.id;
    if (!id) continue;
    edgeElements.set(id, element);
    // A wide transparent stroke makes thin edges easy to click.
    const path = element.querySelector(".lt-edge__path");
    if (path) {
      const hit = svgElement("path");
      hit.setAttribute("class", "lt-edge__hit");
      hit.setAttribute("d", path.getAttribute("d") ?? "");
      element.insertBefore(hit, path);
    }
  }

  const panZoom = new PanZoom(canvas, viewport, layout, (transform) => {
    if (zoomIndicator) zoomIndicator.textContent = `${Math.round(transform.k * 100)}%`;
  });

  let selection: Selection = null;
  let interacted = false;

  const panel = new Panel(panelRoot, {
    graph,
    nodes,
    edges,
    incoming,
    outgoing,
    onSelectNode: (id) => selectNode(id, true),
    onClose: () => clearSelection(),
  });

  const trailOf = (id: string): { nodes: Set<string>; edges: Set<string> } => {
    const trailNodes = new Set<string>([id]);
    const trailEdges = new Set<string>();
    const walk = (
      start: string,
      map: ReadonlyMap<string, LogicEdge[]>,
      next: (edge: LogicEdge) => string,
    ): void => {
      const queue = [start];
      const seen = new Set([start]);
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        for (const edge of map.get(current) ?? []) {
          trailEdges.add(edge.id);
          const other = next(edge);
          trailNodes.add(other);
          if (!seen.has(other)) {
            seen.add(other);
            queue.push(other);
          }
        }
      }
    };
    walk(id, outgoing, (edge) => edge.to);
    walk(id, incoming, (edge) => edge.from);
    return { nodes: trailNodes, edges: trailEdges };
  };

  const resetClasses = (): void => {
    svg.classList.remove("has-selection");
    for (const element of [...nodeElements.values(), ...edgeElements.values()]) {
      element.classList.remove("is-trail", "is-selected");
    }
  };

  function selectNode(id: string, center: boolean): void {
    const node = nodes.get(id);
    if (!node) return;
    selection = { kind: "node", id };
    resetClasses();
    const trail = trailOf(id);
    svg?.classList.add("has-selection");
    for (const nodeId of trail.nodes) nodeElements.get(nodeId)?.classList.add("is-trail");
    for (const edgeId of trail.edges) edgeElements.get(edgeId)?.classList.add("is-trail");
    nodeElements.get(id)?.classList.add("is-selected");
    panel.showNode(node);
    app?.classList.remove("panel-hidden");
    updateHash({ node: id });
    const position = positions.get(id);
    if (center && position && !panZoom.isVisible(position.x, position.y)) {
      panZoom.centerOn(position.x, position.y);
    }
  }

  function selectEdge(id: string, center = false): void {
    const edge = edges.get(id);
    if (!edge) return;
    selection = { kind: "edge", id };
    resetClasses();
    svg?.classList.add("has-selection");
    edgeElements.get(id)?.classList.add("is-trail", "is-selected");
    nodeElements.get(edge.from)?.classList.add("is-trail");
    nodeElements.get(edge.to)?.classList.add("is-trail");
    panel.showEdge(edge);
    app?.classList.remove("panel-hidden");
    updateHash({ edge: id });
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (center && from && to) {
      const x = (from.x + to.x) / 2;
      const y = (from.y + to.y) / 2;
      if (!panZoom.isVisible(from.x, from.y) || !panZoom.isVisible(to.x, to.y))
        panZoom.centerOn(x, y, 0.6);
    }
  }

  function clearSelection(): void {
    selection = null;
    resetClasses();
    panel.showOverview();
    updateHash({});
  }

  svg.addEventListener("click", (event) => {
    interacted = true;
    const target = event.target as Element;
    const nodeElement = target.closest<SVGGElement>(".lt-node");
    if (nodeElement?.dataset.id) {
      selectNode(nodeElement.dataset.id, false);
      return;
    }
    const edgeElement = target.closest<SVGGElement>(".lt-edge");
    if (edgeElement?.dataset.id) {
      selectEdge(edgeElement.dataset.id);
      return;
    }
    if (selection) clearSelection();
  });

  svg.addEventListener("keydown", (event) => {
    const nodeElement = (event.target as Element).closest<SVGGElement>(".lt-node");
    if (nodeElement?.dataset.id && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectNode(nodeElement.dataset.id, true);
    }
  });

  for (const [id, element] of nodeElements) {
    element.addEventListener("mouseenter", () => {
      for (const edge of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
        edgeElements.get(edge.id)?.classList.add("is-hover");
      }
    });
    element.addEventListener("mouseleave", () => {
      for (const edge of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
        edgeElements.get(edge.id)?.classList.remove("is-hover");
      }
    });
  }

  const search = new NodeSearch(
    searchInput,
    searchResults,
    graph.nodes,
    (ids) => {
      svg.classList.toggle("has-search", ids !== null);
      for (const [id, element] of nodeElements)
        element.classList.toggle("is-match", ids?.has(id) ?? false);
    },
    (id) => {
      search.reset();
      selectNode(id, true);
      const position = positions.get(id);
      if (position) panZoom.centerOn(position.x, position.y);
    },
  );

  // Theme: #theme=light|dark wins over the stored preference, which wins over the OS setting.
  const root = document.documentElement;
  const storedTheme = hashParams.get("theme") ?? storageGet(THEME_KEY);
  if (storedTheme === "light" || storedTheme === "dark") root.dataset.theme = storedTheme;
  const isDark = (): boolean =>
    root.dataset.theme === "dark" ||
    (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const toggleTheme = (): void => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    storageSet(THEME_KEY, next);
  };

  const bind = (id: string, handler: () => void): void => {
    document.getElementById(id)?.addEventListener("click", () => {
      interacted = true;
      handler();
    });
  };
  bind("zoom-in", () => panZoom.zoomBy(1.25));
  bind("zoom-out", () => panZoom.zoomBy(0.8));
  bind("fit", () => panZoom.fit(true));
  bind("theme", toggleTheme);
  bind("panel-toggle", () => {
    const hidden = app.classList.toggle("panel-hidden");
    document
      .getElementById("panel-toggle")
      ?.setAttribute("aria-pressed", hidden ? "false" : "true");
    requestAnimationFrame(() => panZoom.fit(true));
  });

  const step = (direction: "up" | "down"): void => {
    if (selection?.kind !== "node") {
      const first = graph.entryPoints[0] ?? graph.nodes[0]?.id;
      if (first) selectNode(first, true);
      return;
    }
    const candidates =
      direction === "down" ? outgoing.get(selection.id) : incoming.get(selection.id);
    const edge = candidates?.[0];
    if (edge) selectNode(direction === "down" ? edge.to : edge.from, true);
  };

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "/":
        event.preventDefault();
        search.focus();
        break;
      case "f":
      case "F":
        panZoom.fit(true);
        break;
      case "+":
      case "=":
        panZoom.zoomBy(1.25);
        break;
      case "-":
      case "_":
        panZoom.zoomBy(0.8);
        break;
      case "t":
      case "T":
        toggleTheme();
        break;
      case "Escape":
        clearSelection();
        break;
      case "ArrowDown":
        event.preventDefault();
        step("down");
        break;
      case "ArrowUp":
        event.preventDefault();
        step("up");
        break;
    }
  });

  const entry = positions.get(graph.entryPoints[0] ?? "");
  const initialView = (): void => panZoom.initial(entry ? { x: entry.x, y: entry.y } : undefined);
  canvas.addEventListener("pointerdown", () => (interacted = true));
  canvas.addEventListener("wheel", () => (interacted = true), { passive: true });
  new ResizeObserver(() => {
    if (!interacted) initialView();
  }).observe(canvas);

  panel.showOverview();
  initialView();

  // Deep links: #node=<id> or #edge=<id> (shareable, since the file is self-contained).
  const linkedNode = hashParams.get("node");
  const linkedEdge = hashParams.get("edge");
  if (linkedNode && nodes.has(linkedNode)) selectNode(linkedNode, true);
  else if (linkedEdge && edges.has(linkedEdge)) selectEdge(linkedEdge, true);
}

const hashParams = new URLSearchParams(window.location.hash.slice(1));

function updateHash(selection: { node?: string; edge?: string }): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  params.delete("node");
  params.delete("edge");
  if (selection.node) params.set("node", selection.node);
  if (selection.edge) params.set("edge", selection.edge);
  const hash = params.toString();
  try {
    window.history.replaceState(
      null,
      "",
      hash ? `#${hash}` : window.location.pathname + window.location.search,
    );
  } catch {
    // Some file:// contexts disallow history updates; deep links are optional.
  }
}

main();
