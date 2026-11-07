import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const arch = process.argv[2];
if (process.platform !== 'win32' || !['x64', 'arm64'].includes(arch)) throw new Error('Run on Windows with x64 or arm64.');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('MSI requires a stable three-part version.');
const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await mkdir('release', { recursive: true });
const source = resolve(arch === 'x64' ? 'release/win-unpacked' : 'release/win-arm64-unpacked');
const icon = resolve('assets/icon.ico');
const upgrade = arch === 'x64' ? '137654CB-A442-49D8-B0D1-9E580483D3DA' : '835F3F5C-A40E-42CD-A097-AD07D2CD44C4';
const manifest = String.raw`<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
<Package Name="Rattib Desktop" Manufacturer="Hossam Majrashi" Version="${version}" UpgradeCode="${upgrade}" Scope="perMachine">
  <MajorUpgrade DowngradeErrorMessage="A newer version of Rattib Desktop is installed." />
  <MediaTemplate EmbedCab="yes" CompressionLevel="high" />
  <Icon Id="AppIcon" SourceFile="${xml(icon)}" />
  <Property Id="ARPPRODUCTICON" Value="AppIcon" />
  <StandardDirectory Id="ProgramFiles64Folder"><Directory Id="INSTALLFOLDER" Name="Rattib Desktop" /></StandardDirectory>
  <StandardDirectory Id="ProgramMenuFolder">
    <Component Id="AppShortcut" Guid="*">
      <Shortcut Id="StartMenuShortcut" Name="Rattib Desktop" Target="[INSTALLFOLDER]Rattib Desktop.exe" WorkingDirectory="INSTALLFOLDER" />
      <RegistryValue Root="HKLM" Key="Software\RattibDesktop" Name="installed-${arch}" Type="integer" Value="1" KeyPath="yes" />
    </Component>
  </StandardDirectory>
  <Feature Id="Main" Title="Rattib Desktop" Level="1"><ComponentGroupRef Id="AppFiles"/><ComponentRef Id="AppShortcut"/></Feature>
</Package>
<Fragment><ComponentGroup Id="AppFiles" Directory="INSTALLFOLDER"><Files Include="${xml(source)}\**" /></ComponentGroup></Fragment>
</Wix>`;
const wxs = resolve('release', `rattib-${arch}.wxs`);
await writeFile(wxs, manifest);
execFileSync(resolve('.wix', 'wix.exe'), ['build', wxs, '-arch', arch, '-o', join('release', `Rattib-Desktop-${version}-windows-${arch}.msi`)], { stdio: 'inherit' });
