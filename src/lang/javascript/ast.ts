import ts from "typescript";
import type { ArgFact, ChainSegment, InitSummary } from "../../indexer/facts.js";

export type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

export function isInlineFunction(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

export function columnOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).character + 1;
}

export function endLineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

/** Collapses whitespace and truncates to `max` characters. */
export function oneLine(text: string, max = 120): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

export function textOf(sf: ts.SourceFile, node: ts.Node, max = 120): string {
  return oneLine(node.getText(sf), max);
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false;
}

/** Removes syntax that does not change which value an expression refers to. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/**
 * Returns the identifier path of an expression such as `a.b.c`, `this.repo`
 * or `obj["key"]`; undefined for anything more dynamic.
 */
export function getPath(expression: ts.Node): string[] | undefined {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return ["this"];
  if (expression.kind === ts.SyntaxKind.SuperKeyword) return ["super"];
  if (ts.isPrivateIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const base = getPath(expression.expression);
    return base ? [...base, expression.name.text] : undefined;
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    if (ts.isStringLiteralLike(argument)) {
      const base = getPath(expression.expression);
      return base ? [...base, argument.text] : undefined;
    }
    return undefined;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return getPath(expression.expression);
  }
  return undefined;
}

export function getJsxTagPath(tag: ts.JsxTagNameExpression): string[] | undefined {
  if (ts.isJsxNamespacedName(tag)) return undefined;
  return getPath(tag);
}

/** Text of a template literal with substitutions written as `${expr}`. */
export function templateText(sf: ts.SourceFile, node: ts.TemplateExpression): string {
  let text = node.head.text;
  for (const span of node.templateSpans) {
    text += "${" + oneLine(span.expression.getText(sf), 60) + "}" + span.literal.text;
  }
  return text;
}

export function summarizeArg(sf: ts.SourceFile, raw: ts.Expression, depth = 0): ArgFact {
  const expression = unwrapExpression(raw);
  if (ts.isStringLiteralLike(expression)) return { kind: "string", value: expression.text };
  if (ts.isTemplateExpression(expression)) {
    return { kind: "template", value: templateText(sf, expression) };
  }
  if (ts.isNumericLiteral(expression)) return { kind: "number", value: Number(expression.text) };
  if (isInlineFunction(expression)) return { kind: "function" };
  const path = getPath(expression);
  if (path) return { kind: "path", path };
  if (ts.isObjectLiteralExpression(expression) && depth < 2) {
    const props: Record<string, ArgFact> = {};
    for (const property of expression.properties) {
      const name = property.name ? propertyNameText(property.name) : undefined;
      if (!name) continue;
      if (ts.isPropertyAssignment(property)) {
        props[name] = summarizeArg(sf, property.initializer, depth + 1);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        props[name] = { kind: "path", path: [property.name.text] };
      } else if (ts.isMethodDeclaration(property)) {
        props[name] = { kind: "function" };
      }
    }
    return { kind: "object", props };
  }
  if (ts.isCallExpression(expression) && depth < 2) {
    const calleePath = getPath(expression.expression);
    if (calleePath) {
      return {
        kind: "call",
        path: calleePath,
        args: expression.arguments.slice(0, 4).map((arg) => summarizeArg(sf, arg, depth + 1)),
      };
    }
  }
  return { kind: "other", text: textOf(sf, expression, 60) };
}

export function summarizeArgs(sf: ts.SourceFile, args: readonly ts.Expression[]): ArgFact[] {
  return args.slice(0, 4).map((arg) => summarizeArg(sf, arg));
}

export function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

export interface FlattenedCall {
  /** Innermost call of a fluent chain. */
  base: ts.CallExpression;
  basePath: string[] | undefined;
  /** Subsequent calls in the chain, inner to outer. */
  segments: { name: string; call: ts.CallExpression }[];
}

/**
 * Splits a fluent call chain like `db.select().from(users).where(x)` into the
 * base call (`db.select()`) and its continuation segments (`from`, `where`).
 */
export function flattenCall(call: ts.CallExpression): FlattenedCall {
  const segments: { name: string; call: ts.CallExpression }[] = [];
  let current = call;
  for (;;) {
    const callee = unwrapExpression(current.expression);
    if (ts.isPropertyAccessExpression(callee)) {
      const inner = unwrapExpression(callee.expression);
      const innerCall = ts.isAwaitExpression(inner) ? unwrapExpression(inner.expression) : inner;
      if (ts.isCallExpression(innerCall)) {
        segments.unshift({ name: callee.name.text, call: current });
        current = innerCall;
        continue;
      }
    }
    break;
  }
  return { base: current, basePath: getPath(current.expression), segments };
}

export function chainSegments(sf: ts.SourceFile, flattened: FlattenedCall): ChainSegment[] {
  return flattened.segments.map((segment) => ({
    name: segment.name,
    args: summarizeArgs(sf, segment.call.arguments),
  }));
}

/**
 * Summarizes a variable initializer so later analysis can tell what a binding
 * holds: a constructed client, a factory result, an alias, a constant, etc.
 */
export function summarizeInit(sf: ts.SourceFile, raw: ts.Expression | undefined): InitSummary {
  if (!raw) return { kind: "other" };
  let expression = unwrapExpression(raw);
  if (ts.isAwaitExpression(expression)) expression = unwrapExpression(expression.expression);

  if (ts.isNewExpression(expression)) {
    const callee = getPath(expression.expression);
    return callee
      ? { kind: "new", callee, args: summarizeArgs(sf, expression.arguments ?? []) }
      : { kind: "other" };
  }
  if (ts.isCallExpression(expression)) {
    const flattened = flattenCall(expression);
    if (flattened.basePath) {
      const segments = chainSegments(sf, flattened);
      return {
        kind: "call",
        callee: flattened.basePath,
        args: summarizeArgs(sf, flattened.base.arguments),
        ...(segments.length > 0 ? { chain: segments } : {}),
      };
    }
    // e.g. `new PrismaClient().$extends(...)`: describe the innermost constructed value.
    const inner = unwrapExpression(flattened.base.expression);
    if (ts.isPropertyAccessExpression(inner)) return summarizeInit(sf, inner.expression);
    return { kind: "other" };
  }
  if (ts.isObjectLiteralExpression(expression)) return { kind: "object" };
  if (ts.isStringLiteralLike(expression)) return { kind: "string", value: expression.text };
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      const left = summarizeInit(sf, expression.left);
      const right = summarizeInit(sf, expression.right);
      if (left.kind === "new" || left.kind === "call") return left;
      if (right.kind === "new" || right.kind === "call") return right;
      return left.kind === "other" ? right : left;
    }
    return { kind: "other" };
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = summarizeInit(sf, expression.whenTrue);
    if (whenTrue.kind === "new" || whenTrue.kind === "call") return whenTrue;
    return summarizeInit(sf, expression.whenFalse);
  }
  const path = getPath(expression);
  if (path) return { kind: "alias", path };
  return { kind: "other" };
}

/** Reads the doc comment (JSDoc or line comments) directly above a node. */
export function leadingDoc(sf: ts.SourceFile, node: ts.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart());
  if (!ranges || ranges.length === 0) return undefined;
  const last = ranges[ranges.length - 1];
  if (!last) return undefined;
  const raw = sf.text.slice(last.pos, last.end);
  let text: string;
  if (raw.startsWith("/*")) {
    text = raw
      .replace(/^\/\*\*?/, "")
      .replace(/\*\/$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, ""))
      .filter((line) => !line.trim().startsWith("@"))
      .join(" ");
  } else {
    // Merge consecutive `//` lines into one paragraph.
    const lines: string[] = [];
    for (const range of ranges) {
      const part = sf.text.slice(range.pos, range.end);
      if (part.startsWith("//")) lines.push(part.replace(/^\/\/\s?/, ""));
    }
    text = lines.join(" ");
  }
  const cleaned = oneLine(text, 400);
  if (cleaned.length < 3 || /^(eslint|@ts-|prettier|biome)/.test(cleaned)) return undefined;
  return cleaned;
}

/** Names introduced by a binding pattern: `{ a, b: c }` -> ["a", "c"]. */
export function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    names.push(...bindingNames(element.name));
  }
  return names;
}

export function parameterNames(fn: FunctionNode): string[] {
  return fn.parameters.flatMap((parameter) => bindingNames(parameter.name));
}

export function isAsync(fn: FunctionNode): boolean {
  return hasModifier(fn, ts.SyntaxKind.AsyncKeyword);
}

/** Does the function contain JSX outside of nested named functions? */
export function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    if (ts.isFunctionDeclaration(child) || ts.isClassDeclaration(child)) return;
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

export function firstLine(sf: ts.SourceFile, node: ts.Node, max = 160): string {
  const text = node.getText(sf);
  const newline = text.indexOf("\n");
  const head = newline === -1 ? text : text.slice(0, newline);
  return oneLine(head.replace(/\{\s*$/, "").trim(), max);
}

export function scriptKindFor(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) {
    return ts.ScriptKind.TS;
  }
  // Plain .js files frequently contain JSX in React projects; the JSX grammar is a superset.
  return ts.ScriptKind.JSX;
}
