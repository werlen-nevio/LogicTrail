import type { LogicEdge, LogicNode, LogicTrailGraph } from "../graph/model.js";

/** A step that is in both versions of a flow but now sits somewhere else. */
export interface MovedNode {
  node: LogicNode;
  /** Where it was, as "file:line". */
  from: string;
}

/** An edge that is only in one version of a flow, with the steps it connects. */
export interface ChangedEdge {
  edge: LogicEdge;
  from: LogicNode;
  to: LogicNode;
  /**
   * Both ends are in both versions: a connection gained or lost between existing steps, rather
   * than a side effect of a step that was added or removed.
   */
  betweenKeptSteps: boolean;
}

/** What changed between two versions of the same flow. */
export interface FlowChanges {
  added: LogicNode[];
  removed: LogicNode[];
  moved: MovedNode[];
  addedEdges: ChangedEdge[];
  removedEdges: ChangedEdge[];
}

/**
 * Compares two versions of a flow. Steps are matched by type, label and file rather than by id,
 * because ids contain line numbers: a step whose line shifted counts as moved, not as removed and
 * added. A step that changed files is matched by type and label when that is unambiguous.
 */
export function diffFlows(before: LogicTrailGraph, after: LogicTrailGraph): FlowChanges {
  const pairs = new Map<string, LogicNode>();
  let left = byLine(before.nodes);
  let right = byLine(after.nodes);

  // Same type, label and file: pair duplicates in source order.
  const pool = group(right, sameFile);
  left = left.filter((node) => {
    const match = pool.get(sameFile(node))?.shift();
    if (match) pairs.set(node.id, match);
    return !match;
  });
  right = [...pool.values()].flat();

  // Same type and label in another file, only when there is exactly one on each side.
  const leftGroups = group(left, anyFile);
  const rightGroups = group(right, anyFile);
  for (const [key, nodes] of leftGroups) {
    const candidates = rightGroups.get(key);
    const [node] = nodes;
    const [match] = candidates ?? [];
    if (nodes.length === 1 && candidates?.length === 1 && node && match) pairs.set(node.id, match);
  }

  const paired = new Set([...pairs.values()].map((node) => node.id));
  const moved: MovedNode[] = [];
  for (const node of before.nodes) {
    const match = pairs.get(node.id);
    if (match && location(match) !== location(node))
      moved.push({ node: match, from: location(node) });
  }

  // Edges: compare by the matched identity of their ends, keeping duplicates apart.
  const canonical = (id: string): string => pairs.get(id)?.id ?? `before:${id}`;
  const unmatched = new Map<string, LogicEdge[]>();
  for (const edge of before.edges) {
    const key = edgeKey(canonical(edge.from), canonical(edge.to), edge);
    const list = unmatched.get(key);
    if (list) list.push(edge);
    else unmatched.set(key, [edge]);
  }
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const addedEdges: ChangedEdge[] = [];
  for (const edge of after.edges) {
    if (unmatched.get(edgeKey(edge.from, edge.to, edge))?.shift()) continue;
    const from = afterNodes.get(edge.from);
    const to = afterNodes.get(edge.to);
    if (from && to) {
      addedEdges.push({
        edge,
        from,
        to,
        betweenKeptSteps: paired.has(from.id) && paired.has(to.id),
      });
    }
  }
  const removedEdges: ChangedEdge[] = [];
  for (const edge of [...unmatched.values()].flat()) {
    // Show kept steps as they are now, so locations match the rest of the report.
    const from = pairs.get(edge.from) ?? beforeNodes.get(edge.from);
    const to = pairs.get(edge.to) ?? beforeNodes.get(edge.to);
    if (from && to) {
      removedEdges.push({
        edge,
        from,
        to,
        betweenKeptSteps: pairs.has(edge.from) && pairs.has(edge.to),
      });
    }
  }

  return {
    added: after.nodes.filter((node) => !paired.has(node.id)),
    removed: before.nodes.filter((node) => !pairs.has(node.id)),
    moved,
    addedEdges,
    removedEdges,
  };
}

export function hasChanges(changes: FlowChanges): boolean {
  return (
    changes.added.length > 0 ||
    changes.removed.length > 0 ||
    changes.moved.length > 0 ||
    changes.addedEdges.length > 0 ||
    changes.removedEdges.length > 0
  );
}

/** "file:line", or "" for steps without a source location. */
export function location(node: LogicNode): string {
  return node.file ? `${node.file}${node.line ? `:${node.line}` : ""}` : "";
}

function sameFile(node: LogicNode): string {
  return `${node.type}\u0000${node.label}\u0000${node.file ?? ""}`;
}

function anyFile(node: LogicNode): string {
  return `${node.type}\u0000${node.label}`;
}

function edgeKey(from: string, to: string, edge: LogicEdge): string {
  return [from, to, edge.type, edge.branch ?? "", edge.label ?? ""].join("\u0000");
}

function byLine(nodes: readonly LogicNode[]): LogicNode[] {
  return [...nodes].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

function group(nodes: readonly LogicNode[], key: (node: LogicNode) => string) {
  const groups = new Map<string, LogicNode[]>();
  for (const node of nodes) {
    const id = key(node);
    const list = groups.get(id);
    if (list) list.push(node);
    else groups.set(id, [node]);
  }
  return groups;
}
