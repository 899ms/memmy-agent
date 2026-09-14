import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenComputerUseCommand } from "../../../src/tools/computer-use/open-computer-use-binary.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bundled Open Computer Use command", () => {
  it.each([
    ["darwin", "arm64", "dist/Open Computer Use.app/Contents/MacOS/OpenComputerUse"],
    ["darwin", "x64", "dist/Open Computer Use.app/Contents/MacOS/OpenComputerUse"],
    ["linux", "x64", "dist/linux/amd64/open-computer-use"],
    ["linux", "arm64", "dist/linux/arm64/open-computer-use"],
    ["win32", "x64", "dist/windows/amd64/open-computer-use.exe"],
    ["win32", "arm64", "dist/windows/arm64/open-computer-use.exe"],
  ])("selects the executable for %s %s outside asar", (platform, arch, relative) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-ocu-"));
    roots.push(root);
    const packageRoot = path.join(root, "app.asar", "node_modules", "open-computer-use");
    const binary = path.join(root, "app.asar.unpacked", "node_modules", "open-computer-use", relative);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "fixture", { mode: 0o755 });
    expect(resolveOpenComputerUseCommand("open-computer-use", { platform, arch, packageRoot })).toBe(binary);
  });

  it("retains explicit commands, unsupported targets and PATH fallback for missing bundles", () => {
    for (const command of ["/custom/open-computer-use", "./open-computer-use", "C:\\custom\\open-computer-use.exe", "npx"]) {
      expect(resolveOpenComputerUseCommand(command)).toBe(command);
    }
    expect(resolveOpenComputerUseCommand("open-computer-use", { packageRoot: "/missing-ocu-package" })).toBe("open-computer-use");
    expect(resolveOpenComputerUseCommand("open-computer-use", { platform: "freebsd" })).toBe("open-computer-use");
    expect(resolveOpenComputerUseCommand("open-computer-use", { arch: "ia32" })).toBe("open-computer-use");
  });
});
