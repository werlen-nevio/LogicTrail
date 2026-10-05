/** Layout data shared by the SVG renderer and the browser viewer (type-only). */

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  /** Center coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  points: Point[];
  /** SVG path data for the edge curve. */
  path: string;
  label?: { x: number; y: number; width: number; height: number; text: string };
}

export interface GraphLayout {
  width: number;
  height: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}
