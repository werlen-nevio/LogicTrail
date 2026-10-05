// The storm: a question set as monumental type. The words LogicTrail would search for condense and
// light up; the rest are blown aside and settle grey. The split comes from LogicTrail's own
// query-term code (terms.js, bundled from src/query/terms.ts at build time).
(function () {
  "use strict";

  const Terms = window.LogicTrailTerms;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const INK = "#16171b";
  const RAIN = "#8e949b";

  /** Splits a question into its words and marks the ones LogicTrail keeps as search terms. */
  function analyse(question) {
    const pieces = question.split(/(\s+)/).filter((piece) => piece !== "");
    const words = pieces
      .filter((piece) => !/^\s+$/.test(piece))
      .map((text) => {
        const parts = Terms.splitWords(text);
        return { text, parts, stems: Terms.normalizeWords(parts), kind: "drop" };
      });
    // Phrasal verbs span two words: "log in" becomes the single term "login".
    for (let index = 0; index + 1 < words.length; index++) {
      const word = words[index];
      const next = words[index + 1];
      const last = word.parts[word.parts.length - 1];
      const first = next.parts[0];
      if (!last || !first) continue;
      const joined = Terms.normalizeWords([last, first]);
      if (joined.length !== 1) continue;
      word.stems = [...word.stems.slice(0, -1), joined[0]];
      next.stems = [joined[0], ...next.stems.slice(1)];
      index++;
    }
    const terms = Terms.queryTerms(question);
    const weights = new Map(terms.map((term) => [term.term, term]));
    for (const word of words) {
      if (word.stems.some((stem) => weights.get(stem)?.source === "query")) word.kind = "term";
    }
    return {
      question,
      pieces,
      words,
      weights,
      kept: terms.filter((term) => term.source === "query").map((term) => term.term),
      related: terms.filter((term) => term.source === "synonym").map((term) => term.term),
    };
  }

  /** The sample flow a question leads to: the one asked word for word, else the best term match. */
  function match(analysis, flows) {
    const asked = analysis.question.trim().toLowerCase();
    const exact = flows.find((flow) => flow.question === asked);
    if (exact) return { flow: exact, exact: true };
    let best;
    let bestScore = 0;
    for (const flow of flows) {
      let score = 0;
      for (const step of flow.steps) {
        for (const term of step.terms) score += analysis.weights.get(term)?.weight ?? 0;
      }
      if (score > bestScore) {
        best = flow;
        bestScore = score;
      }
    }
    return best ? { flow: best, exact: false } : undefined;
  }

  /** The parts of a label that match a search term, as [text, isMatch] runs. */
  function highlight(label, analysis) {
    const runs = [];
    let rest = label;
    for (const part of Terms.splitWords(label)) {
      const at = rest.toLowerCase().indexOf(part);
      if (at < 0) continue;
      if (!analysis.weights.has(Terms.stem(part))) continue;
      if (at > 0) runs.push([rest.slice(0, at), false]);
      runs.push([rest.slice(at, at + part.length), true]);
      rest = rest.slice(at + part.length);
    }
    if (rest) runs.push([rest, false]);
    return runs;
  }

  /** Sets the question as words, plain or already settled into terms and rain. */
  function render(storm, analysis, settled) {
    storm.replaceChildren();
    let index = 0;
    for (const piece of analysis.pieces) {
      if (/^\s+$/.test(piece)) {
        // Collapsing would let the type drift from the textarea above it, so keep every space.
        storm.append(` ${" ".repeat(piece.length - 1)}`);
        continue;
      }
      const word = analysis.words[index++];
      const span = document.createElement("span");
      span.className = settled === undefined ? "w" : `w ${word.kind}${settled ? " settled" : ""}`;
      span.textContent = piece;
      storm.append(span);
    }
  }

  /** Sets text as plain words, while the visitor is typing. */
  function renderPlain(storm, text) {
    storm.run = (storm.run ?? 0) + 1;
    render(storm, { pieces: text.split(/(\s+)/).filter(Boolean), words: [] }, undefined);
  }

  /** Shrinks the type until the question fits its box: never wider than the field, never taller than maxHeight. */
  function fit(box, storm, maxHeight, maxSize) {
    const width = box.clientWidth;
    let size = maxSize;
    box.style.fontSize = `${size}px`;
    for (let guard = 0; guard < 40; guard++) {
      const tooTall = storm.offsetHeight > maxHeight;
      const tooWide = storm.scrollWidth > width + 1;
      if ((!tooTall && !tooWide) || size <= 34) break;
      size = Math.max(34, size * 0.93);
      box.style.fontSize = `${size}px`;
    }
    return size;
  }

  function seeded(text) {
    let state = 2166136261;
    for (let index = 0; index < text.length; index++) {
      state ^= text.charCodeAt(index);
      state = Math.imul(state, 16777619);
    }
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Plays the storm once: the words LogicTrail sets aside lift, scatter on the wind and settle
   * grey; the search terms condense and take the yellow tile. Resolves when it has settled.
   */
  function play(storm, analysis) {
    const run = (storm.run = (storm.run ?? 0) + 1);
    const current = () => storm.run === run;
    render(storm, analysis, false);
    const spans = [...storm.querySelectorAll(".w")];
    if (reducedMotion.matches || !storm.animate) {
      for (const span of spans) span.classList.add("settled");
      return Promise.resolve(true);
    }
    const random = seeded(analysis.question);
    const animations = [];

    spans.forEach((span, wordIndex) => {
      const word = analysis.words[wordIndex];
      const letters = [...span.textContent].map((char) => {
        const letter = document.createElement("span");
        letter.className = "ch";
        letter.textContent = char;
        return letter;
      });
      span.replaceChildren(...letters);
      letters.forEach((letter, letterIndex) => {
        if (word.kind === "drop") {
          const delay = 140 + wordIndex * 70 + letterIndex * 22;
          const duration = 1500 + random() * 400;
          animations.push(
            letter.animate(
              [
                { transform: "translate(0, 0) rotate(0deg)", opacity: 1, color: INK },
                {
                  transform: `translate(${(0.18 + random() * 0.5).toFixed(3)}em, ${(-0.1 - random() * 0.22).toFixed(3)}em) rotate(${((random() * 2 - 1) * 28).toFixed(1)}deg)`,
                  opacity: 0.06,
                  color: RAIN,
                  offset: 0.38,
                },
                {
                  transform: "translate(0, 0.14em) rotate(0deg)",
                  opacity: 0.5,
                  color: RAIN,
                  offset: 0.78,
                },
                { transform: "translate(0, 0) rotate(0deg)", opacity: 1, color: RAIN },
              ],
              { duration, delay, easing: EASE_OUT, fill: "both" },
            ),
          );
        } else {
          const delay = 260 + letterIndex * 30;
          const spread = (letterIndex - (letters.length - 1) / 2) * 0.1;
          animations.push(
            letter.animate(
              [
                { transform: `translateX(${spread.toFixed(3)}em)`, opacity: 0.25 },
                { transform: "translateX(0)", opacity: 1 },
              ],
              { duration: 1100, delay, easing: EASE_OUT, fill: "both" },
            ),
          );
        }
      });
    });

    const termsLit = new Promise((resolve) => {
      window.setTimeout(() => {
        spans.forEach((span, index) => {
          if (analysis.words[index].kind === "term") span.classList.add("settled");
        });
        resolve();
      }, 700);
    });
    return Promise.all([...animations.map((animation) => animation.finished), termsLit])
      .catch(() => undefined)
      .then(() => {
        for (const animation of animations) animation.cancel();
        if (!current()) return false;
        render(storm, analysis, true);
        return true;
      });
  }

  window.LogicTrailStorm = { analyse, match, highlight, render, renderPlain, fit, play };
})();
