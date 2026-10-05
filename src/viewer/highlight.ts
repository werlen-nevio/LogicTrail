import type { SourceSnippet } from "../graph/model.js";
import { h } from "./dom.js";

const TOKEN =
  /(\/\/.*$|\/\*.*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(import|from|export|default|const|let|var|function|return|if|else|for|of|in|while|do|switch|case|break|continue|await|async|new|class|extends|implements|throw|try|catch|finally|typeof|instanceof|interface|type|enum|this|super|null|undefined|true|false|void|private|public|protected|readonly|static)\b|(\b\d+(?:\.\d+)?\b)/g;

/** Light, line-based syntax highlighting for JS/TS snippets. */
function highlightLine(line: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index;
    if (index > last) nodes.push(document.createTextNode(line.slice(last, index)));
    const className = match[1] ? "tok-c" : match[2] ? "tok-s" : match[3] ? "tok-k" : "tok-n";
    nodes.push(h("span", { class: className }, match[0]));
    last = index + match[0].length;
  }
  if (last < line.length) nodes.push(document.createTextNode(line.slice(last)));
  return nodes;
}

export function renderSnippet(snippet: SourceSnippet, focusLine?: number): HTMLElement {
  const block = h("pre", { class: "code" });
  snippet.lines.forEach((line, offset) => {
    const number = snippet.startLine + offset;
    const row = h("div", { class: number === focusLine ? "code__line is-focus" : "code__line" });
    row.appendChild(h("span", { class: "code__num" }, number));
    const code = h("span");
    for (const node of highlightLine(line)) code.appendChild(node);
    row.appendChild(code);
    block.appendChild(row);
  });
  if (snippet.truncated) block.appendChild(h("div", { class: "code__more" }, "…"));
  return block;
}
