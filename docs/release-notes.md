## Rattib Desktop — experimental first build

Manual tool inventory, per-platform commands, an interactive PTY terminal, explicit execution confirmations, and optional version checks.

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
- No automatic detection, updates, secret storage, or terminal-session file logging.
- Compare SHA256SUMS before using downloaded assets. Checksums alone are not a publisher signature.
