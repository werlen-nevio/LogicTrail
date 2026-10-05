import type { LogicTrailGraph } from "../graph/model.js";
import type { GraphLayout } from "../render/layout-types.js";

export interface ViewerData {
  graph: LogicTrailGraph;
  layout: GraphLayout;
  version: string;
}

export function loadViewerData(): ViewerData {
  const element = document.getElementById("logictrail-data");
  if (!element?.textContent) throw new Error("LogicTrail data block is missing.");
  return JSON.parse(element.textContent) as ViewerData;
}
