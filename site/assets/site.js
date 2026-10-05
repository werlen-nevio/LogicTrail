// Page wiring: the hero question (pick one or type your own and watch it storm into its trail),
// the copy buttons, the live viewer tabs, and the plugin page's one-time storm.
(function () {
  "use strict";

  const Storm = window.LogicTrailStorm;
  const flowsScript = document.getElementById("flows");
  const flows = flowsScript ? JSON.parse(flowsScript.textContent || "[]") : [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const status = document.getElementById("status");
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const VISIBLE_STEPS = 8;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const announce = (message) => {
    if (status) status.textContent = message;
  };
  const fontsReady = () =>
    Promise.race([
      document.fonts?.load('900 100px "Mona Sans"').then(() => document.fonts.ready),
      new Promise((resolve) => window.setTimeout(resolve, 1500)),
    ]).catch(() => undefined);

  // Copy buttons: data-copy names the element whose text is copied.
  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.querySelector("span");
    const icon = button.querySelector("use");
    let timer;
    button.addEventListener("click", async () => {
      const text = document.getElementById(button.dataset.copy)?.textContent?.trim() ?? "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const range = document.createRange();
        const source = document.getElementById(button.dataset.copy);
        if (!source) return;
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("copy");
      }
      button.dataset.copied = "";
      if (label) label.textContent = "Copied";
      icon?.setAttribute("href", "#i-check");
      announce(`Copied ${text}`);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete button.dataset.copied;
        if (label) label.textContent = "Copy";
        icon?.setAttribute("href", "#i-copy");
      }, 1800);
    });
  }

  // Commands that repeat the hero's question.
  const shellQuote = (text) => `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
  const updateCommands = (question) => {
    for (const node of document.querySelectorAll('[data-asks="explain"]')) {
      node.textContent = `/logictrail:explain ${question}`;
    }
    for (const node of document.querySelectorAll('[data-asks="npx"]')) {
      node.textContent = `npx logictrail ${shellQuote(question)}`;
    }
  };

  // The live viewer: three sample flows in tabs, loaded when the section comes near.
  const demo = (() => {
    const frame = document.getElementById("viewer-frame");
    const panel = document.getElementById("viewer");
    const open = document.getElementById("viewer-open");
    const tabs = [...document.querySelectorAll('[role="tab"][data-flow]')];
    if (!frame || !panel || tabs.length === 0) return { select() {} };
    let current = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.dataset.flow;
    let loaded = false;

    const select = (id, load) => {
      const flow = flows.find((candidate) => candidate.id === id);
      if (!flow) return;
      current = id;
      for (const tab of tabs) {
        const selected = tab.dataset.flow === id;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      panel.setAttribute("aria-labelledby", `tab-${id}`);
      frame.title = `LogicTrail viewer: ${flow.question}`;
      if (open) open.href = flow.viewer;
      if (load || loaded) {
        const source = `${flow.viewer}#theme=light`;
        if (frame.getAttribute("src") !== source) frame.setAttribute("src", source);
        loaded = true;
      }
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab.dataset.flow, true));
      tab.addEventListener("keydown", (event) => {
        const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        const next = tabs[(keys[event.key] + tabs.length) % tabs.length];
        next.focus();
        select(next.dataset.flow, true);
      });
    });

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            select(current, true);
            observer.disconnect();
          }
        },
        { rootMargin: "600px 0px" },
      );
      observer.observe(panel);
    } else {
      select(current, true);
    }
    return { select };
  })();

  // The hero: the question is an input; Enter, a sample question or leaving the field storms it.
  const ask = document.getElementById("ask");
  if (ask && Storm && flows.length > 0) {
    const box = ask.querySelector(".question");
    const storm = box.querySelector(".storm");
    const input = box.querySelector("textarea");
    const tries = [...document.querySelectorAll("[data-question]")];
    const trail = document.getElementById("trail");
    const more = document.getElementById("trail-more");
    const stats = document.getElementById("trail-stats");
    const note = document.getElementById("trail-note");
    const terms = document.getElementById("terms");
    const none = document.getElementById("no-trail");
    const foot = document.getElementById("trail-foot");
    let asked = input.value.trim();
    let run = 0;

    const narrow = () => window.innerWidth <= 960;
    const refit = () =>
      Storm.fit(
        box,
        storm,
        narrow()
          ? Math.max(170, window.innerHeight * 0.34)
          : Math.min(window.innerHeight * 0.38, 440),
        Math.min(narrow() ? window.innerWidth * 0.17 : window.innerWidth * 0.1, 168),
      );

    const where = (step) => {
      if (!step.file) return "no source";
      const full = `${step.file}${step.line ? `:${step.line}` : ""}`;
      if (full.length <= 40) return full;
      return `…/${step.file.split("/").slice(-2).join("/")}${step.line ? `:${step.line}` : ""}`;
    };

    const renderTerms = (analysis, found) => {
      const inFlow = new Set(found ? found.flow.steps.flatMap((step) => step.terms) : []);
      const related = analysis.related.filter((term) => inFlow.has(term));
      const dropped = analysis.words.filter((word) => word.kind === "drop");
      terms.replaceChildren(element("span", "label", "Searched for"));
      if (analysis.kept.length === 0)
        terms.append(element("span", "s", "nothing: no search terms"));
      for (const term of analysis.kept) terms.append(element("span", "t", term));
      for (const term of related) terms.append(element("span", "s", term));
      for (const word of dropped) {
        terms.append(element("span", "x", word.text.replace(/[^\p{L}\p{N}'-]/gu, "")));
      }
    };

    const renderTrail = (analysis, found, animate) => {
      if (!found) {
        trail.replaceChildren();
        more.textContent = "";
        note.hidden = true;
        none.hidden = false;
        foot.hidden = true;
        return;
      }
      const { flow } = found;
      none.hidden = true;
      foot.hidden = false;
      note.hidden = found.exact;
      note.textContent = found.exact ? "" : `Closest trail in the sample app: “${flow.question}”`;
      const items = flow.steps.slice(0, VISIBLE_STEPS).map((step) => {
        const item = element("li", "step");
        if (step.terms.some((term) => analysis.weights.has(term))) item.classList.add("hit");
        const label = element("span", "step-label");
        const name = element("span");
        for (const [text, matched] of Storm.highlight(step.label, analysis)) {
          name.append(matched ? element("mark", "", text) : text);
        }
        name.title = step.label;
        label.append(name, element("span", "step-type", step.type));
        const location = element("span", "step-where", where(step));
        if (step.file) location.title = `${step.file}${step.line ? `:${step.line}` : ""}`;
        item.append(label, location);
        return item;
      });
      trail.replaceChildren(...items);
      const hidden = flow.steps.length - items.length;
      more.textContent = hidden > 0 ? `+ ${hidden} more steps on this trail` : "";
      stats.textContent = `${flow.steps.length} steps · ${flow.edges} edges · ${flow.inferred} inferred · ${flow.files} files indexed`;
      if (animate && !reducedMotion.matches && trail.animate) {
        try {
          trail.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
            duration: 900,
            easing: EASE_OUT,
            pseudoElement: "::before",
          });
        } catch {
          // Pseudo-element animation is optional.
        }
        items.forEach((item, index) =>
          item.animate(
            [
              { opacity: 0, transform: "translateY(-0.4rem)", clipPath: "inset(0 0 100% 0)" },
              { opacity: 1, transform: "none", clipPath: "inset(0 0 0 0)" },
            ],
            { duration: 560, delay: index * 70, easing: EASE_OUT, fill: "backwards" },
          ),
        );
      }
    };

    const storming = (question, animate) => {
      const text = question.replace(/\s+/g, " ").trim();
      if (!text) {
        input.value = asked;
        storming(asked, false);
        return;
      }
      asked = text;
      input.value = text;
      const id = ++run;
      const analysis = Storm.analyse(text);
      const found = Storm.match(analysis, flows);
      Storm.renderPlain(storm, text);
      refit();
      updateCommands(text);
      for (const button of tries) {
        button.setAttribute("aria-pressed", String(button.dataset.question === text.toLowerCase()));
      }
      renderTerms(analysis, found);
      if (found) demo.select(found.flow.id);
      announce(
        `${analysis.kept.length > 0 ? `Search terms: ${analysis.kept.join(", ")}.` : "No search terms in that question."} ${
          found
            ? `${found.exact ? "" : `Closest sample flow: ${found.flow.question}. `}${found.flow.steps.length} steps.`
            : "No trail in the sample app."
        }`,
      );
      if (animate) {
        trail.replaceChildren();
        Storm.play(storm, analysis);
        window.setTimeout(() => {
          if (id === run) renderTrail(analysis, found, true);
        }, 650);
      } else {
        Storm.render(storm, analysis, true);
        renderTrail(analysis, found, false);
      }
    };

    input.addEventListener("input", () => {
      if (/\n/.test(input.value)) input.value = input.value.replace(/\n+/g, " ");
      Storm.renderPlain(storm, input.value);
      refit();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        storming(input.value, true);
      } else if (event.key === "Escape") {
        storming(asked, false);
      }
    });
    input.addEventListener("blur", () => {
      const text = input.value.replace(/\s+/g, " ").trim();
      if (text !== asked) storming(text, true);
    });
    ask.addEventListener("submit", (event) => {
      event.preventDefault();
      storming(input.value, true);
    });
    for (const button of tries) {
      button.addEventListener("click", () => storming(button.dataset.question, true));
    }

    let resizeTimer;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(refit, 120);
    });

    document.fonts?.addEventListener("loadingdone", refit);

    refit();
    fontsReady().then(() => storming(asked, true));
  }

  // The plugin page: the command storms once, then Claude's answer is carved step by step.
  const once = document.querySelector("[data-storm-once]");
  if (once && Storm) {
    const storm = once.querySelector(".storm");
    const answer = [...document.querySelectorAll("[data-carve] > li")];
    const text = storm.textContent.trim();
    const refit = () =>
      Storm.fit(
        once,
        once,
        window.innerWidth <= 960
          ? Math.max(150, window.innerHeight * 0.3)
          : Math.min(window.innerHeight * 0.42, 420),
        Math.min(
          window.innerWidth <= 960 ? window.innerWidth * 0.16 : window.innerWidth * 0.1,
          160,
        ),
      );
    const analysis = Storm.analyse(text);
    refit();
    window.addEventListener("resize", refit);
    document.fonts?.addEventListener("loadingdone", refit);
    fontsReady().then(() => {
      refit();
      Storm.play(storm, analysis);
      if (reducedMotion.matches || !document.body.animate) return;
      answer.forEach((item, index) =>
        item.animate(
          [
            { opacity: 0, transform: "translateY(-0.4rem)", clipPath: "inset(0 0 100% 0)" },
            { opacity: 1, transform: "none", clipPath: "inset(0 0 0 0)" },
          ],
          { duration: 560, delay: 700 + index * 110, easing: EASE_OUT, fill: "backwards" },
        ),
      );
    });
  }
})();
