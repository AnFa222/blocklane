# Mod loader support

The profile editor supports Vanilla, Fabric, Quilt, Forge, NeoForge, and LiteLoader. Minecraft and loader versions are pinned independently. Existing profiles default to Vanilla. Loader builds are fetched from official catalogs and filtered for the selected game version; unavailable combinations cannot be saved.

Fabric uses [Fabric Meta](https://github.com/FabricMC/fabric-meta) launcher profiles and the official Maven repository. Libraries are checksum-verified. Inherited Minecraft arguments, assets and native libraries are retained while loader libraries override conflicting parent artifacts.

Quilt uses the official [Quilt Meta API](https://meta.quiltmc.org/) launcher profiles and Maven repository. Quilt profiles use the same isolated instances, verified library downloads, and inherited Minecraft metadata as Fabric profiles.

Forge uses its official Maven catalog and checksum-verified installer. NeoForge uses [NeoForged's Maven repository](https://maven.neoforged.net/releases/net/neoforged/neoforge/) and official installer. Both installers run in client mode against Blocklane's own Minecraft directory, never the user's default `.minecraft`. Their patch processors prepare the required client libraries. Installation checks the metadata's inherited Minecraft version before executing the installer. Modern release numbering filters NeoForge's catalog; snapshot-specific builds are currently excluded, and the installer metadata is the final compatibility check.

LiteLoader support is limited to Minecraft 1.12.2, the final game version listed on the official [LiteLoader download page](https://www.liteloader.com/download). Blocklane reads the official [LiteLoader version manifest](https://dl.liteloader.com/versions/versions.json), verifies its JAR using the manifest MD5, and converts Mojang's legacy launch arguments into the modern internal format. It uses the managed Java 8 runtime required by that game version. LiteLoader is a legacy preview path and modern mods generally target another loader.

Installation is complete only after required libraries and merged metadata are ready. Cancelling or failing an installation leaves no completed loader marker. Retry through the profile's Install / repair button. The game uses its version-compatible managed Java runtime; existing worlds are retained.

Each profile has an independent `instances/<profile-id>/mods` folder. Use the profile's Mods folder button to open it. Modrinth search uses the selected loader, including Quilt and LiteLoader. Optional dependencies and modpack imports are not resolved automatically. Fabric API and Quilted Fabric API are not bundled.

## Validation — 7 October 2026

- Automated tests cover compatible catalogs, inherited arguments and library conflicts, legacy argument conversion, SHA-1 and MD5 validation, invalid coordinates, cancellation without a completion marker, and world preservation.
- Quilt and LiteLoader catalog tests use representative official metadata. Existing live installer validation covers Fabric, Forge, and NeoForge; Quilt and LiteLoader still need full gameplay validation on Windows.
- Full Microsoft Minecraft Services sign-in still awaits application approval. Demo remains available. Modded gameplay with a user's selected mods remains unverified.
