/**
 * "Open in editor" links. Shared by the CLI (validation) and the HTML viewer (links), so it must
 * stay free of runtime imports.
 *
 * An editor setting is a built-in name, "none", or a URL template with these placeholders:
 * - `{file}`: the absolute path with forward slashes (`/home/me/app/src/a.ts`, `C:/app/src/a.ts`)
 * - `{path}`: the same without a leading slash, for `scheme://file/{path}` URLs
 * - `{line}`: the 1-based line number
 * Values in the query string are percent-encoded as a component, others as a URI.
 */

export const DEFAULT_EDITOR = "vscode";

export const EDITORS = {
  vscode: { name: "VS Code", template: "vscode://file/{path}:{line}" },
  "vscode-insiders": { name: "VS Code Insiders", template: "vscode-insiders://file/{path}:{line}" },
  vscodium: { name: "VSCodium", template: "vscodium://file/{path}:{line}" },
  cursor: { name: "Cursor", template: "cursor://file/{path}:{line}" },
  idea: { name: "IntelliJ IDEA", template: "idea://open?file={file}&line={line}" },
} as const satisfies Record<string, { name: string; template: string }>;

export type EditorName = keyof typeof EDITORS;

export const EDITOR_NAMES = [...Object.keys(EDITORS), "none"] as const;

function isEditorName(value: string): value is EditorName {
  return Object.prototype.hasOwnProperty.call(EDITORS, value);
}

/** Why an editor setting is not usable, or undefined when it is. */
export function editorProblem(value: string): string | undefined {
  if (value === "none" || isEditorName(value)) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value) || !/\{(file|path)\}/.test(value)) {
    return `Unknown editor "${value}". Use ${EDITOR_NAMES.join(", ")}, or a URL template with {file} or {path} and {line}, e.g. "myeditor://open?file={file}&line={line}".`;
  }
  if (/^(javascript|data|vbscript):/i.test(value)) {
    return `The editor template "${value}" must open an editor, not run a script.`;
  }
  return undefined;
}

export interface EditorLink {
  href: string;
  /** Link title, e.g. "Open in Cursor". */
  title: string;
}

/**
 * The link that opens `absolutePath` at `line` in the configured editor, or undefined for "none"
 * or a setting that isn't valid. Without a setting, VS Code.
 */
export function editorLink(
  editor: string | undefined,
  absolutePath: string,
  line?: number,
): EditorLink | undefined {
  const setting = editor ?? DEFAULT_EDITOR;
  if (setting === "none" || editorProblem(setting)) return undefined;
  const known = isEditorName(setting) ? EDITORS[setting] : undefined;
  const template = known?.template ?? setting;
  const file = absolutePath.replace(/\\/g, "/");
  const values: Record<string, string> = {
    file,
    path: file.replace(/^\/+/, ""),
    line: String(line ?? 1),
  };
  const query = template.indexOf("?");
  const href = template.replace(/\{(file|path|line)\}/g, (_, name: string, offset: number) => {
    const value = values[name] ?? "";
    return query !== -1 && offset > query ? encodeURIComponent(value) : encodeURI(value);
  });
  return { href, title: known ? `Open in ${known.name}` : "Open in editor" };
}
