; ============================================================================
; Balaji FeeHub - Client PC installer (offline-first client, v1.1.0+)
;
; Packages the staged client folder produced by client-build\build-client.js:
;   BalajiFeeHub.exe (the existing Electron runtime) + resources\app.asar, where
;   app.asar holds the BUNDLED production UI (renderer\app), main.js, preload.js,
;   the updater, and config-store.js. Nothing is compiled here and no development
;   tools are needed on the PC that runs the installer.
;
; Command-line inputs (set by build-client.js):
;   /DMyAppVersion=1.1.0          version shown in Add/Remove Programs
;   /DStagingDir=...              staged client folder to package
;   /DOutputDir=...               where the Setup .exe is written
;   /DOutputName=...              Setup file name (without .exe)
;   /DUserInstall=1               TEST ONLY: per-user install with no UAC prompt
;
; The Main Server address is NOT compiled in. A fresh install writes the default
; (192.168.0.116:8001) to %APPDATA%\BalajiFeeHub\config.json. An upgrade never
; overwrites an existing config, so a changed server address survives updates.
; ============================================================================

#ifndef MyAppVersion
  #define MyAppVersion "1.1.0"
#endif
#ifndef StagingDir
  #define StagingDir "C:\balaji-fee\03-source-code\dist\staging\BalajiFeeHub-Client"
#endif
#ifndef OutputDir
  #define OutputDir "C:\balaji-fee\03-source-code\dist"
#endif
#ifndef OutputName
  #define OutputName "BalajiFeeHub-Client-Setup"
#endif

#define MyAppName "Balaji FeeHub"
#define MyAppPublisher "Balaji Convent & Junior College"
#define MyAppExeName "BalajiFeeHub.exe"
#define MyAppId "{{b9e8d1bc-7804-4b2c-b4d0-aeaa7b92501a}}"
#ifdef UserInstall
  ; The test installer has its own identity, so it never upgrades or replaces a production install.
  #undef MyAppId
  #define MyAppId "{{6f0d3a5e-2c41-4b8e-9d7a-5e1c8b2f4a10}}"
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} Client {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://balajiconvent.in
#ifdef UserInstall
; TEST build: no administrator prompt, installs under the current user.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\BalajiFeeHub\Client
#else
; Production: per-machine install under Program Files, as in earlier versions
; (same AppId, so this upgrades an existing installation in place).
PrivilegesRequired=admin
DefaultDirName={autopf}\BalajiFeeHub\Client
#endif
DefaultGroupName=Balaji FeeHub
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile=C:\balaji-fee\installer-src\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} Client {#MyAppVersion}
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription=Balaji FeeHub Client Installer
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Files]
; The whole staged client: Electron runtime + resources\app.asar (bundled UI).
Source: "{#StagingDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Balaji FeeHub"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Uninstall Balaji FeeHub"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Balaji FeeHub"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Balaji FeeHub"; Flags: postinstall nowait skipifsilent unchecked

; No [Code] section: the default Main Server address (192.168.0.116:8001) is applied
; by the app itself when %APPDATA%\BalajiFeeHub\config.json does not exist yet. The installer
; must not write it, because an administrator install runs under the ADMIN's profile, which
; may not be the cashier's profile.
