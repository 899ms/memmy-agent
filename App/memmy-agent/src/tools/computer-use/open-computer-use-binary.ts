import { constants, accessSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Resolve only the default command; explicit user commands remain authoritative. */
export function resolveOpenComputerUseCommand(
  command: string,
  options: { platform?: string; arch?: string; packageRoot?: string } = {},
): string {
  if (command !== "open-computer-use") return command;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (!["arm64", "x64"].includes(arch)) return command;
  const cpu = arch === "x64" ? "amd64" : "arm64";
  const relative = platform === "darwin"
    ? ["dist", "Open Computer Use.app", "Contents", "MacOS", "OpenComputerUse"]
    : platform === "linux"
      ? ["dist", "linux", cpu, "open-computer-use"]
      : platform === "win32"
        ? ["dist", "windows", cpu, "open-computer-use.exe"]
        : null;
  if (!relative) return command;
  try {
    const root = options.packageRoot ?? path.dirname(require.resolve("open-computer-use/package.json"));
    // child_process.spawn needs an actual disk path, including in Electron's Node mode.
    const binary = path.join(root, ...relative).replace(/([\\/])app\.asar([\\/])/g, "$1app.asar.unpacked$2");
    accessSync(binary, platform === "win32" ? constants.F_OK : constants.X_OK);
    return binary;
  } catch {
    // Source/CLI installs may still provide the command through PATH.
    return command;
  }
}
