import ts from "typescript";
import type {
  BranchArm,
  CallFact,
  ExitFact,
  ImportFact,
  RefFact,
  Step,
  SymbolFact,
} from "../../indexer/facts.js";
import {
  bindingNames,
  chainSegments,
  columnOf,
  flattenCall,
  getJsxTagPath,
  getPath,
  isFunctionNode,
  lineOf,
  oneLine,
  propertyNameText,
  summarizeArgs,
  textOf,
  unwrapExpression,
  type FunctionNode,
} from "./ast.js";

const MAX_LITERALS = 40;
const RESPONSE_OBJECTS = new Set(["res", "response", "reply"]);
const CALLBACK_PROPERTY =
  /^(on[A-Z].*|handler|handle[A-Z].*|callback|cb|fn|.+Fn|.+Handler|action|loader|resolver|resolve)$/;
const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

interface WalkContext {
  inLoop: boolean;
  via?: string;
}

/**
 * Walks a function body and produces ordered {@link Step}s: calls, function
 * references, exits (responses/throws), and branch structure.
 *
 * Inline callbacks (promise handlers, effects, inline JSX handlers) are
 * flattened into the enclosing function because they are part of its flow.
 * Named nested functions are separate symbols and are skipped here.
 */
export class StepExtractor {
  private readonly literals = new Set<string>();
  private readonly envVars = new Set<string>();
  private readonly localNames = new Set<string>();
  /** Parameters of the function and of inline callbacks flattened into it. */
  private readonly paramNames = new Set<string>();

  constructor(
    private readonly sf: ts.SourceFile,
    symbol: SymbolFact,
    private readonly fn: FunctionNode,
    /** Function nodes that are their own symbols (skipped while walking). */
    private readonly symbolNodes: ReadonlySet<ts.Node>,
    nestedSymbolNames: ReadonlySet<string>,
    private readonly imports: ReadonlyMap<string, ImportFact>,
  ) {
    for (const name of symbol.params) {
      this.localNames.add(name);
      this.paramNames.add(name);
    }
    if (fn.body) this.collectLocalNames(fn.body);
    for (const name of nestedSymbolNames) this.localNames.delete(name);
  }

  extract(): { steps: Step[]; literals: string[]; envVars: string[] } {
    const body = this.fn.body;
    const steps = body ? this.body(body, { inLoop: false }) : [];
    return {
      steps,
      literals: [...this.literals].slice(0, MAX_LITERALS),
      envVars: [...this.envVars].sort(),
    };
  }

  private collectLocalNames(body: ts.Node): void {
    const visit = (node: ts.Node): void => {
      if (node !== body && isFunctionNode(node) && this.symbolNodes.has(node)) return;
      if (ts.isVariableDeclaration(node)) {
        for (const name of bindingNames(node.name)) this.localNames.add(name);
      } else if (ts.isParameter(node)) {
        for (const name of bindingNames(node.name)) {
          this.localNames.add(name);
          this.paramNames.add(name);
        }
      } else if (ts.isCatchClause(node) && node.variableDeclaration) {
        for (const name of bindingNames(node.variableDeclaration.name)) this.localNames.add(name);
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }

  private body(node: ts.ConciseBody, ctx: WalkContext): Step[] {
    if (ts.isBlock(node)) return this.statements(node.statements, ctx);
    const out: Step[] = [];
    this.expression(node, out, ctx);
    return out;
  }

  private statements(statements: readonly ts.Statement[], ctx: WalkContext): Step[] {
    const out: Step[] = [];
    for (const statement of statements) this.statement(statement, out, ctx);
    return out;
  }

  private nested(statement: ts.Statement, ctx: WalkContext): Step[] {
    const out: Step[] = [];
    this.statement(statement, out, ctx);
    return out;
  }

  private statement(statement: ts.Statement, out: Step[], ctx: WalkContext): void {
    if (ts.isIfStatement(statement)) {
      this.expression(statement.expression, out, ctx);
      const arms: BranchArm[] = [
        {
          label: "then",
          steps: this.nested(statement.thenStatement, ctx),
          terminates: terminates(statement.thenStatement),
        },
      ];
      if (statement.elseStatement) {
        arms.push({
          label: "else",
          steps: this.nested(statement.elseStatement, ctx),
          terminates: terminates(statement.elseStatement),
        });
      }
      if (arms.some((arm) => arm.steps.length > 0)) {
        out.push({
          kind: "branch",
          line: lineOf(this.sf, statement),
          test: textOf(this.sf, statement.expression, 72),
          arms,
        });
      }
      return;
    }
    if (ts.isSwitchStatement(statement)) {
      this.expression(statement.expression, out, ctx);
      const arms: BranchArm[] = statement.caseBlock.clauses.map((clause) => ({
        label: ts.isCaseClause(clause)
          ? `case ${textOf(this.sf, clause.expression, 40)}`
          : "default",
        steps: this.statements(clause.statements, ctx),
        terminates: clause.statements.some(isTerminator),
      }));
      if (arms.some((arm) => arm.steps.length > 0)) {
        out.push({
          kind: "branch",
          line: lineOf(this.sf, statement),
          test: `switch (${textOf(this.sf, statement.expression, 60)})`,
          arms,
        });
      }
      return;
    }
    if (ts.isTryStatement(statement)) {
      out.push(...this.statements(statement.tryBlock.statements, ctx));
      const clause = statement.catchClause;
      if (clause) {
        const steps = this.statements(clause.block.statements, ctx);
        if (steps.length > 0) {
          const param = clause.variableDeclaration
            ? textOf(this.sf, clause.variableDeclaration.name, 30)
            : undefined;
          out.push({
            kind: "catch",
            line: lineOf(this.sf, clause),
            ...(param ? { param } : {}),
            steps,
          });
        }
      }
      if (statement.finallyBlock)
        out.push(...this.statements(statement.finallyBlock.statements, ctx));
      return;
    }
    if (
      ts.isForStatement(statement) ||
      ts.isForOfStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement)
    ) {
      if (ts.isForStatement(statement)) {
        if (statement.initializer) this.expression(statement.initializer, out, ctx);
        if (statement.condition) this.expression(statement.condition, out, ctx);
      } else if (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) {
        this.expression(statement.expression, out, ctx);
      } else {
        this.expression(statement.expression, out, ctx);
      }
      this.statement(statement.statement, out, { ...ctx, inLoop: true });
      return;
    }
    if (ts.isBlock(statement)) {
      out.push(...this.statements(statement.statements, ctx));
      return;
    }
    if (ts.isReturnStatement(statement)) {
      if (statement.expression) this.expression(statement.expression, out, ctx);
      return;
    }
    if (ts.isThrowStatement(statement)) {
      this.throwStatement(statement, out, ctx);
      return;
    }
    if (ts.isExpressionStatement(statement)) {
      this.expression(statement.expression, out, ctx);
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) this.expression(declaration.initializer, out, ctx);
      }
      return;
    }
    if (ts.isLabeledStatement(statement)) {
      this.statement(statement.statement, out, ctx);
      return;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return;
    ts.forEachChild(statement, (child) => {
      if (ts.isExpression(child)) this.expression(child, out, ctx);
    });
  }

  private throwStatement(statement: ts.ThrowStatement, out: Step[], ctx: WalkContext): void {
    const thrown = unwrapExpression(statement.expression);
    const exit: ExitFact = {
      kind: "throw",
      line: lineOf(this.sf, statement),
      text: textOf(this.sf, statement, 100),
    };
    if (ts.isNewExpression(thrown) || ts.isCallExpression(thrown)) {
      for (const arg of thrown.arguments ?? []) this.expression(arg, out, ctx);
      const name = getPath(thrown.expression);
      if (name) exit.errorName = name.join(".");
      const first = thrown.arguments?.[0];
      if (first && ts.isStringLiteralLike(first)) exit.message = first.text;
      const status = findStatus(thrown.arguments ?? []);
      if (status !== undefined) exit.status = status;
    } else {
      this.expression(thrown, out, ctx);
    }
    out.push({ kind: "exit", exit });
  }

  private expression(node: ts.Node, out: Step[], ctx: WalkContext): void {
    if (isFunctionNode(node)) {
      if (this.symbolNodes.has(node)) return;
      if (node.body) out.push(...this.body(node.body, ctx));
      return;
    }
    if (ts.isCallExpression(node)) {
      this.call(node, out, ctx);
      return;
    }
    if (ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) this.expression(arg, out, ctx);
      const exit = this.responseConstructor(node);
      if (exit) out.push({ kind: "exit", exit });
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      this.jsx(node, out, ctx);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      this.recordEnvVar(node);
      this.expression(node.expression, out, ctx);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      const path = getPath(node.expression);
      if (path && isEnvPath(path) && ts.isStringLiteralLike(node.argumentExpression)) {
        this.envVars.add(node.argumentExpression.text);
      }
      ts.forEachChild(node, (child) => this.expression(child, out, ctx));
      return;
    }
    if (ts.isStringLiteralLike(node)) {
      this.recordLiteral(node.text);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      this.objectLiteral(node, out, ctx);
      return;
    }
    if (ts.isClassExpression(node)) return;
    ts.forEachChild(node, (child) => this.expression(child, out, ctx));
  }

  private objectLiteral(node: ts.ObjectLiteralExpression, out: Step[], ctx: WalkContext): void {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = propertyNameText(property.name);
        const value = unwrapExpression(property.initializer);
        const path = getPath(value);
        if (name && path && CALLBACK_PROPERTY.test(name) && this.isExternalRef(path)) {
          out.push({ kind: "ref", ref: this.ref(path, value, "property", name) });
        } else {
          this.expression(property.initializer, out, ctx);
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const name = property.name.text;
        if (CALLBACK_PROPERTY.test(name) && this.isExternalRef([name])) {
          out.push({ kind: "ref", ref: this.ref([name], property, "property", name) });
        }
      } else if (ts.isMethodDeclaration(property)) {
        if (!this.symbolNodes.has(property) && property.body) {
          out.push(...this.body(property.body, ctx));
        }
      } else if (ts.isSpreadAssignment(property)) {
        this.expression(property.expression, out, ctx);
      }
    }
  }

  private call(node: ts.CallExpression, out: Step[], ctx: WalkContext): void {
    const flattened = flattenCall(node);
    const { base, basePath } = flattened;
    if (!basePath) this.expression(base.expression, out, ctx);

    const calleeText = basePath?.join(".") ?? textOf(this.sf, base.expression, 40);
    const deferredFunctions: FunctionNode[] = [];
    const deferredRefs: RefFact[] = [];
    const argumentLists = [base.arguments, ...flattened.segments.map((s) => s.call.arguments)];
    for (const args of argumentLists) {
      for (const arg of args) {
        const value = unwrapExpression(arg);
        if (isFunctionNode(value)) {
          if (!this.symbolNodes.has(value)) deferredFunctions.push(value);
          continue;
        }
        const path = getPath(value);
        if (path && (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value))) {
          if (this.isExternalRef(path)) {
            deferredRefs.push(this.ref(path, value, "argument", undefined, calleeText));
          }
          continue;
        }
        this.expression(arg, out, ctx);
      }
    }

    const exit = basePath ? this.detectExit(node, flattened, basePath) : undefined;
    if (exit) {
      out.push({ kind: "exit", exit });
    } else if (basePath) {
      out.push({ kind: "call", call: this.callFact(node, flattened, basePath, ctx) });
    }

    for (const ref of deferredRefs) out.push({ kind: "ref", ref });
    const effect = basePath && EFFECT_HOOKS.has(basePath[basePath.length - 1] ?? "");
    for (const fn of deferredFunctions) {
      if (!fn.body) continue;
      const via = effect ? "useEffect" : ctx.via;
      out.push(...this.body(fn.body, { ...ctx, ...(via ? { via } : {}) }));
    }
  }

  private callFact(
    node: ts.CallExpression,
    flattened: ReturnType<typeof flattenCall>,
    path: string[],
    ctx: WalkContext,
  ): CallFact {
    const parent = node.parent;
    return {
      path,
      chain: chainSegments(this.sf, flattened),
      line: lineOf(this.sf, flattened.base),
      column: columnOf(this.sf, flattened.base),
      text: textOf(this.sf, node, 120),
      args: summarizeArgs(this.sf, flattened.base.arguments),
      awaited: parent !== undefined && ts.isAwaitExpression(parent),
      inLoop: ctx.inLoop,
      ...(ctx.via ? { via: ctx.via } : {}),
    };
  }

  private jsx(
    node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
    out: Step[],
    ctx: WalkContext,
  ): void {
    if (ts.isJsxFragment(node)) {
      this.jsxChildren(node.children, out, ctx);
      return;
    }
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    const tagPath = getJsxTagPath(opening.tagName);
    const tagName = tagPath?.join(".") ?? "";
    if (
      tagPath &&
      /^[A-Z]/.test(tagPath[tagPath.length - 1] ?? "") &&
      this.isExternalRef(tagPath)
    ) {
      out.push({ kind: "ref", ref: this.ref(tagPath, opening, "jsx-element", tagName) });
    }
    for (const attribute of opening.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) {
        this.expression(attribute.expression, out, ctx);
        continue;
      }
      const name = ts.isIdentifier(attribute.name) ? attribute.name.text : undefined;
      const initializer = attribute.initializer;
      if (!initializer) continue;
      if (ts.isStringLiteral(initializer)) continue;
      if (ts.isJsxExpression(initializer)) {
        if (!initializer.expression) continue;
        const value = unwrapExpression(initializer.expression);
        if (isFunctionNode(value)) {
          if (!this.symbolNodes.has(value) && value.body) {
            const via = name && /^on[A-Z]/.test(name) ? name : ctx.via;
            out.push(...this.body(value.body, { ...ctx, ...(via ? { via } : {}) }));
          }
          continue;
        }
        const path = getPath(value);
        if (path && name && this.isExternalRef(path)) {
          out.push({ kind: "ref", ref: this.ref(path, value, "jsx-attribute", name) });
          continue;
        }
        this.expression(initializer.expression, out, ctx);
      } else {
        this.expression(initializer, out, ctx);
      }
    }
    if (ts.isJsxElement(node)) this.jsxChildren(node.children, out, ctx);
  }

  private jsxChildren(children: ts.NodeArray<ts.JsxChild>, out: Step[], ctx: WalkContext): void {
    for (const child of children) {
      if (ts.isJsxText(child)) {
        const text = oneLine(child.text, 80);
        if (text.length >= 3 && /[a-z]/i.test(text)) this.recordLiteral(text);
      } else if (ts.isJsxExpression(child)) {
        if (child.expression) this.expression(child.expression, out, ctx);
      } else {
        this.expression(child, out, ctx);
      }
    }
  }

  private ref(
    path: string[],
    node: ts.Node,
    context: RefFact["context"],
    name?: string,
    callee?: string,
  ): RefFact {
    return {
      path,
      line: lineOf(this.sf, node),
      column: columnOf(this.sf, node),
      context,
      ...(name ? { name } : {}),
      ...(callee ? { callee } : {}),
      text: textOf(this.sf, node.parent ?? node, 100),
    };
  }

  /** References to parameters and local variables cannot point at other symbols. */
  private isExternalRef(path: string[]): boolean {
    const head = path[0];
    if (!head || (head === "this" && path.length < 2)) return false;
    return !this.localNames.has(head);
  }

  private detectExit(
    node: ts.CallExpression,
    flattened: ReturnType<typeof flattenCall>,
    path: string[],
  ): ExitFact | undefined {
    const line = lineOf(this.sf, node);
    const text = textOf(this.sf, node, 100);
    const head = path[0] ?? "";
    const names = [path[path.length - 1] ?? "", ...flattened.segments.map((s) => s.name)];
    const baseArgs = flattened.base.arguments;

    if (path.length === 2 && RESPONSE_OBJECTS.has(head) && this.paramNames.has(head)) {
      const method = path[1];
      if (method === "status" || method === "sendStatus" || method === "code") {
        const first = baseArgs[0];
        const status = first && ts.isNumericLiteral(first) ? Number(first.text) : undefined;
        const redirect = names.includes("redirect");
        return {
          kind: redirect ? "redirect" : "response",
          line,
          text,
          ...(status !== undefined ? { status } : {}),
        };
      }
      if (method === "redirect") {
        const target = baseArgs.find((arg) => ts.isStringLiteralLike(arg));
        return {
          kind: "redirect",
          line,
          text,
          ...(target && ts.isStringLiteralLike(target) ? { target: target.text } : {}),
        };
      }
      if (method === "json" || method === "send" || method === "end" || method === "render") {
        return { kind: "response", line, text };
      }
    }
    if (path.length === 2 && head === "ctx" && path[1] === "throw") {
      const status = findStatus(baseArgs);
      return { kind: "throw", line, text, ...(status !== undefined ? { status } : {}) };
    }
    if (path.length === 2 && /Response$/.test(head)) {
      const method = path[1];
      if (method === "json") {
        const status = findStatus(baseArgs.slice(1));
        return { kind: "response", line, text, ...(status !== undefined ? { status } : {}) };
      }
      if (method === "redirect") {
        const target = baseArgs[0];
        return {
          kind: "redirect",
          line,
          text,
          ...(target && ts.isStringLiteralLike(target) ? { target: target.text } : {}),
        };
      }
    }
    if (path.length === 1) {
      const imported = this.imports.get(head);
      if (imported?.source === "next/navigation" || imported?.source === "next/router") {
        if (imported.imported === "redirect" || imported.imported === "permanentRedirect") {
          const target = baseArgs[0];
          return {
            kind: "redirect",
            line,
            text,
            ...(target && ts.isStringLiteralLike(target) ? { target: target.text } : {}),
          };
        }
        if (imported.imported === "notFound") return { kind: "response", line, text, status: 404 };
      }
      if (head === "next" && this.paramNames.has("next") && baseArgs.length > 0) {
        return { kind: "throw", line, text, errorName: "next(error)" };
      }
    }
    return undefined;
  }

  private responseConstructor(node: ts.NewExpression): ExitFact | undefined {
    const path = getPath(node.expression);
    if (!path || path.length !== 1 || !/^(Next)?Response$/.test(path[0] ?? "")) return undefined;
    const status = findStatus((node.arguments ?? []).slice(1));
    return {
      kind: "response",
      line: lineOf(this.sf, node),
      text: textOf(this.sf, node, 100),
      ...(status !== undefined ? { status } : {}),
    };
  }

  private recordEnvVar(node: ts.PropertyAccessExpression): void {
    const path = getPath(node.expression);
    if (path && isEnvPath(path)) this.envVars.add(node.name.text);
  }

  private recordLiteral(text: string): void {
    if (this.literals.size >= MAX_LITERALS) return;
    if (text.length < 3 || text.length > 80) return;
    if (!/[a-z]/i.test(text)) return;
    this.literals.add(text);
  }
}

function isEnvPath(path: string[]): boolean {
  return (
    (path.length === 2 && path[0] === "process" && path[1] === "env") ||
    (path.length === 3 && path[0] === "import" && path[1] === "meta" && path[2] === "env")
  );
}

function isTerminator(statement: ts.Statement): boolean {
  return ts.isReturnStatement(statement) || ts.isThrowStatement(statement);
}

/** True if the statement (or a block's top-level statements) return or throw. */
function terminates(statement: ts.Statement): boolean {
  if (isTerminator(statement)) return true;
  if (ts.isBlock(statement)) return statement.statements.some(isTerminator);
  return false;
}

/** Finds `{ status: 401 }` in argument lists, or a leading numeric status. */
function findStatus(args: readonly ts.Expression[]): number | undefined {
  for (const raw of args) {
    const arg = unwrapExpression(raw);
    if (ts.isNumericLiteral(arg)) {
      const value = Number(arg.text);
      if (value >= 100 && value < 600) return value;
    }
    if (ts.isObjectLiteralExpression(arg)) {
      for (const property of arg.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          propertyNameText(property.name) === "status" &&
          ts.isNumericLiteral(property.initializer)
        ) {
          return Number(property.initializer.text);
        }
      }
    }
  }
  return undefined;
}
