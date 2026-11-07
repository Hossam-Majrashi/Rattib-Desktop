## Rattib Desktop 0.2.0 — experimental release

Manual tool inventory, per-platform commands, an interactive PTY terminal, explicit execution confirmations, and optional version checks.

### New in 0.2.0
- Arabic/English interface and native confirmations, with saved language preferences.
- Launch commands and clearer editing without deleting a tool card; older definitions migrate with no command loss.
- Persisted installation/version state and explicit manual association for existing tools.
- Backend duplicate-install protection. Unknown tools with a version command are checked first; failed checks never automatically start an installer.
- Read-only Arabic output panel using browser bidi/shaping. The interactive terminal remains LTR and command bytes are not reversed.
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
- Presence is cached, not continuously monitored. Manual association and a successful launch are not proof of a verified version.
- Arabic reading mode is read-only and may not preserve cursor-heavy TUI layouts. Use the original terminal for input.
- Compare SHA256SUMS before using downloaded assets. Checksums alone are not a publisher signature.
