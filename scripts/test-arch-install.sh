#!/usr/bin/env bash
# Install only inside a disposable container, never on the host system.
set -euo pipefail
engine="${RATTIB_CONTAINER_ENGINE:-docker}"
version="$(node -p "require('./package.json').version")"
package="$(realpath "${1:-artifacts}/Rattib-Desktop-${version}-linux-x86_64.pkg.tar.zst")"
test -f "$package"
"$engine" run --rm -v "$package:/tmp/rattib.pkg.tar.zst:ro" docker.io/library/archlinux:base bash -euo pipefail -c '
  # A base image lacks desktop dependencies. Resolve them normally, do not bypass them.
  pacman -Syu --noconfirm --noprogressbar
  pacman -U --noconfirm --noprogressbar /tmp/rattib.pkg.tar.zst
  pacman -Q rattib-desktop
  pacman -Qk rattib-desktop
  test -x "/opt/Rattib Desktop/rattib-desktop"
  ldd "/opt/Rattib Desktop/rattib-desktop" | tee /tmp/rattib-ldd.txt
  if grep -F "not found" /tmp/rattib-ldd.txt; then
    echo "Missing runtime libraries" >&2
    exit 1
  fi
  echo "ARCH_INSTALL_OK dependencies resolved, package installed, payload and linkage verified"
'
