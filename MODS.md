# Mod manager

Blocklane's Mods view uses the public Modrinth API to find and install Java Edition mods. Search results are filtered to the selected profile's Minecraft version and loader, so a profile only receives results tagged for Fabric, Quilt, Forge, NeoForge, or LiteLoader as selected. Vanilla profiles do not expose mod installation.

Each profile has an isolated `mods` directory under its instance folder. Managed files are recorded in `.blocklane/managed.json`, and downloads are written transactionally. Blocklane accepts the primary Modrinth JAR only when its published SHA-1 matches the downloaded bytes. A failed install restores the previous manifest and removes files created by that attempt.

Installing a project selects the matching loader and Minecraft version, then installs required Modrinth dependencies recursively. Dependencies are tracked separately from root projects. A dependency remains protected while another installed mod needs it; when a root mod is updated or removed, dependencies that are no longer required are cleaned up automatically.

Managed mods can be enabled or disabled, updated individually through the update list, or removed after confirmation. Disabling renames the managed JAR with `.disabled`; it is reversible. JARs copied into the folder by hand are listed as local files and are never claimed, updated, or deleted by Blocklane.

The manager supports Fabric, Quilt, Forge, NeoForge, and LiteLoader projects published with matching Modrinth loader tags. It does not resolve optional dependencies automatically. Compatibility and actual in-game behavior still depend on the mod, loader build, Java runtime, and selected Minecraft release.
