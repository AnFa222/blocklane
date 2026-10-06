# Blocklane

An independent Minecraft Java Edition launcher for Windows x64. Blocklane installs and switches vanilla game versions, manages separate profiles, includes Java in portable builds, and offers Demo plus Microsoft multi-account support.

**Status: early development, v0.2.2.** Microsoft OAuth, Xbox Live authentication, and XSTS authorization have succeeded in a live user test. Minecraft Services currently rejects Blocklane's application with HTTP 403. Application review is required before full-game sign-in can be validated. Demo remains available. Players never need to register an application or enter a client ID.

![Blocklane interface preview](preview.png)

The preview uses test profile data. It does not show an authenticated game session.

## Features

- Mojang release/snapshot catalog, version search and filters, and cached metadata.
- Installation of vanilla Java versions from 1.13 onward, including client, libraries, natives, assets, and logging configuration.
- Checksum validation, reuse and repair of existing files, cancellation, and retries with bounded concurrent downloads.
- Profiles with pinned game versions, RAM allocation, Java selection, and separate worlds/settings.
- Bundled Java 25 in portable Windows builds; automatic installation of matching Mojang runtimes for other versions.
- Explicit Demo mode; Microsoft account switching/removal, entitlement checks, and encrypted local refresh-token storage.
- Electron sandboxing, context isolation, a restricted renderer bridge, and token redaction in game logs.

## Run from source

Install Node.js 22.12+ and npm, then run on Windows x64:

```powershell
npm ci
node node_modules/electron/install.js
npm start
```

Alternatively, double-click `Start Launcher.cmd`. The launcher downloads Minecraft files directly from Mojang when a version is installed. Game files and worlds are not included in this repository.

1. Create a launch profile and choose a supported version.
2. Select RAM and leave Java set to `auto`.
3. Install the version.
4. Select Demo or a saved Microsoft account, then launch.

Microsoft account creation currently stops at the Minecraft Services approval restriction described above. An account without Java Edition access is not treated as a full-game account.

## Build a portable launcher

```powershell
npm run bundle-java
npm run package -- --release
```

The resulting folder is `dist/Blocklane-0.2.2-win32-x64/`; open `Blocklane.exe` and keep its supporting files beside it. Packaging includes Mojang's Java runtime and its license notices. The launcher is currently unsigned.

Blocklane's public application ID is embedded in `src/app-config.json`. Developers can override it with `BLOCKLANE_MICROSOFT_CLIENT_ID` at build time. A public desktop client does not use a client secret. The release packaging check verifies that an ID is configured; it does not verify service approval.

## Development and validation

```powershell
npm test
npm run smoke
```

The automated suite covers downloads, cancellation, archive handling, profiles/world preservation, Java runtimes, account persistence, token refresh, entitlement rejection, and service-specific error messages. Authentication tests use simulated responses; they do not substitute for live sign-in approval. See [VALIDATION.md](VALIDATION.md).

Data lives under `%APPDATA%/blocklane`. Account tokens are encrypted locally with Electron safeStorage/Windows DPAPI. Profiles and game files live under `minecraft/`; worlds remain under `minecraft/instances/<profile-id>/saves` when a profile is removed. `BLOCKLANE_DATA_DIR` provides an isolated data-directory override.

## Scope

Only vanilla Java Edition is currently supported. Forge, Fabric, Bedrock, pre-1.13 compatibility, and automatic launcher updates are future work. Historical snapshots may need additional compatibility testing. Full authenticated gameplay is pending Minecraft Services access approval.

See [Microsoft application setup](MICROSOFT-SETUP.md), [privacy information](PRIVACY.md), and [security reporting](SECURITY.md).

Blocklane is not affiliated with or endorsed by Mojang Studios or Microsoft. Minecraft game binaries and assets are downloaded from their official services rather than redistributed here. Blocklane source is licensed under [MIT](LICENSE); third-party dependencies and Java retain their own licenses.
