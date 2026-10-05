/**
 * File-system routing conventions (Next.js app and pages routers).
 * Pure path logic: given a repository-relative file path, derive the URL path.
 */

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

export type FileRouteKind =
  | { kind: "next-app-route"; urlPath: string }
  | { kind: "next-app-page"; urlPath: string }
  | { kind: "next-pages-api"; urlPath: string }
  | { kind: "next-pages-page"; urlPath: string };

export function classifyFileRoute(filePath: string): FileRouteKind | undefined {
  const segments = filePath.split("/");
  const fileName = segments[segments.length - 1] ?? "";
  if (!SOURCE_FILE.test(fileName)) return undefined;
  const directories = segments.slice(0, -1);
  const stem = fileName.replace(SOURCE_FILE, "");

  const appIndex = directories.lastIndexOf("app");
  if (appIndex !== -1 && (stem === "route" || stem === "page")) {
    const urlPath = toUrlPath(directories.slice(appIndex + 1));
    return stem === "route"
      ? { kind: "next-app-route", urlPath }
      : { kind: "next-app-page", urlPath };
  }

  const pagesIndex = directories.lastIndexOf("pages");
  if (pagesIndex !== -1) {
    if (stem.startsWith("_")) return undefined;
    const routeSegments = [...directories.slice(pagesIndex + 1), stem];
    if (routeSegments[0] === "api") {
      return { kind: "next-pages-api", urlPath: toUrlPath(routeSegments) };
    }
    if (/\.[jt]sx$|\.js$/.test(fileName)) {
      return { kind: "next-pages-page", urlPath: toUrlPath(routeSegments) };
    }
  }
  return undefined;
}

export function toUrlPath(segments: string[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment === "index" || segment === "") continue;
    if (/^\(.*\)$/.test(segment) || segment.startsWith("@")) continue;
    const catchAll = /^\[\[?\.\.\.(\w+)\]?\]$/.exec(segment);
    if (catchAll) {
      parts.push(`:${catchAll[1]}*`);
      continue;
    }
    const dynamic = /^\[(\w+)\]$/.exec(segment);
    parts.push(dynamic ? `:${dynamic[1]}` : segment);
  }
  return `/${parts.join("/")}`;
}
