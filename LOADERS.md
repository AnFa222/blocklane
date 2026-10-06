# Mod loader support

The profile editor supports Vanilla, Fabric, Forge and NeoForge. Minecraft and loader versions are pinned independently. Existing profiles default to Vanilla. Loader builds are fetched from official catalogs and filtered for the selected game version; unavailable combinations cannot be saved.

Fabric uses [Fabric Meta](https://github.com/FabricMC/fabric-meta) launcher profiles and the official Maven repository. Libraries are checksum-verified. Inherited Minecraft arguments, assets and native libraries are retained while loader libraries override conflicting parent artifacts.

Forge uses its official Maven catalog and checksum-verified installer. NeoForge uses [NeoForged's Maven repository](https://maven.neoforged.net/releases/net/neoforged/neoforge/) and official installer. Both installers run in client mode against Blocklane's own Minecraft directory, never the user's default `.minecraft`. Their patch processors prepare the required client libraries. Installation checks the metadata's inherited Minecraft version before executing the installer. Modern release numbering filters NeoForge's catalog; snapshot-specific builds are currently excluded, and the installer metadata is the final compatibility check.

Installation is complete only after required libraries and merged metadata are ready. Cancelling or failing an installation leaves no completed loader marker. Retry through the profile's Install / repair button. The game uses its version-compatible managed Java runtime; existing worlds are retained.

Each profile has an independent `instances/<profile-id>/mods` folder. Use the profile's Mods folder button to open it. Mod management, automatic dependency resolution, Quilt, OptiFine and modpack imports are not implemented in this milestone. Fabric API is not bundled.

## Validation — 6 October 2026

- 40 automated tests passed, including compatible catalogs, inherited arguments/library conflicts, invalid coordinates, checksum requirements, cancellation without a completion marker, and world preservation.
- Browser UI checks passed for all three loader selectors, unavailable combinations, asynchronous selection races, profile install/play state, mods-folder action, installed variants and layout at 1000×700.
- Actual sandboxed Electron smoke test loaded all three live loader catalogs and persisted a NeoForge profile through IPC.
- Real official installer checks for Minecraft 1.21.1 succeeded for Fabric 0.19.5, Forge 1.21.1-52.1.16 and NeoForge 21.1.256. Checked the resulting main classes and all launch library files in isolated test data. The loader checks used the actual downloaded Minecraft client and libraries; the unrelated full asset download was stopped to avoid duplicating thousands of assets. These are installer checks, not full modded gameplay tests.
- Full Microsoft Minecraft Services sign-in still awaits application approval. Demo remains available. Modded gameplay with a user's selected mods remains unverified.
