# Security

Blocklane is an early development launcher. Report reproducible non-sensitive bugs through GitHub issues. Do not include passwords, device codes, refresh/access tokens, account vaults, or personal game logs in public reports.

For vulnerabilities involving account access or token exposure, contact the repository owner privately through a contact method on their GitHub profile before publishing sensitive details.

Full-game launches require an authenticated identity and Java Edition entitlement. Demo is explicitly launched with `--demo`. Blocklane does not implement an offline full-game login or remove the game's safety features. The renderer runs with sandboxing and context isolation; authentication remains in the main process.

Dependencies are pinned by `package-lock.json`. Downloads are checked against Mojang's metadata. Checksums detect mismatches; trust also depends on the official HTTPS metadata source.
