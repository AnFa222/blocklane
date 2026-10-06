# Privacy

Blocklane stores launcher settings, profiles, game files, and worlds on the user's computer. It does not currently operate an account server, analytics service, or advertising service.

## Microsoft accounts

Sign-in takes place on Microsoft's website using a device code. Blocklane does not collect Microsoft passwords or MFA answers. After authorization, Blocklane exchanges tokens directly with Microsoft, Xbox Live, and Minecraft Services to authenticate and verify Java Edition access.

Renewable Microsoft tokens, Minecraft profile IDs, account display names, and the issuing public application ID are stored in `%APPDATA%/blocklane/accounts.enc`, encrypted using Electron safeStorage backed by Windows DPAPI. Minecraft access tokens are held in memory. Account access tokens are not sent to the renderer. Protecting the Windows user account remains necessary.

Removing an account removes its locally stored entry and in-memory session. This does not delete the Microsoft account or revoke grants on Microsoft's servers. Users can manage application access through their Microsoft account.

## Network requests and logs

Blocklane requests game metadata, files, and Java runtimes from Mojang's official services. Microsoft/Xbox/Minecraft receive authentication requests when a user signs in or refreshes an account. Those services apply their own privacy policies.

Game output is stored locally in `minecraft/logs/latest-launch.log`. Blocklane redacts known session tokens from streamed output, but game logs may contain player names, server addresses, or game content. Review logs before sharing them.

The public client ID shipped with Blocklane identifies the application; it is not a password or client secret.
