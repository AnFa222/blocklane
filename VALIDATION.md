# Validation — 6 October 2026

## Current status — v0.4.4

The 45-test suite passes. Mod manager coverage verifies loader/version-filtered Modrinth search, SHA-1 checked installs, required dependency tracking, transactional rollback, enable/disable, orphan cleanup, local JAR visibility, protected dependencies, and bounded HTTP retry behavior. The browser Modrinth manager test passes, and a live isolated Sodium search/install/remove check completed successfully against Modrinth.


## Historical status — v0.2.2

The 30-test suite passed before the service-specific authentication diagnostics were added. All 12 authentication tests then passed, including the new test for identifying the failed service without including response secrets. A live user sign-in completed Microsoft OAuth, Xbox Live, and XSTS, but Minecraft Services returned HTTP 403 at `/authentication/login_with_xbox`. Public client flows were enabled and saved in Microsoft Entra. Full-game sign-in and gameplay remain blocked pending application service access review. The sections below are historical records of earlier milestones.

## Player-facing sign-in — v0.2.1

Removed client-ID input and configuration IPC from the player interface. The build embeds a developer-supplied ID; release packaging rejects an absent ID. Configured sign-in opens the Microsoft page automatically. New tests verify that the embedded ID overrides legacy setup for new sign-ins without changing existing token issuers, that IDs are absent from account UI responses, and that an unconfigured build never starts authentication. Actual Microsoft registration is still missing, so this artifact is a development build with Demo available and Microsoft sign-in unavailable.

## Microsoft accounts and Demo — v0.2.0

All 28 automated tests passed. New tests cover distinct saved accounts and duplicate sign-in, selected-account persistence, encrypted vault contents, token-free account summaries, entitlement rejection, pending/slow-down device-code polling, cancellation, refresh-token rotation, mismatched identity rejection, revoked-token errors without fallback, unavailable encryption, unreadable-vault preservation, and cross-chunk log-token redaction. Encryption is tested using an injected test cipher; production uses Electron safeStorage/Windows DPAPI.

Browser UI tests passed for setup, sign-in cancellation, two simulated accounts, full-game versus Demo labels, switching, and removing the selected account. The account preview shows simulated test players, not real signed-in accounts.

**No Blocklane client ID has been provided. Live Microsoft/Xbox/Minecraft sign-in and full authenticated gameplay remain unverified and unavailable until the application is registered with the required service access.** Demo remains available. Account/profile tests do not prove the third-party registration will be approved by Microsoft/Mojang.

## Bundled Java — v0.1.2

The Windows package now contains Mojang's complete Windows x64 Java 25.0.1 runtime (411 files, including license notices). All files were downloaded from Mojang and checked against its runtime manifest. The downloaded java.exe successfully reported Java 25 on this computer. Matching runtimes for other supported versions are installed automatically; existing default-Java profiles migrate to automatic selection without changing explicit custom paths.

The expanded 19-test suite covers runtime selection, default-profile migration, installation and license preservation, offline bundle reuse, repair into writable application data, rejection of a wrong Java major version, and cancellation. Earlier desktop/gameplay limitations below describe the previous builds; full gameplay and Microsoft sign-in remain unverified/unimplemented respectively.

## Download fix — v0.1.1

All 15 automated tests passed. Four new network tests cover HTTP 429 backoff and Retry-After, non-retryable errors and excessive server cooldowns, cancellation during backoff, and a real local HTTP connection cut during a streamed response followed by successful retry and checksum verification. Download requests no longer use global fetch or Undici. A live Mojang check for this revision was blocked by the execution environment's network permissions; the earlier live checks below apply to v0.1.0. The exact Electron assertion was not reproduced locally; the updated transport removes the failing code path shown in the user's screenshot.

## Passed

- 11 Node tests: Mojang OS and feature rules; argument expansion; path validation; profile validation; library/native selection; verified-download reuse and corrupt-file repair; cancellation; bounded-worker failure cleanup; native extraction and symlink rejection; install/profile/cache/removal integration; failed-install retry.
- Java detection against this computer: Java 26.0.2, amd64.
- Live Mojang metadata and checksum-verified library downloads for Minecraft 1.13 and 26.3, plus a live 1.13 native archive extraction.
- Headless Chrome interface tests using the actual HTML/CSS/renderer and a mocked Electron bridge: create and edit profiles, search versions, install-state transition, installed filter, delete cancellation, and 1000 px minimum-width layout. No renderer exceptions. `preview.png` is from this browser test; its profile is test data, not an installed game.
- Portable Windows x64 package creation. The bundled app includes its production dependencies.
- npm audit: zero reported vulnerabilities after replacing the initial ZIP extraction dependency.

## Not verified

- The actual Electron desktop smoke test could not start in the restricted execution environment. Electron 44 stopped at its Windows sandbox filesystem access check before application code ran. Granting read access to the runtime's AppContainer group did not resolve the restricted-token check. No sandbox-disabling flag is included in the delivered application or launch scripts.
- A full game download and gameplay session were not run. The current official release metadata requires Java 25, while this computer's system runtime is Java 26. The app deliberately requests the matching Java major version before launching.
- Microsoft authentication and owned full-game launch are outside this first milestone; every generated game launch uses demo mode.

Run `npm test` for the automated core checks and `npm run smoke` in a normal Windows session for the actual Electron/IPC smoke test. Smoke-test data is isolated from normal launcher data. The smoke test requires a live Mojang catalog connection.
# Launch policy - v0.2.3

All 33 automated tests passed. New coverage verifies case-insensitive removal of inherited JVM injection variables while preserving ordinary environment values, and a 10,000-message live-log flood with bounded memory, batched emission and exit-tail flushing. Existing cross-chunk token-redaction tests still pass. Built a portable Windows x64 release with the bundled runtime. No new in-game FPS improvement or stutter fix has been established; the already-running game remains on v0.2.2 until restarted.
# Mod loaders - v0.3.0

All 40 automated tests passed. Browser UI tests and a real sandboxed Electron smoke test passed. Actual official Fabric, Forge and NeoForge installers for Minecraft 1.21.1 completed in isolated test data, with resulting launch libraries checked. See LOADERS.md for exact builds, checks and limits. Full modded gameplay and user mod compatibility are not yet verified.







