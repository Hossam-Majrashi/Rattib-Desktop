## Rattib Desktop 0.2.4 — experimental release

### Changed in 0.2.4
- Stabilize the Electron smoke runner on CI: prevent background throttling in the isolated test, poll actual display changes instead of waiting indefinitely for an animation frame, and focus the window before native keyboard input.
- Capture Electron process output and handle uncaught startup errors without a blocking native error dialog. Publish bounded process diagnostics and stage-specific GitHub error annotations on failure.
- Add Windows ARM64 runtime regression coverage on every main-branch push, including switching terminal displays while the window is hidden. Retain all keyboard/Arabic assertions and strict failure handling.
- Verify the revised smoke runner on the native Windows ARM64 GitHub runner before rebuilding packages.

### Changed in 0.2.3
- Render connected Arabic lines inside the live terminal instead of a separate read-only panel. xterm still handles PTY parsing and all keyboard, paste and IME input; input bytes are unchanged.
- Follow the current viewport, scrolling and redraws, retain inverse-video selection at row level, and allow switching to the original display without restarting the process.
- Remove Check for updates, its advanced field and comparison metadata from the UI. Preserve older saved release-source definitions internally for compatibility.
- Add illustrative placeholders and Arabic/English explanations for every visible command field, including `strata update` and `strata --version`. Examples are never automatically saved or executed.
- Add viewport/selection regression tests and a real Electron-keyboard smoke test for arrows, Enter and numeric input while the connected Arabic display is active.

### Changed in 0.2.2
- Distinguish installed-version checks, release-source checks and actual updates with Arabic/English command guidance.
- Show the real installer/updater and post-check in the initial confirmation, not just the local version command. Separate approval before modification is retained.
- Label preflight, command execution and postflight in the terminal so an update no longer looks like a version-only check.
- Block Update and Check for updates when their command is identical (ignoring surrounding whitespace) to the installed-version command, in both the UI and backend. Existing definitions remain editable; commands are never silently rewritten.
- Add regression and Electron smoke tests for command separation, configuration warnings and the update confirmation plan.

Manual tool inventory, per-platform commands, an interactive PTY terminal, explicit execution confirmations, and optional version checks.

### Changed in 0.2.1
- Remove manual existing-tool association from the UI and IPC API.
- Every Install click performs a fresh version check, even for a cached installation. A detected tool is not reinstalled.
- Update verifies presence first, requests separate consent for the updater, then checks and saves the actual version after success. Installation also gets a post-success version check.
- Failed checks do not prove absence or silently start an installer. Install/Update require an explicit version command.
- Preserve one PTY session across workflow phases, including its dimensions. Stopping prevents later phases.
- Apply and persist language/Arabic-preview settings immediately; no confirmation button. Theme page, dialog, textarea and terminal scrollbars to match the app.

### Retained from 0.2.0
- Arabic/English interface and native confirmations, with saved language preferences.
- Launch commands and clearer editing without deleting a tool card; older definitions migrate with no command loss.
- Persisted installation/version state and backend duplicate-install protection. Legacy manual-association records remain readable but are no longer accepted as verified presence.
- Browser bidi/shaping for Arabic output; 0.2.3 moves it into the live terminal display. Command/input bytes are never reversed.
- Standard-size Linux launcher icons, pre-launch icon-cache validation, and an explicit per-user shortcut option for packaged AppImage/portable Linux builds.

### Packaging fixes in 0.1.3
- Install `libarchive-tools` explicitly: Arch packaging needs `bsdtar` to generate `.MTREE`.
- Build and upload Arch packages in independent jobs (`packages-arch-x64`, `packages-arch-arm64`).
- Validate zstd integrity, package metadata/version, payload and executable architecture; install x86_64 with its real dependencies in a disposable Arch container and check file presence and shared libraries.
- Normalize workflow line endings in regression tests and enforce LF for shell/workflow files, including Windows checkouts.
- Fix Universal `lipo` argument order; retain checks for both executable and PTY architecture slices.
- Permit the bundled native PTY addon in ad-hoc signed macOS builds via application-scoped entitlements.

**This prototype is not publisher-signed or notarized, and is not a production-ready release.** macOS builds use ad-hoc signing only. Builds do not certify every supported distribution, Hermes/Pi installer flow, or real-device compatibility. Test installers in a disposable environment first.

### Download architectures
- Linux: x86_64 and aarch64; AppImage (+ external zsync metadata), deb, rpm, Arch zstd package, tar.gz, Flatpak.
- macOS: x86_64, arm64, Universal DMG.
- Windows: x64 and arm64; native-architecture MSI, setup.exe, portable.zip.
- No Linux armv7/i686 or Windows x86: Electron 45.2.3 does not ship these runtimes.

### Important limitations
- Shell commands run with your account permissions. Rattib is not a sandbox for installers.
- Flatpak intentionally permits host command execution; its host PTY integration still requires real-world testing.
- MSI installation is machine-wide and requires administrator consent. The NSIS installer is per-user.
- AppImage zsync files support external zsync downloads; automatic self-updating and AppImageUpdate discovery are not implemented.
- No background device scans, automatic updates, encrypted secret storage, or terminal-session file logging. Existing-tool checks run only for user-added tools after explicit approval.
- Presence is cached, not continuously monitored. Install/Update recheck it on demand. A successful launch is not proof of a verified version.
- Connected Arabic display preserves keyboard interaction but not every cell-positioned, mouse-driven or colored TUI detail. Use Original display for those interfaces.
- Compare SHA256SUMS before using downloaded assets. Checksums alone are not a publisher signature.
