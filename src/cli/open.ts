import { spawn } from "node:child_process";

/** Opens a file with the operating system's default application. */
export function openFile(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/d", "/s", "/c", `start "" "${file.replace(/"/g, "")}"`], {
            detached: true,
            stdio: "ignore",
            windowsVerbatimArguments: true,
          })
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [file], {
            detached: true,
            stdio: "ignore",
          });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
