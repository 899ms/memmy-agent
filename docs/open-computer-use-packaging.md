# Bundled Open Computer Use

Memmy includes `open-computer-use@0.3.5` as a pinned production dependency.
The default MCP config remains `command: open-computer-use`, `args: [mcp]`.
Both MCP connection and Settings dependency detection resolve that default to
the bundled native executable. Explicit user commands are preserved. If the
bundle is unavailable, the original command is passed through to PATH.

The native executable is launched directly, avoiding the npm launcher's
`/usr/bin/env node` dependency. Packaged paths use `app.asar.unpacked`.
All signed and unsigned desktop configurations unpack the native runtime.
macOS packages exclude Linux/Windows files; Windows x64 packages exclude
macOS/Linux/Windows arm64 files. The complete macOS app bundle is retained,
including its Info.plist, resources and signature files.

The npm package has no runtime npm dependencies. Version 0.3.5 is 12,984,856
bytes unpacked across all platforms; its installed macOS app occupies about
3.8 MiB. This is not a measurement of the final DMG size increase.

## Verification

- Resolver tests cover platform/architecture mapping, ASAR paths, missing
  bundles and explicit commands.
- MCP tests verify native command selection and failure logging; Settings
  tests verify availability with an empty PATH.
- Packaging tests use electron-builder file matching and create actual ASAR
  fixtures for all four desktop packaging configurations.
- macOS and Windows build scripts fail when the staged or unpacked native
  executable is missing.

Local verification on macOS also completed real MCP initialization and
discovered nine tools from 0.3.5 with PATH restricted to system directories.
An isolated ASAR fixture passed the same discovery check under Electron's
Node mode, resolving and launching the unpacked native executable.
These discovery checks did not click, type into, or capture other apps.

## Release verification still required

Use a final signed Memmy build on a machine without Node/npm/global OCU:

1. Start Memmy from Dock and confirm the OCU tools are discovered.
2. Complete the requested macOS permissions, then verify app observation,
   screenshots, clicks and text input against a disposable test app.
3. Restart offline and verify tool discovery and execution again.
4. Check the corresponding installed Windows build on Windows.

OCU starts its own macOS helper app through Launch Services. Do not assume
permission grants to a terminal or Memmy automatically authorize that helper;
verify the actual permission identity after signing. Preserve the complete
nested app and validate its signature in the final release artifact.

When upgrading OCU, update the exact dependency and lockfile together and
repeat package layout, protocol and signed-app verification. The package's
MIT LICENSE is retained in the distributed dependency.
