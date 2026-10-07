# Modpack support

Blocklane can browse Modrinth modpacks or import a local Modrinth `.mrpack` archive. Installing a pack creates an isolated launch profile using the Minecraft and loader versions pinned by `modrinth.index.json`. Fabric, Quilt, Forge, NeoForge, and vanilla packs are supported when the requested loader build exists in its official catalog.

Pack archives are inspected before installation. Blocklane rejects traversal paths, links, duplicate paths, unsupported formats, conflicting loaders, untrusted download hosts, and files without a valid SHA-1. Client files download into a staging directory with bounded concurrency. Overrides and downloaded files are copied into the instance only after every required file succeeds.

Installed pack metadata and managed paths are recorded in `instances/<profile-id>/.blocklane/modpack.json`. Updating replaces only managed pack files. Worlds, screenshots, resource packs, shader packs, `options.txt`, `optionsof.txt`, and `servers.dat` are preserved. If applying staged files fails, Blocklane restores the previous managed files. Removing a pack removes its managed files and launch profile while retaining personal data in the instance directory.

Local imports do not have an upstream update source. Packs installed from Modrinth can be updated from their installed card. The launcher installs the pinned Minecraft version and mod loader when the generated profile is first installed or launched.
