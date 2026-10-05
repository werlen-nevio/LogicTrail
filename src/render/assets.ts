import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ViewerAssets {
  script: string;
  css: string;
}

let cached: ViewerAssets | undefined;

/**
 * Loads the browser viewer. Published builds ship a pre-bundled
 * `dist/viewer/viewer.js`; when running from source (tests, `npm run dev`)
 * the TypeScript entry is bundled on the fly with esbuild.
 */
export async function loadViewerAssets(): Promise<ViewerAssets> {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const viewerDir = path.resolve(here, "../viewer");
  const cssPath = path.join(viewerDir, "viewer.css");
  const builtScript = path.join(viewerDir, "viewer.js");
  const sourceEntry = path.join(viewerDir, "main.ts");
  if (!fs.existsSync(cssPath))
    throw new Error(`Viewer stylesheet not found at ${cssPath}. Run "npm run build".`);
  const css = fs.readFileSync(cssPath, "utf8");

  let script: string;
  if (fs.existsSync(builtScript)) {
    script = fs.readFileSync(builtScript, "utf8");
  } else if (fs.existsSync(sourceEntry)) {
    script = await bundleViewer(sourceEntry);
  } else {
    throw new Error(`Viewer script not found in ${viewerDir}. Run "npm run build".`);
  }
  cached = { script, css };
  return cached;
}

export async function bundleViewer(entry: string, minify = true): Promise<string> {
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify,
    legalComments: "none",
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error("esbuild produced no output for the viewer.");
  return output.text;
}
