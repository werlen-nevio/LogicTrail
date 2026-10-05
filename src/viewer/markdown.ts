import { h, type Child } from "./dom.js";

/**
 * Renders the small Markdown subset used in explanations (paragraphs,
 * ordered/unordered lists, `code`, **bold**) into DOM nodes. Text is never
 * interpreted as HTML.
 */
export function renderMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) fragment.appendChild(h("p", {}, ...inline(paragraph.join(" "))));
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    const element = h(list.ordered ? "ol" : "ul");
    for (const item of list.items) element.appendChild(h("li", {}, ...inline(item)));
    fragment.appendChild(element);
    list = undefined;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    const unordered = /^[-*•]\s+(.*)$/.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push((ordered?.[1] ?? unordered?.[1] ?? "").trim());
      continue;
    }
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (list && /^\s{2,}/.test(raw) && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    flushList();
    paragraph.push(line.replace(/^#+\s*/, ""));
  }
  flushParagraph();
  flushList();
  return fragment;
}

function inline(text: string): Child[] {
  const parts: Child[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > last) parts.push(text.slice(last, index));
    const token = match[0];
    parts.push(
      token.startsWith("`")
        ? h("code", {}, token.slice(1, -1))
        : h("strong", {}, token.slice(2, -2)),
    );
    last = index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
