/**
 * Tokenization shared by queries and code: identifiers are split on case and
 * punctuation, phrasal verbs are joined ("logs in" -> "login"), and words are
 * reduced with a light, consistent stemmer so "payments", "payment" and
 * "paid"-style variations meet in the middle.
 */

const STOPWORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "an",
  "and",
  "any",
  "app",
  "application",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "between",
  "by",
  "can",
  "code",
  "codebase",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "during",
  "each",
  "end",
  "every",
  "explain",
  "feature",
  "flow",
  "for",
  "from",
  "get",
  "gets",
  "handle",
  "handled",
  "handles",
  "handling",
  "happen",
  "happened",
  "happening",
  "happens",
  "here",
  "how",
  "i",
  "if",
  "implement",
  "implementation",
  "implemented",
  "in",
  "into",
  "is",
  "it",
  "its",
  "logic",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "out",
  "over",
  "part",
  "please",
  "process",
  "show",
  "should",
  "so",
  "step",
  "steps",
  "system",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "up",
  "use",
  "used",
  "uses",
  "using",
  "via",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whole",
  "why",
  "will",
  "with",
  "work",
  "worked",
  "working",
  "works",
  "would",
  "you",
  "your",
]);

const PHRASAL: Record<string, Record<string, string>> = {
  log: { in: "login", out: "logout", on: "login", off: "logout" },
  sign: { in: "login", up: "signup", out: "logout", on: "login", off: "logout" },
  check: { out: "checkout" },
  set: { up: "setup" },
};

const VERB_FORMS: Record<string, string> = {
  log: "log",
  logs: "log",
  logged: "log",
  logging: "log",
  sign: "sign",
  signs: "sign",
  signed: "sign",
  signing: "sign",
  check: "check",
  checks: "check",
  checked: "check",
  checking: "check",
  set: "set",
  sets: "set",
  setting: "set",
};

/** Canonical forms for words the stemmer would not unify. */
const CANONICAL: Record<string, string> = {
  signin: "login",
  logon: "login",
  signout: "logout",
  logoff: "logout",
  failure: "fail",
  failed: "fail",
  paid: "pay",
  people: "person",
  children: "child",
  authentication: "authenticat",
  authorization: "authoriz",
};

const SYNONYM_GROUPS: readonly string[][] = [
  ["login", "authenticate", "auth", "credential", "session"],
  ["logout", "session"],
  ["signup", "register", "registration", "onboard", "join"],
  ["checkout", "order", "purchase", "cart", "pay", "payment"],
  ["payment", "pay", "charge", "billing", "invoice", "stripe"],
  ["fail", "error", "decline", "reject"],
  ["user", "account", "customer", "member", "profile"],
  ["email", "mail", "notification", "notify"],
  ["delete", "remove", "destroy"],
  ["create", "add", "insert"],
  ["update", "edit", "modify", "change"],
  ["search", "find", "query", "lookup", "filter"],
  ["upload", "file", "attachment", "storage"],
  ["webhook", "callback", "hook"],
  ["password", "credential", "hash"],
  ["permission", "role", "authorize", "access", "policy"],
  ["subscription", "plan", "billing", "subscribe"],
  ["product", "item", "catalog", "inventory", "stock"],
  ["reset", "forgot", "recover"],
  ["invite", "invitation"],
  ["message", "chat", "conversation"],
  ["comment", "reply"],
  ["ship", "shipping", "delivery", "fulfillment"],
  ["refund", "return"],
  ["token", "jwt"],
  ["cache", "redis"],
];

/** Splits identifiers and text into lower-case words. */
export function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function stem(word: string): string {
  const canonical = CANONICAL[word];
  if (canonical) return canonical;
  if (word.length <= 3) return word;
  let result = word;
  if (result.endsWith("ies") && result.length > 4) result = `${result.slice(0, -3)}y`;
  else if (/(sses|xes|ches|shes)$/.test(result)) result = result.slice(0, -2);
  else if (result.endsWith("s") && !/(ss|us|is)$/.test(result)) result = result.slice(0, -1);
  if (result.endsWith("ing") && result.length > 5) result = undouble(result.slice(0, -3));
  else if (result.endsWith("ed") && result.length > 4) result = undouble(result.slice(0, -2));
  else if (result.endsWith("ation") && result.length > 7) result = result.slice(0, -3);
  if (result.endsWith("e") && result.length > 4) result = result.slice(0, -1);
  return CANONICAL[result] ?? result;
}

function undouble(word: string): string {
  return /([b-df-hj-np-tv-z])\1$/.test(word) && !/(ll|ss|zz)$/.test(word)
    ? word.slice(0, -1)
    : word;
}

/** Joins phrasal verbs and stems every word. Stopwords are kept (callers filter). */
export function normalizeWords(words: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const base = VERB_FORMS[word];
    const next = words[index + 1];
    const joined = base && next ? PHRASAL[base]?.[next] : undefined;
    if (joined) {
      result.push(joined);
      index++;
      continue;
    }
    result.push(stem(word));
  }
  return result;
}

/** Words of a code identifier or path, normalized and without stopwords. */
export function tokenize(text: string): string[] {
  return normalizeWords(splitWords(text)).filter((word) => !isStopword(word));
}

let stopStems: Set<string> | undefined;

function isStopword(stemmed: string): boolean {
  stopStems ??= new Set([...STOPWORDS].map(stem));
  return stemmed.length < 2 || STOPWORDS.has(stemmed) || stopStems.has(stemmed);
}

export interface QueryTerm {
  term: string;
  weight: number;
  source: "query" | "synonym";
}

let synonymIndex: Map<string, Set<string>> | undefined;

function synonyms(): Map<string, Set<string>> {
  if (synonymIndex) return synonymIndex;
  synonymIndex = new Map();
  for (const group of SYNONYM_GROUPS) {
    const stems = group.map(stem);
    for (const term of stems) {
      const related = synonymIndex.get(term) ?? new Set<string>();
      for (const other of stems) if (other !== term) related.add(other);
      synonymIndex.set(term, related);
    }
  }
  return synonymIndex;
}

/** Extracts weighted search terms from a natural-language question. */
export function queryTerms(question: string): QueryTerm[] {
  const normalized = normalizeWords(splitWords(question));
  const terms = new Map<string, QueryTerm>();
  for (const term of normalized) {
    if (isStopword(term)) continue;
    terms.set(term, { term, weight: 1, source: "query" });
  }
  const direct = [...terms.keys()];
  for (const term of direct) {
    for (const related of synonyms().get(term) ?? []) {
      if (!terms.has(related))
        terms.set(related, { term: related, weight: 0.4, source: "synonym" });
    }
  }
  return [...terms.values()];
}
