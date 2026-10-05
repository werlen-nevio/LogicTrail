import path from "node:path";
import ts from "typescript";
import type {
  BindingFact,
  ClassInfo,
  FileFacts,
  HandlerRef,
  ImportFact,
  InitSummary,
  MemberRef,
  PropertyFact,
  RouteFact,
  SymbolFact,
  SymbolKind,
} from "../../indexer/facts.js";
import {
  containsJsx,
  endLineOf,
  firstLine,
  getJsxTagPath,
  getPath,
  hasModifier,
  isAsync,
  isFunctionNode,
  isInlineFunction,
  leadingDoc,
  lineOf,
  parameterNames,
  propertyNameText,
  scriptKindFor,
  summarizeInit,
  textOf,
  unwrapExpression,
  type FunctionNode,
} from "./ast.js";
import { classifyFileRoute } from "./file-routes.js";
import { StepExtractor } from "./steps.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "options", "head"]);
const NEXT_ROUTE_EXPORTS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const ROUTER_PACKAGES = new Set([
  "express",
  "fastify",
  "hono",
  "koa",
  "@koa/router",
  "koa-router",
  "elysia",
  "polka",
  "restify",
]);
const NON_ROUTER_PACKAGES = new Set(["axios", "ky", "got", "superagent", "ofetch", "supertest"]);
const ROUTER_FRAMEWORKS = new Map<string, RouteFact["framework"]>([
  ["express", "express"],
  ["fastify", "fastify"],
  ["hono", "hono"],
  ["koa", "koa"],
  ["@koa/router", "koa"],
  ["koa-router", "koa"],
]);
const ROUTER_NAME = /^(app|server|fastify|router|routes|.+Router|.+Routes)$/;
/** Fastify route options that run before the handler. */
const ROUTE_HOOKS = new Set(["onRequest", "preParsing", "preValidation", "preHandler"]);
const NEST_METHODS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All", "Options", "Head"]);
const REQUEST_PARAM = /^(req|request|ctx|c|context)$/;
const LISTENER_METHODS = new Set(["on", "once", "addListener", "subscribe"]);
const UI_EMITTERS = new Set(["window", "document"]);
const QUEUE_PACKAGES = new Set(["bull", "bee-queue"]);
const WRAPPER_CALLEES = new Set([
  "useCallback",
  "memo",
  "forwardRef",
  "observer",
  "asyncHandler",
  "catchAsync",
  "catchErrors",
  "catchAsyncErrors",
  "tryCatch",
  "wrapAsync",
  "expressAsyncHandler",
]);

export function extractJavaScriptFacts(input: {
  path: string;
  content: string;
  hash: string;
}): FileFacts {
  return new FileExtractor(input.path, input.content, input.hash).run();
}

interface SymbolInit {
  name: string;
  kind: SymbolKind;
  node: FunctionNode | ts.ClassLikeDeclaration;
  scope: SymbolFact | undefined;
  scopeKind: SymbolFact["scope"];
  owner?: string;
  /** Node whose leading comment is the documentation. */
  docNode: ts.Node;
  /** Node whose first line is shown as the signature and gives the start line. */
  declarationNode: ts.Node;
}

class FileExtractor {
  private readonly sf: ts.SourceFile;
  private readonly facts: FileFacts;
  private readonly imports = new Map<string, ImportFact>();
  private readonly topInits = new Map<string, InitSummary>();
  private readonly symbolNodes = new Map<ts.Node, SymbolFact>();
  private readonly usedIds = new Set<string>();
  private readonly requireDeclarations = new Set<ts.VariableDeclaration>();
  private readonly fileStem: string;
  private importedFrameworks: Set<RouteFact["framework"]> | undefined;

  constructor(
    private readonly filePath: string,
    content: string,
    hash: string,
  ) {
    this.sf = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(filePath),
    );
    const diagnostics = (this.sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
    this.facts = {
      path: filePath,
      language: /\.[cm]?tsx?$/.test(filePath) ? "typescript" : "javascript",
      hash,
      lineCount: this.sf.getLineAndCharacterOfPosition(this.sf.getEnd()).line + 1,
      imports: [],
      exports: [],
      symbols: [],
      bindings: [],
      routes: [],
      mounts: [],
      listeners: [],
      pages: [],
      directives: [],
      parseErrors: diagnostics?.length ?? 0,
    };
    const base = path.posix.basename(filePath).replace(/\.[^.]+$/, "");
    this.fileStem = base === "index" ? path.posix.basename(path.posix.dirname(filePath)) : base;
  }

  run(): FileFacts {
    this.collectDirectives();
    this.collectImports();
    this.collectTopLevelInits();
    for (const statement of this.sf.statements) this.topLevelStatement(statement);
    this.addFileBasedRoutes();
    this.extractBodies();
    return this.facts;
  }

  // ---------------------------------------------------------------------------
  // Imports and directives

  private collectDirectives(): void {
    for (const statement of this.sf.statements) {
      if (
        ts.isExpressionStatement(statement) &&
        ts.isStringLiteral(statement.expression) &&
        statement.expression.text.startsWith("use ")
      ) {
        this.facts.directives.push(statement.expression.text);
      } else {
        break;
      }
    }
  }

  private addImport(fact: ImportFact): void {
    this.facts.imports.push(fact);
    this.imports.set(fact.local, fact);
  }

  private collectImports(): void {
    for (const statement of this.sf.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const source = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (!clause) continue;
        const line = lineOf(this.sf, statement);
        const typeOnly = clause.isTypeOnly;
        if (clause.name) {
          this.addImport({
            source,
            local: clause.name.text,
            imported: "default",
            line,
            typeOnly,
            kind: "import",
          });
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          this.addImport({
            source,
            local: bindings.name.text,
            imported: "*",
            line,
            typeOnly,
            kind: "import",
          });
        } else if (bindings) {
          for (const element of bindings.elements) {
            this.addImport({
              source,
              local: element.name.text,
              imported: element.propertyName?.text ?? element.name.text,
              line,
              typeOnly: typeOnly || element.isTypeOnly,
              kind: "import",
            });
          }
        }
      } else if (
        ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        ts.isStringLiteral(statement.moduleReference.expression)
      ) {
        this.addImport({
          source: statement.moduleReference.expression.text,
          local: statement.name.text,
          imported: "default",
          line: lineOf(this.sf, statement),
          typeOnly: statement.isTypeOnly,
          kind: "require",
        });
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          this.requireImport(declaration);
        }
      }
    }
  }

  /** `const x = require("x")`, `const { a } = require("x")`, `const m = await import("x")`. */
  private requireImport(declaration: ts.VariableDeclaration): void {
    if (!declaration.initializer) return;
    let init = unwrapExpression(declaration.initializer);
    let kind: ImportFact["kind"] = "require";
    if (ts.isAwaitExpression(init)) {
      init = unwrapExpression(init.expression);
      kind = "dynamic";
    }
    let member: string | undefined;
    if (ts.isPropertyAccessExpression(init) && ts.isCallExpression(init.expression)) {
      member = init.name.text;
      init = init.expression;
    }
    if (!ts.isCallExpression(init) || init.arguments.length !== 1) return;
    const isRequire = ts.isIdentifier(init.expression) && init.expression.text === "require";
    const isDynamic = init.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamic) return;
    const arg = init.arguments[0];
    if (!arg || !ts.isStringLiteralLike(arg)) return;
    const source = arg.text;
    const line = lineOf(this.sf, declaration);
    if (ts.isIdentifier(declaration.name)) {
      this.addImport({
        source,
        local: declaration.name.text,
        imported: member ?? (isDynamic ? "*" : "default"),
        line,
        typeOnly: false,
        kind,
      });
    } else if (ts.isObjectBindingPattern(declaration.name) && !member) {
      for (const element of declaration.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const imported =
          element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text;
        this.addImport({ source, local: element.name.text, imported, line, typeOnly: false, kind });
      }
    } else {
      return;
    }
    this.requireDeclarations.add(declaration);
  }

  private collectTopLevelInits(): void {
    for (const statement of this.sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && !this.requireDeclarations.has(declaration)) {
          this.topInits.set(declaration.name.text, summarizeInit(this.sf, declaration.initializer));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Top-level declarations and exports

  private topLevelStatement(statement: ts.Statement): void {
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) return;
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    const line = lineOf(this.sf, statement);

    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      const symbol = this.createSymbol({
        name,
        kind: "function",
        node: statement,
        scope: undefined,
        scopeKind: "top",
        docNode: statement,
        declarationNode: statement,
      });
      this.walkFunction(statement, symbol);
      if (exported) {
        this.facts.exports.push({
          kind: "local",
          exported: isDefault ? "default" : name,
          local: symbol.qualifiedName,
          line,
        });
      }
      return;
    }
    if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      this.createClass(statement, name);
      if (exported) {
        this.facts.exports.push({
          kind: "local",
          exported: isDefault ? "default" : name,
          local: name,
          line,
        });
      }
      return;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (this.requireDeclarations.has(declaration)) continue;
        this.variableDeclaration(declaration, undefined, statement);
        if (exported && ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          this.facts.exports.push({ kind: "local", exported: name, local: name, line });
        }
      }
      return;
    }
    if (ts.isExportDeclaration(statement)) {
      this.exportDeclaration(statement);
      return;
    }
    if (ts.isExportAssignment(statement)) {
      this.defaultExport(statement.expression, line);
      return;
    }
    if (ts.isExpressionStatement(statement) && this.commonJsExport(statement)) return;
    this.walk(statement, undefined);
  }

  private exportDeclaration(statement: ts.ExportDeclaration): void {
    if (statement.isTypeOnly) return;
    const line = lineOf(this.sf, statement);
    const source =
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    const clause = statement.exportClause;
    if (!clause) {
      if (source) this.facts.exports.push({ kind: "reexport-all", source, line });
      return;
    }
    if (ts.isNamespaceExport(clause)) {
      if (source) {
        this.facts.exports.push({
          kind: "reexport",
          exported: clause.name.text,
          imported: "*",
          source,
          line,
        });
      }
      return;
    }
    for (const element of clause.elements) {
      if (element.isTypeOnly) continue;
      const exportedName = element.name.text;
      const localName = element.propertyName?.text ?? exportedName;
      if (source) {
        this.facts.exports.push({
          kind: "reexport",
          exported: exportedName,
          imported: localName,
          source,
          line,
        });
      } else {
        this.facts.exports.push({ kind: "local", exported: exportedName, local: localName, line });
      }
    }
  }

  /** `export default <expr>` and `module.exports = <expr>`. */
  private defaultExport(raw: ts.Expression, line: number): void {
    const expression = unwrapExpression(raw);
    if (ts.isIdentifier(expression)) {
      this.facts.exports.push({ kind: "local", exported: "default", local: expression.text, line });
      return;
    }
    if (isInlineFunction(expression)) {
      const name =
        ts.isFunctionExpression(expression) && expression.name ? expression.name.text : "default";
      const symbol = this.createSymbol({
        name,
        kind: "function",
        node: expression,
        scope: undefined,
        scopeKind: "top",
        docNode: expression.parent,
        declarationNode: expression.parent,
      });
      this.walkFunction(expression, symbol);
      this.facts.exports.push({
        kind: "local",
        exported: "default",
        local: symbol.qualifiedName,
        line,
      });
      return;
    }
    if (ts.isClassExpression(expression)) {
      const name = expression.name?.text ?? "default";
      this.createClass(expression, name);
      this.facts.exports.push({ kind: "local", exported: "default", local: name, line });
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const binding: BindingFact = { name: "default", line, init: { kind: "object" } };
      binding.members = this.objectMembers(expression, this.fileStem);
      this.facts.bindings.push(binding);
      this.facts.exports.push({ kind: "local", exported: "default", local: "default", line });
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = getPath(expression.expression);
      const fnArg = expression.arguments.map(unwrapExpression).find(isInlineFunction);
      const last = callee?.[callee.length - 1] ?? "";
      const looksLikeWrapper =
        callee !== undefined && (callee.length === 1 || WRAPPER_CALLEES.has(last));
      if (looksLikeWrapper && fnArg) {
        this.defaultExport(fnArg, line);
        return;
      }
      const identifierArg = expression.arguments.map(unwrapExpression).find(ts.isIdentifier);
      if (looksLikeWrapper && identifierArg && expression.arguments.length === 1) {
        this.facts.exports.push({
          kind: "local",
          exported: "default",
          local: identifierArg.text,
          line,
        });
        return;
      }
    }
    this.facts.bindings.push({ name: "default", line, init: summarizeInit(this.sf, expression) });
    this.facts.exports.push({ kind: "local", exported: "default", local: "default", line });
    this.walk(expression, undefined);
  }

  private commonJsExport(statement: ts.ExpressionStatement): boolean {
    const expression = statement.expression;
    if (
      !ts.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      return false;
    }
    const target = getPath(expression.left);
    if (!target) return false;
    const line = lineOf(this.sf, statement);
    const isModuleExports =
      target.length === 2 && target[0] === "module" && target[1] === "exports";
    if (isModuleExports) {
      const value = unwrapExpression(expression.right);
      this.defaultExport(value, line);
      if (ts.isObjectLiteralExpression(value)) {
        for (const property of value.properties) {
          const name = property.name ? propertyNameText(property.name) : undefined;
          if (!name) continue;
          this.facts.exports.push({
            kind: "local",
            exported: name,
            local: `default.${name}`,
            line,
          });
        }
      }
      return true;
    }
    const memberName =
      target.length === 3 && target[0] === "module" && target[1] === "exports"
        ? target[2]
        : target.length === 2 && target[0] === "exports"
          ? target[1]
          : undefined;
    if (!memberName) return false;
    const value = unwrapExpression(expression.right);
    if (isInlineFunction(value)) {
      const symbol = this.createSymbol({
        name: memberName,
        kind: "function",
        node: value,
        scope: undefined,
        scopeKind: "top",
        docNode: statement,
        declarationNode: statement,
      });
      this.walkFunction(value, symbol);
      this.facts.exports.push({
        kind: "local",
        exported: memberName,
        local: symbol.qualifiedName,
        line,
      });
      return true;
    }
    const valuePath = getPath(value);
    if (valuePath) {
      this.facts.exports.push({
        kind: "local",
        exported: memberName,
        local: valuePath.join("."),
        line,
      });
      return true;
    }
    this.facts.bindings.push({ name: memberName, line, init: summarizeInit(this.sf, value) });
    this.facts.exports.push({ kind: "local", exported: memberName, local: memberName, line });
    this.walk(value, undefined);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Symbols

  private createSymbol(init: SymbolInit): SymbolFact {
    const { name, node, scope, scopeKind } = init;
    let qualifiedName: string;
    if (scopeKind === "member") {
      qualifiedName = `${init.owner ?? "?"}.${name}`;
    } else if (scopeKind === "nested" && scope) {
      qualifiedName = `${scope.qualifiedName}.${name}`;
    } else {
      qualifiedName = name;
    }
    const line = lineOf(this.sf, init.declarationNode);
    let id = qualifiedName;
    if (this.usedIds.has(id)) id = `${qualifiedName}@${line}`;
    this.usedIds.add(id);

    const isFunction = isFunctionNode(node);
    const returnsJsx = isFunction ? containsJsx(node) : false;
    let kind = init.kind;
    if (isFunction && kind === "function" && /^[A-Z]/.test(name) && returnsJsx) kind = "component";

    const doc = leadingDoc(this.sf, init.docNode);
    const symbol: SymbolFact = {
      id,
      name,
      qualifiedName,
      kind,
      line,
      endLine: endLineOf(this.sf, node),
      scope: scopeKind,
      async: isFunction ? isAsync(node) : false,
      params: isFunction ? parameterNames(node) : [],
      signature: firstLine(this.sf, init.declarationNode),
      returnsJsx,
      steps: [],
      envVars: [],
      literals: [],
      locals: {},
      ...(scope ? { parent: scope.id } : {}),
      ...(init.owner ? { owner: init.owner } : {}),
      ...(doc ? { doc } : {}),
    };
    this.facts.symbols.push(symbol);
    this.symbolNodes.set(node, symbol);
    return symbol;
  }

  private walkFunction(fn: FunctionNode, symbol: SymbolFact): void {
    for (const parameter of fn.parameters) {
      if (parameter.initializer) this.walk(parameter.initializer, symbol);
    }
    if (fn.body) this.walk(fn.body, symbol);
  }

  private createClass(node: ts.ClassLikeDeclaration, name: string): void {
    const classSymbol = this.createSymbol({
      name,
      kind: "class",
      node,
      scope: undefined,
      scopeKind: "top",
      docNode: node,
      declarationNode: node,
    });
    const info: ClassInfo = { properties: {} };
    const heritage = node.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    );
    const base = heritage?.types[0];
    const basePath = base ? getPath(base.expression) : undefined;
    if (basePath) info.extends = basePath;
    classSymbol.classInfo = info;
    const controllerPaths = this.nestControllerPaths(node);

    for (const member of node.members) {
      const memberName = member.name ? propertyNameText(member.name) : undefined;
      if (ts.isMethodDeclaration(member) && memberName) {
        const method = this.createSymbol({
          name: memberName,
          kind: "method",
          node: member,
          scope: classSymbol,
          scopeKind: "member",
          owner: name,
          docNode: member,
          declarationNode: member,
        });
        this.walkFunction(member, method);
        if (controllerPaths) this.nestRoutes(member, method, controllerPaths);
      } else if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          const isProperty =
            ts.canHaveModifiers(parameter) && (ts.getModifiers(parameter)?.length ?? 0) > 0;
          if (isProperty && ts.isIdentifier(parameter.name)) {
            info.properties[parameter.name.text] = this.typeInfo(parameter.type);
          }
        }
        if (member.body) {
          for (const statement of member.body.statements)
            this.constructorAssignment(statement, info);
        }
        const ctor = this.createSymbol({
          name: "constructor",
          kind: "method",
          node: member,
          scope: classSymbol,
          scopeKind: "member",
          owner: name,
          docNode: member,
          declarationNode: member,
        });
        this.walkFunction(member, ctor);
      } else if (ts.isPropertyDeclaration(member) && memberName) {
        const initializer = member.initializer ? unwrapExpression(member.initializer) : undefined;
        if (initializer && isInlineFunction(initializer)) {
          const method = this.createSymbol({
            name: memberName,
            kind: "method",
            node: initializer,
            scope: classSymbol,
            scopeKind: "member",
            owner: name,
            docNode: member,
            declarationNode: member,
          });
          this.walkFunction(initializer, method);
        } else {
          const property = this.typeInfo(member.type);
          if (initializer) property.init = summarizeInit(this.sf, initializer);
          info.properties[memberName] = property;
        }
      }
    }
  }

  private constructorAssignment(statement: ts.Statement, info: ClassInfo): void {
    if (!ts.isExpressionStatement(statement)) return;
    const expression = statement.expression;
    if (
      !ts.isBinaryExpression(expression) ||
      expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
    ) {
      return;
    }
    const target = getPath(expression.left);
    if (target?.length !== 2 || target[0] !== "this" || !target[1]) return;
    const existing = info.properties[target[1]] ?? {};
    existing.init = summarizeInit(this.sf, expression.right);
    info.properties[target[1]] = existing;
  }

  private typeInfo(type: ts.TypeNode | undefined): PropertyFact {
    if (!type || !ts.isTypeReferenceNode(type)) return {};
    const typeName = type.typeName.getText(this.sf);
    const typeArgs = type.typeArguments
      ?.filter(ts.isTypeReferenceNode)
      .map((argument) => argument.typeName.getText(this.sf));
    return { typeName, ...(typeArgs && typeArgs.length > 0 ? { typeArgs } : {}) };
  }

  /** `@Controller("users")` prefixes, or undefined when the class is no NestJS controller. */
  private nestControllerPaths(node: ts.ClassLikeDeclaration): string[] | undefined {
    const controller = this.nestDecorators(node).find((entry) => entry.name === "Controller");
    return controller ? nestPaths(controller.call.arguments[0]) : undefined;
  }

  /** NestJS `@Get(":id")`-style routes on a controller method. */
  private nestRoutes(
    member: ts.MethodDeclaration,
    method: SymbolFact,
    prefixes: readonly string[],
  ): void {
    for (const { name, call, decorator } of this.nestDecorators(member)) {
      if (!NEST_METHODS.has(name)) continue;
      for (const prefix of prefixes) {
        for (const routePath of nestPaths(call.arguments[0]) ?? []) {
          this.facts.routes.push({
            method: name.toUpperCase(),
            path: joinUrl(prefix, routePath),
            framework: "nestjs",
            handlers: [{ kind: "symbol", symbol: method.id }],
            line: lineOf(this.sf, decorator),
            text: textOf(this.sf, decorator, 100),
          });
        }
      }
    }
  }

  /** `@Name(...)` decorators imported from @nestjs/common, by imported name. */
  private nestDecorators(
    node: ts.Node,
  ): { name: string; call: ts.CallExpression; decorator: ts.Decorator }[] {
    const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
    const result: { name: string; call: ts.CallExpression; decorator: ts.Decorator }[] = [];
    for (const decorator of decorators) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      const imported = this.imports.get(call.expression.text);
      if (imported?.source === "@nestjs/common") {
        result.push({ name: imported.imported, call, decorator });
      }
    }
    return result;
  }

  private variableDeclaration(
    declaration: ts.VariableDeclaration,
    scope: SymbolFact | undefined,
    statement?: ts.VariableStatement,
  ): void {
    if (!ts.isIdentifier(declaration.name)) {
      if (declaration.initializer) this.walk(declaration.initializer, scope);
      return;
    }
    const name = declaration.name.text;
    const fn = this.functionInitializer(declaration.initializer, scope === undefined);
    if (fn) {
      const symbol = this.createSymbol({
        name,
        kind: "function",
        node: fn,
        scope,
        scopeKind: scope ? "nested" : "top",
        docNode: statement ?? declaration,
        declarationNode: statement ?? declaration,
      });
      this.walkFunction(fn, symbol);
      return;
    }
    const initializer = declaration.initializer
      ? unwrapExpression(declaration.initializer)
      : undefined;
    const init = summarizeInit(this.sf, initializer);
    if (initializer) this.basePathMount(name, initializer, scope);
    if (!scope) {
      const binding: BindingFact = { name, line: lineOf(this.sf, declaration), init };
      if (init.kind === "string") binding.stringValue = init.value;
      if (initializer && ts.isObjectLiteralExpression(initializer)) {
        binding.members = this.objectMembers(initializer, name);
        this.facts.bindings.push(binding);
        return;
      }
      this.facts.bindings.push(binding);
    } else if (init.kind === "new" || init.kind === "call" || init.kind === "alias") {
      scope.locals[name] = init;
    }
    if (initializer) this.walk(initializer, scope);
  }

  /** Returns the function a variable holds, unwrapping `useCallback(fn)`, `memo(fn)`, etc. */
  private functionInitializer(
    initializer: ts.Expression | undefined,
    topLevel: boolean,
  ): ts.ArrowFunction | ts.FunctionExpression | undefined {
    if (!initializer) return undefined;
    const value = unwrapExpression(initializer);
    if (isInlineFunction(value)) return value;
    if (!ts.isCallExpression(value)) return undefined;
    const callee = getPath(value.expression);
    if (!callee) return undefined;
    const functions = value.arguments.map(unwrapExpression).filter(isInlineFunction);
    if (functions.length !== 1) return undefined;
    const last = callee[callee.length - 1] ?? "";
    const isWrapper =
      WRAPPER_CALLEES.has(last) ||
      /^with[A-Z]/.test(last) ||
      (topLevel && callee.length === 1 && value.arguments.length === 1);
    return isWrapper ? functions[0] : undefined;
  }

  /**
   * Hono `new Hono().basePath("/api")` and Koa `new Router({ prefix: "/api" })` prefix the
   * router's own routes; Hono `app.basePath("/api")` mounts the new router under `app`.
   */
  private basePathMount(
    name: string,
    initializer: ts.Expression,
    scope: SymbolFact | undefined,
  ): void {
    const line = lineOf(this.sf, initializer);
    if (ts.isCallExpression(initializer)) {
      const callee = unwrapExpression(initializer.expression);
      const prefixArg = initializer.arguments[0];
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "basePath") return;
      if (!prefixArg || !ts.isStringLiteralLike(prefixArg)) return;
      const parent = getPath(callee.expression);
      if (parent) {
        if (this.routerFramework(parent, scope) !== "hono") return;
        const target: HandlerRef = { kind: "path", path: [name] };
        this.facts.mounts.push({ router: parent, prefix: prefixArg.text, targets: [target], line });
        return;
      }
      const created = unwrapExpression(callee.expression);
      const constructor = ts.isNewExpression(created) ? getPath(created.expression) : undefined;
      if (this.importSource(constructor?.[0] ?? "") !== "hono") return;
      this.facts.mounts.push({
        router: [name],
        prefix: prefixArg.text,
        targets: [],
        line,
        kind: "base-path",
      });
      return;
    }
    if (!ts.isNewExpression(initializer)) return;
    const constructor = getPath(initializer.expression);
    if (ROUTER_FRAMEWORKS.get(this.importSource(constructor?.[0] ?? "") ?? "") !== "koa") return;
    const optionsArg = initializer.arguments?.[0];
    const options = optionsArg ? unwrapExpression(optionsArg) : undefined;
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== "prefix")
        continue;
      const prefix = unwrapExpression(property.initializer);
      if (!ts.isStringLiteralLike(prefix)) continue;
      this.facts.mounts.push({
        router: [name],
        prefix: prefix.text,
        targets: [],
        line,
        kind: "base-path",
      });
    }
  }

  private objectMembers(
    object: ts.ObjectLiteralExpression,
    owner: string,
  ): Record<string, MemberRef> {
    const members: Record<string, MemberRef> = {};
    for (const property of object.properties) {
      const name = property.name ? propertyNameText(property.name) : undefined;
      if (!name) continue;
      if (ts.isMethodDeclaration(property)) {
        const symbol = this.createSymbol({
          name,
          kind: "method",
          node: property,
          scope: undefined,
          scopeKind: "member",
          owner,
          docNode: property,
          declarationNode: property,
        });
        this.walkFunction(property, symbol);
        members[name] = { kind: "symbol", symbol: symbol.id };
      } else if (ts.isPropertyAssignment(property)) {
        const value = unwrapExpression(property.initializer);
        if (isInlineFunction(value)) {
          const symbol = this.createSymbol({
            name,
            kind: "method",
            node: value,
            scope: undefined,
            scopeKind: "member",
            owner,
            docNode: property,
            declarationNode: property,
          });
          this.walkFunction(value, symbol);
          members[name] = { kind: "symbol", symbol: symbol.id };
          continue;
        }
        const valuePath = getPath(value);
        if (valuePath) {
          members[name] = { kind: "path", path: valuePath };
        } else {
          members[name] = { kind: "value", init: summarizeInit(this.sf, value) };
          this.walk(value, undefined);
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        members[name] = { kind: "path", path: [name] };
      }
    }
    return members;
  }

  // ---------------------------------------------------------------------------
  // Generic walk: nested declarations and framework registrations

  private walk(node: ts.Node, scope: SymbolFact | undefined): void {
    if (ts.isFunctionDeclaration(node)) {
      if (!node.name) return;
      const symbol = this.createSymbol({
        name: node.name.text,
        kind: "function",
        node,
        scope,
        scopeKind: scope ? "nested" : "top",
        docNode: node,
        declarationNode: node,
      });
      this.walkFunction(node, symbol);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      this.variableDeclaration(node, scope);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return;
    if (ts.isCallExpression(node) && this.registration(node, scope)) return;
    if (ts.isNewExpression(node) && this.workerRegistration(node, scope)) return;
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      this.reactRouterElement(node);
    }
    if (ts.isObjectLiteralExpression(node)) this.reactRouterObject(node);
    ts.forEachChild(node, (child) => this.walk(child, scope));
  }

  /** Express-style routes, mounts and event listeners. Returns true when handled. */
  private registration(call: ts.CallExpression, scope: SymbolFact | undefined): boolean {
    const callee = unwrapExpression(call.expression);
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;

    if (HTTP_METHODS.has(method)) return this.routeRegistration(call, callee, scope);
    if (method === "use") return this.mountRegistration(call, callee, scope);
    if (method === "route") {
      // Fastify `fastify.route({ ... })` or Hono `app.route("/prefix", subApp)`.
      const first = call.arguments[0];
      if (call.arguments.length === 1) return this.routeOptionsRegistration(call, callee, scope);
      if (call.arguments.length === 2 && first && ts.isStringLiteralLike(first))
        return this.mountRegistration(call, callee, scope);
      return false;
    }
    if (method === "register") return this.pluginRegistration(call, callee, scope);
    if (method === "setGlobalPrefix") return this.globalPrefix(call, callee, scope);
    if (LISTENER_METHODS.has(method)) return this.listenerRegistration(call, callee, scope);
    if (method === "process") return this.queueProcessor(call, callee, scope);
    return false;
  }

  private routeRegistration(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    // Collect `router.route("/x").get(a).post(b)` chains as well as `router.get("/x", a)`.
    const methods: { method: string; call: ts.CallExpression }[] = [];
    let current: ts.CallExpression = call;
    let currentCallee: ts.PropertyAccessExpression = callee;
    while (HTTP_METHODS.has(currentCallee.name.text)) {
      methods.unshift({ method: currentCallee.name.text, call: current });
      const inner = unwrapExpression(currentCallee.expression);
      if (!ts.isCallExpression(inner)) break;
      const innerCallee = unwrapExpression(inner.expression);
      if (!ts.isPropertyAccessExpression(innerCallee)) break;
      current = inner;
      currentCallee = innerCallee;
    }

    let routePath: string | undefined;
    let routerPath: string[] | undefined;
    let handlerStart = 1;
    if (currentCallee.name.text === "route" && current !== call) {
      const pathArg = current.arguments[0];
      if (!pathArg || !ts.isStringLiteralLike(pathArg)) return false;
      routePath = pathArg.text;
      routerPath = getPath(currentCallee.expression);
      handlerStart = 0;
    } else {
      if (methods.length !== 1) return false;
      const pathArg = call.arguments[0];
      if (!pathArg || !ts.isStringLiteralLike(pathArg)) return false;
      routePath = pathArg.text;
      routerPath = getPath(callee.expression);
    }
    if (!routerPath || !(routePath.startsWith("/") || routePath === "*")) return false;

    const handlerArgs = methods.map((entry) => entry.call.arguments.slice(handlerStart));
    if (handlerArgs.some((args) => args.length === 0)) return false;
    const lastHandler = handlerArgs[handlerArgs.length - 1]?.at(-1);
    if (!this.isRouter(routerPath, scope, lastHandler)) return false;

    const framework = this.routerFramework(routerPath, scope);
    const routerOwner = this.routerOwner(routerPath, scope);
    for (const [index, entry] of methods.entries()) {
      const verb = entry.method.toUpperCase();
      const handlers: HandlerRef[] = [];
      for (const arg of handlerArgs[index] ?? []) {
        handlers.push(...this.routeArgRefs(arg, `${verb} ${routePath}`, scope));
      }
      this.facts.routes.push({
        method: verb,
        path: routePath,
        framework,
        router: routerPath,
        ...(routerOwner ? { routerOwner } : {}),
        handlers,
        line: lineOf(this.sf, entry.call),
        text: textOf(this.sf, entry.call, 100),
      });
    }
    return true;
  }

  /** Fastify `fastify.route({ method: "GET", url: "/x", preHandler, handler })`. */
  private routeOptionsRegistration(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const options = call.arguments[0] ? unwrapExpression(call.arguments[0]) : undefined;
    const routerPath = getPath(callee.expression);
    if (!options || !routerPath || !ts.isObjectLiteralExpression(options)) return false;
    const methods: string[] = [];
    let routePath: string | undefined;
    let handler: ts.Expression | undefined;
    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = propertyNameText(property.name);
      const value = unwrapExpression(property.initializer);
      if (key === "method") {
        const values = ts.isArrayLiteralExpression(value) ? value.elements : [value];
        for (const element of values) {
          if (ts.isStringLiteralLike(element)) methods.push(element.text.toUpperCase());
        }
      } else if ((key === "url" || key === "path") && ts.isStringLiteralLike(value)) {
        routePath = value.text;
      } else if (key === "handler") {
        handler = value;
      }
    }
    if (methods.length === 0 || !routePath?.startsWith("/")) return false;
    if (!this.isRouter(routerPath, scope, handler)) return false;
    const framework = this.routerFramework(routerPath, scope);
    const routerOwner = this.routerOwner(routerPath, scope);
    const handlers = this.routeArgRefs(options, `${methods.join(",")} ${routePath}`, scope);
    for (const method of methods) {
      this.facts.routes.push({
        method,
        path: routePath,
        framework,
        router: routerPath,
        ...(routerOwner ? { routerOwner } : {}),
        handlers,
        line: lineOf(this.sf, call),
        text: textOf(this.sf, call, 100),
      });
    }
    return true;
  }

  /** Handler refs of one route argument; a Fastify options object gives its hooks and handler. */
  private routeArgRefs(
    arg: ts.Expression,
    name: string,
    scope: SymbolFact | undefined,
  ): HandlerRef[] {
    const value = unwrapExpression(arg);
    if (!ts.isObjectLiteralExpression(value)) return this.handlerRefs(arg, name, scope);
    const hooks: HandlerRef[] = [];
    const handler: HandlerRef[] = [];
    for (const property of value.properties) {
      const key = property.name ? propertyNameText(property.name) : undefined;
      if (key !== "handler" && !ROUTE_HOOKS.has(key ?? "")) continue;
      const refs = key === "handler" ? handler : hooks;
      if (ts.isPropertyAssignment(property)) {
        refs.push(...this.handlerRefs(property.initializer, name, scope));
      } else if (ts.isShorthandPropertyAssignment(property)) {
        refs.push({ kind: "path", path: [property.name.text] });
      } else if (ts.isMethodDeclaration(property)) {
        const symbol = this.createSymbol({
          name,
          kind: "handler",
          node: property,
          scope,
          scopeKind: scope ? "nested" : "top",
          docNode: property,
          declarationNode: property,
        });
        this.walkFunction(property, symbol);
        refs.push({ kind: "symbol", symbol: symbol.id });
      }
    }
    return [...hooks, ...handler];
  }

  private mountRegistration(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const routerPath = getPath(callee.expression);
    if (!routerPath || !this.isRouter(routerPath, scope, undefined)) return false;
    const args = [...call.arguments];
    let prefix = "";
    const first = args[0];
    if (first && ts.isStringLiteralLike(first)) {
      // Hono middleware for every path: `app.use("*", logger())`.
      prefix = first.text === "*" || first.text === "/*" ? "" : first.text;
      args.shift();
    }
    const targets: HandlerRef[] = [];
    for (const arg of args) {
      const mounted = koaRoutes(arg);
      if (mounted) targets.push({ kind: "path", path: mounted });
      else targets.push(...this.handlerRefs(arg, `use ${prefix || "/"}`, scope));
    }
    const routerOwner = this.routerOwner(routerPath, scope);
    this.facts.mounts.push({
      router: routerPath,
      ...(routerOwner ? { routerOwner } : {}),
      prefix,
      targets,
      line: lineOf(this.sf, call),
    });
    return true;
  }

  /** Fastify `fastify.register(plugin, { prefix: "/api" })`. */
  private pluginRegistration(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const routerPath = getPath(callee.expression);
    const [pluginArg, optionsArg] = call.arguments;
    if (!routerPath || !pluginArg || ts.isStringLiteralLike(pluginArg)) return false;
    if (this.routerFramework(routerPath, scope) !== "fastify") return false;
    if (!this.isRouter(routerPath, scope, undefined)) return false;
    let prefix = "";
    const options = optionsArg ? unwrapExpression(optionsArg) : undefined;
    if (options && ts.isObjectLiteralExpression(options)) {
      for (const property of options.properties) {
        if (!ts.isPropertyAssignment(property) || propertyNameText(property.name) !== "prefix")
          continue;
        const value = unwrapExpression(property.initializer);
        if (ts.isStringLiteralLike(value)) prefix = value.text;
      }
    }
    const targets = this.handlerRefs(pluginArg, `register ${prefix || "/"}`, scope);
    const routerOwner = this.routerOwner(routerPath, scope);
    this.facts.mounts.push({
      router: routerPath,
      ...(routerOwner ? { routerOwner } : {}),
      prefix,
      targets,
      line: lineOf(this.sf, call),
      kind: "register",
    });
    return true;
  }

  /** NestJS `app.setGlobalPrefix("api")` on an app created by `NestFactory.create()`. */
  private globalPrefix(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const routerPath = getPath(callee.expression);
    const prefixArg = call.arguments[0];
    if (routerPath?.length !== 1 || !prefixArg || !ts.isStringLiteralLike(prefixArg)) return false;
    const init = this.lookupInit(routerPath[0] ?? "", scope);
    if (init?.kind !== "call" || this.importSource(init.callee[0] ?? "") !== "@nestjs/core")
      return false;
    this.facts.mounts.push({
      router: routerPath,
      prefix: prefixArg.text,
      targets: [],
      line: lineOf(this.sf, call),
      kind: "global-prefix",
    });
    return true;
  }

  private listenerRegistration(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const [eventArg, handlerArg] = call.arguments;
    if (!eventArg || !handlerArg || !ts.isStringLiteralLike(eventArg)) return false;
    const emitter = getPath(callee.expression) ?? [];
    if (UI_EMITTERS.has(emitter[0] ?? "")) return false;
    const event = eventArg.text;
    const [handler] = this.handlerRefs(handlerArg, `on ${event}`, scope);
    if (!handler) return false;
    this.facts.listeners.push({
      emitter,
      event,
      channel: "event",
      handler,
      line: lineOf(this.sf, call),
      text: textOf(this.sf, call, 100),
    });
    return true;
  }

  /** Bull / bee-queue: `queue.process(handler)` on a `new Queue("name")`. */
  private queueProcessor(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression,
    scope: SymbolFact | undefined,
  ): boolean {
    const emitter = getPath(callee.expression);
    if (!emitter || emitter.length !== 1) return false;
    const init = this.lookupInit(emitter[0] ?? "", scope);
    if (init?.kind !== "new") return false;
    const source = this.importSource(init.callee[0] ?? "");
    if (!source || !QUEUE_PACKAGES.has(source)) return false;
    const queueName = init.args[0]?.kind === "string" ? init.args[0].value : undefined;
    const handlerArg = call.arguments[call.arguments.length - 1];
    if (!queueName || !handlerArg) return false;
    const [handler] = this.handlerRefs(handlerArg, `process ${queueName}`, scope);
    if (!handler) return false;
    this.facts.listeners.push({
      emitter,
      event: queueName,
      channel: "queue",
      handler,
      line: lineOf(this.sf, call),
      text: textOf(this.sf, call, 100),
    });
    return true;
  }

  /** BullMQ: `new Worker("queue", processor)`. */
  private workerRegistration(node: ts.NewExpression, scope: SymbolFact | undefined): boolean {
    const callee = getPath(node.expression);
    if (callee?.length !== 1 || callee[0] === undefined) return false;
    const imported = this.imports.get(callee[0]);
    if (imported?.source !== "bullmq" || imported.imported !== "Worker") return false;
    const [nameArg, handlerArg] = node.arguments ?? [];
    if (!nameArg || !handlerArg || !ts.isStringLiteralLike(nameArg)) return false;
    const [handler] = this.handlerRefs(handlerArg, `worker ${nameArg.text}`, scope);
    if (!handler) return false;
    this.facts.listeners.push({
      emitter: [],
      event: nameArg.text,
      channel: "queue",
      handler,
      line: lineOf(this.sf, node),
      text: textOf(this.sf, node, 100),
    });
    return true;
  }

  private handlerRefs(
    raw: ts.Expression,
    name: string,
    scope: SymbolFact | undefined,
  ): HandlerRef[] {
    const value = unwrapExpression(raw);
    if (isInlineFunction(value)) {
      const symbol = this.createSymbol({
        name,
        kind: "handler",
        node: value,
        scope,
        scopeKind: scope ? "nested" : "top",
        docNode: value,
        declarationNode: value,
      });
      this.walkFunction(value, symbol);
      return [{ kind: "symbol", symbol: symbol.id }];
    }
    if (ts.isArrayLiteralExpression(value)) {
      return value.elements.flatMap((element) => this.handlerRefs(element, name, scope));
    }
    if (ts.isSpreadElement(value)) return this.handlerRefs(value.expression, name, scope);
    const valuePath = getPath(value);
    if (valuePath) return [{ kind: "path", path: valuePath }];
    if (ts.isCallExpression(value)) {
      const inner = value.arguments.map(unwrapExpression).find(isInlineFunction);
      const callee = getPath(value.expression);
      if (inner && callee && value.arguments.length === 1)
        return this.handlerRefs(inner, name, scope);
      for (const arg of value.arguments) this.walk(arg, scope);
      return callee ? [{ kind: "call", path: callee, text: textOf(this.sf, value, 80) }] : [];
    }
    this.walk(value, scope);
    return [];
  }

  /** Is `routerPath` an HTTP app/router object (Express, Fastify, Koa router, ...)? */
  private isRouter(
    routerPath: string[],
    scope: SymbolFact | undefined,
    lastHandler?: ts.Expression,
  ): boolean {
    const head = routerPath[0] ?? "";
    if (routerPath.length === 1) {
      const source = this.originPackage(head, scope);
      if (source && ROUTER_PACKAGES.has(source)) return true;
      if (source && NON_ROUTER_PACKAGES.has(source)) return false;
      const imported = this.imports.get(head);
      if (imported && NON_ROUTER_PACKAGES.has(imported.source)) return false;
    }
    const last = routerPath[routerPath.length - 1] ?? "";
    if (ROUTER_NAME.test(last)) return true;
    // The instance parameter of a Fastify plugin: `async function routes(instance) { ... }`.
    if (this.routerOwner(routerPath, scope) && this.importedRouterFrameworks().has("fastify"))
      return true;
    if (lastHandler) {
      const handler = unwrapExpression(lastHandler);
      if (isInlineFunction(handler)) {
        const first = handler.parameters[0];
        if (first && ts.isIdentifier(first.name) && REQUEST_PARAM.test(first.name.text))
          return true;
      }
    }
    return false;
  }

  /** Package that created `name`, following chains like `const api = app.basePath("/api")`. */
  private originPackage(name: string, scope: SymbolFact | undefined): string | undefined {
    let current = name;
    for (let depth = 0; depth < 4; depth++) {
      const init = this.lookupInit(current, scope);
      const head =
        init?.kind === "call" || init?.kind === "new"
          ? init.callee[0]
          : init?.kind === "alias"
            ? init.path[0]
            : undefined;
      if (!head || head === current) return undefined;
      const source = this.importSource(head);
      if (source) return source;
      current = head;
    }
    return undefined;
  }

  /** Which server framework a router object belongs to (Express unless proven otherwise). */
  private routerFramework(
    routerPath: readonly string[],
    scope: SymbolFact | undefined,
  ): RouteFact["framework"] {
    const head = routerPath[0] ?? "";
    const origin = ROUTER_FRAMEWORKS.get(this.originPackage(head, scope) ?? "");
    if (origin) return origin;
    const imported = this.importedRouterFrameworks();
    if (imported.size === 1) return [...imported][0] ?? "express";
    return head === "fastify" ? "fastify" : "express";
  }

  /** Server frameworks this file imports from, including type-only imports. */
  private importedRouterFrameworks(): Set<RouteFact["framework"]> {
    if (!this.importedFrameworks) {
      this.importedFrameworks = new Set();
      for (const fact of this.facts.imports) {
        const framework = ROUTER_FRAMEWORKS.get(fact.source);
        if (framework) this.importedFrameworks.add(framework);
      }
    }
    return this.importedFrameworks;
  }

  /** Symbol id of the enclosing function when the router is its first parameter. */
  private routerOwner(
    routerPath: readonly string[],
    scope: SymbolFact | undefined,
  ): string | undefined {
    const head = routerPath[0];
    return scope && head && scope.params[0] === head && !scope.locals[head] ? scope.id : undefined;
  }

  private lookupInit(name: string, scope: SymbolFact | undefined): InitSummary | undefined {
    let current: SymbolFact | undefined = scope;
    while (current) {
      const local = current.locals[name];
      if (local) return local;
      current = current.parent
        ? this.facts.symbols.find((s) => s.id === current?.parent)
        : undefined;
    }
    return this.topInits.get(name);
  }

  private importSource(localName: string): string | undefined {
    const source = this.imports.get(localName)?.source;
    return source?.startsWith("node:") ? source.slice(5) : source;
  }

  // ---------------------------------------------------------------------------
  // React Router and file-based routing

  private reactRouterElement(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement): void {
    const tag = getJsxTagPath(node.tagName);
    if (tag?.[tag.length - 1] !== "Route") return;
    let routePath: string | undefined;
    let component: string[] | undefined;
    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue;
      const name = attribute.name.text;
      const initializer = attribute.initializer;
      if (name === "path" && initializer && ts.isStringLiteral(initializer))
        routePath = initializer.text;
      if (
        (name === "element" || name === "component" || name === "Component") &&
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression
      ) {
        component = this.componentPath(initializer.expression);
      }
    }
    if (routePath && component) {
      this.facts.pages.push({
        path: routePath.startsWith("/") ? routePath : `/${routePath}`,
        component: { kind: "path", path: component },
        framework: "react-router",
        line: lineOf(this.sf, node),
      });
    }
  }

  private reactRouterObject(node: ts.ObjectLiteralExpression): void {
    let routePath: string | undefined;
    let component: string[] | undefined;
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyNameText(property.name);
      if (name === "path" && ts.isStringLiteralLike(property.initializer))
        routePath = property.initializer.text;
      if (name === "element" || name === "Component" || name === "component") {
        component = this.componentPath(property.initializer);
      }
    }
    if (routePath && component) {
      this.facts.pages.push({
        path: routePath.startsWith("/") ? routePath : `/${routePath}`,
        component: { kind: "path", path: component },
        framework: "react-router",
        line: lineOf(this.sf, node),
      });
    }
  }

  private componentPath(expression: ts.Expression): string[] | undefined {
    const value = unwrapExpression(expression);
    if (ts.isJsxSelfClosingElement(value)) return getJsxTagPath(value.tagName);
    if (ts.isJsxElement(value)) return getJsxTagPath(value.openingElement.tagName);
    const valuePath = getPath(value);
    return valuePath && /^[A-Z]/.test(valuePath[valuePath.length - 1] ?? "")
      ? valuePath
      : undefined;
  }

  private addFileBasedRoutes(): void {
    const route = classifyFileRoute(this.filePath);
    if (!route) return;
    const exportsByName = new Map<string, string>();
    for (const fact of this.facts.exports) {
      if (fact.kind === "local") exportsByName.set(fact.exported, fact.local);
    }
    const handlerFor = (local: string): HandlerRef => {
      const symbol = this.facts.symbols.find((s) => s.qualifiedName === local && s.scope === "top");
      return symbol
        ? { kind: "symbol", symbol: symbol.id }
        : { kind: "path", path: local.split(".") };
    };
    if (route.kind === "next-app-route") {
      for (const [exported, local] of exportsByName) {
        if (!NEXT_ROUTE_EXPORTS.has(exported)) continue;
        const symbol = this.facts.symbols.find((s) => s.qualifiedName === local);
        this.facts.routes.push({
          method: exported,
          path: route.urlPath,
          framework: "next-app",
          handlers: [handlerFor(local)],
          line: symbol?.line ?? 1,
          text: `export ${exported} (${this.filePath})`,
        });
      }
      return;
    }
    const defaultLocal = exportsByName.get("default");
    if (!defaultLocal) return;
    const symbol = this.facts.symbols.find((s) => s.qualifiedName === defaultLocal);
    if (route.kind === "next-pages-api") {
      this.facts.routes.push({
        method: "ANY",
        path: route.urlPath,
        framework: "next-pages",
        handlers: [handlerFor(defaultLocal)],
        line: symbol?.line ?? 1,
        text: `export default (${this.filePath})`,
      });
      return;
    }
    this.facts.pages.push({
      path: route.urlPath,
      component: handlerFor(defaultLocal),
      framework: route.kind === "next-app-page" ? "next-app" : "next-pages",
      line: symbol?.line ?? 1,
    });
  }

  // ---------------------------------------------------------------------------
  // Function bodies

  private extractBodies(): void {
    const symbolNodeSet = new Set(this.symbolNodes.keys());
    const nestedNames = new Map<string, Set<string>>();
    for (const symbol of this.facts.symbols) {
      if (symbol.scope !== "nested" || !symbol.parent) continue;
      const names = nestedNames.get(symbol.parent) ?? new Set<string>();
      names.add(symbol.name);
      nestedNames.set(symbol.parent, names);
    }
    for (const [node, symbol] of this.symbolNodes) {
      if (!isFunctionNode(node)) continue;
      const extractor = new StepExtractor(
        this.sf,
        symbol,
        node,
        symbolNodeSet,
        nestedNames.get(symbol.id) ?? new Set(),
        this.imports,
      );
      const result = extractor.extract();
      symbol.steps = result.steps;
      symbol.literals = result.literals;
      symbol.envVars = result.envVars;
    }
  }
}

/** Joins URL path parts like the frameworks do: "users" + ":id" -> "/users/:id". */
function joinUrl(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.split("/")).filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

/** Literal paths of a NestJS decorator argument: none, a string, a string array or `{ path }`. */
function nestPaths(arg: ts.Expression | undefined): string[] | undefined {
  if (!arg) return [""];
  const value = unwrapExpression(arg);
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (ts.isArrayLiteralExpression(value)) {
    const paths = value.elements.filter(ts.isStringLiteralLike).map((element) => element.text);
    return paths.length === value.elements.length ? paths : undefined;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const property = value.properties.find(
      (candidate) => candidate.name && propertyNameText(candidate.name) === "path",
    );
    if (!property) return [""];
    return ts.isPropertyAssignment(property) ? nestPaths(property.initializer) : undefined;
  }
  return undefined;
}

/** Koa `router.routes()` / `router.middleware()` passed to `use()` mounts `router`. */
function koaRoutes(arg: ts.Expression): string[] | undefined {
  const value = unwrapExpression(arg);
  if (!ts.isCallExpression(value) || value.arguments.length > 0) return undefined;
  const callee = unwrapExpression(value.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text !== "routes" && callee.name.text !== "middleware") return undefined;
  return getPath(callee.expression);
}
