module.exports = {
  appId: 'io.github.HossamMajrashi.RattibDesktop',
  productName: 'Rattib Desktop',
  directories: { output: 'release', buildResources: 'assets' },
  files: ['dist/**/*', 'assets/icon.png', 'package.json', '!**/*.map',
    '!node_modules/node-pty/{src,deps,third_party,test,typings,scripts}/**/*',
    '!node_modules/node-pty/build/Release/obj.target/**/*'],
  asar: true,
  asarUnpack: ['node_modules/node-pty/**/*'],
  npmRebuild: true,
  forceCodeSigning: false,
  publish: null,
  toolsets: { appimage: '1.0.3' },
  linux: {
    executableName: 'rattib-desktop', category: 'Utility', syncDesktopName: true,
    icon: 'assets/icon.png', maintainer: 'Hossam Majrashi <mw3mw346@gmail.com>',
    target: ['AppImage', 'deb', 'rpm', 'pacman', 'tar.gz'],
    artifactName: 'Rattib-Desktop-${version}-linux-${arch}.${ext}',
    desktop: { entry: { Name: 'Rattib Desktop', Comment: 'Manage manually added CLI tools', Terminal: 'false' } }
  },
  appImage: { executableArgs: [] },
  deb: { compression: 'xz' },
  rpm: { compression: 'xz' },
  pacman: {
    compression: 'zstd',
    artifactName: 'Rattib-Desktop-${version}-linux-${arch}.pkg.tar.zst',
    depends: ['gtk3', 'nss', 'libxss', 'libxtst', 'at-spi2-core', 'libsecret', 'alsa-lib', 'mesa', 'libcups']
  },
  flatpak: {
    runtime: 'org.freedesktop.Platform', runtimeVersion: '25.08',
    sdk: 'org.freedesktop.Sdk', base: 'org.electronjs.Electron2.BaseApp', baseVersion: '25.08',
    finishArgs: ['--socket=wayland', '--socket=fallback-x11', '--share=ipc', '--device=dri',
      '--share=network', '--talk-name=org.freedesktop.Flatpak'],
    useWaylandFlags: true,
    artifactName: 'Rattib-Desktop-${version}-linux-${arch}.flatpak'
  },
  mac: {
    target: ['dmg'], category: 'public.app-category.developer-tools',
    icon: 'assets/icon.png', hardenedRuntime: true, identity: '-',
    entitlements: 'assets/entitlements.mac.plist', entitlementsInherit: 'assets/entitlements.mac.plist',
    artifactName: 'Rattib-Desktop-${version}-macos-${arch}.${ext}'
  },
  win: {
    target: ['nsis', 'zip'], icon: 'assets/icon.png',
    artifactName: 'Rattib-Desktop-${version}-windows-${arch}-portable.${ext}'
  },
  nsis: {
    artifactName: 'Rattib-Desktop-${version}-windows-${arch}-setup.${ext}',
    oneClick: false, perMachine: false, allowElevation: false,
    allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false
  }
};
