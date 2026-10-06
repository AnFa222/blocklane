# Microsoft sign-in setup for Blocklane

Blocklane is registered with Microsoft using public client ID `ec5c5f19-d2ef-4e68-bf26-4fbb8761dc4e`. Personal Microsoft accounts and public client flows are enabled. Live Microsoft OAuth, Xbox Live, and XSTS authentication succeeded, but Minecraft Services rejected the final sign-in request with HTTP 403. Full-game sign-in remains pending service access approval. Demo works without registration. Players never enter an application ID.

## Minecraft API review

Use the [Minecraft AppID Review form](https://aka.ms/mce-reviewappid) to request approval of Blocklane's public client ID. The form asks for the application name/ID, tenant ID, contact email that can be cross-referenced in the Azure portal, a public project URL, justification, and confirmation that the developer has read the EULA and Usage Guidelines. It says submissions are reviewed weekly; approval is not guaranteed. Microsoft Entra settings alone do not grant Minecraft Services access.

## Application registration

1. Open [Microsoft Entra app registrations](https://entra.microsoft.com/) using an account allowed to create applications in an Entra directory.
2. Register an application named **Blocklane**, supporting **personal Microsoft accounts**.
3. Under **Authentication**, enable **Allow public client flows**. This build uses Microsoft's device-code flow, so it does not require a callback server, redirect URI, or client secret.
4. Copy the **Application (client) ID**. Do not create or share a client secret for this desktop application.
5. Obtain the necessary authorization for Xbox/Minecraft services for this registration. A newly created Entra app alone may not have access to `XboxLive.signin` or Minecraft Services. Access approval is controlled by Microsoft/Mojang; this build cannot grant it or guarantee approval. If authentication returns `invalid_scope`, `unauthorized_client`, or Minecraft HTTP 403, resolve that service access before treating it as a launcher password problem.
6. Set `BLOCKLANE_MICROSOFT_CLIENT_ID` in the developer build environment and run `npm run package -- --release`. Packaging embeds the public ID into the app. Alternatively set `microsoftClientId` in `src/app-config.json` before building. Players never enter an application ID. Release packaging fails if the ID is missing; normal packaging can still create an explicitly unconfigured development build. The built-in ID takes precedence over legacy local setup for new sign-ins; existing account refresh tokens retain their original issuing client ID.

Relevant documentation: [Microsoft device authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [Microsoft Xbox authentication overview](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/s2s-auth-calls/service-authentication/live-website-authentication). The Xbox web-app article describes a confidential server application; its client-secret instructions do **not** apply to Blocklane's public desktop client.

## Adding accounts

Choose **Sign in with Microsoft**. The launcher automatically opens Microsoft’s page in your browser. Enter the code shown in Blocklane on Microsoft's website. Your password and MFA stay on Microsoft's site. Choose a different Microsoft account there when adding another player. Blocklane checks Minecraft Java entitlement and profile availability before saving the account. An account without access can use the separate Demo option instead.

Repeat to save additional accounts. Pick one using **Play as** on the Play screen or **Use account** in Accounts. Adding the same Minecraft profile again updates its sign-in rather than creating a duplicate. Use **Remove** to delete a locally saved account; it does not delete your Microsoft account or Minecraft worlds. Removing the selected account selects Demo.

## Storage and launch behavior

The account vault is `%APPDATA%/blocklane/accounts.enc`. It is encrypted through Electron `safeStorage`, backed by Windows DPAPI. No refresh tokens are saved in profile files, sent to the renderer, or included in UI events. The application stores renewable Microsoft tokens encrypted; Minecraft access tokens remain in memory and are refreshed after restarting or expiration. Protect your Windows user account: OS-backed encryption does not protect against other malicious programs already running as that same user.

Changing the launcher app registration does not overwrite the client ID associated with existing saved accounts; those accounts refresh using the registration that issued their tokens. Re-add an account if you want to move it to a different registration.

Demo launches always receive `--demo` and no real access token. Full launches use the selected authenticated Minecraft identity. Expired, revoked, unavailable, or unlicensed accounts produce an error; the app does not silently substitute Demo or another account. Accounts cannot be switched while a game is running. Launch profiles/world directories remain separate from account selection: changing account does not move or erase profile worlds.

## Verification status

Multi-account persistence, device-code polling, cancellation, entitlement rejection, refresh/rotation, and launch-mode separation are tested with simulated service responses. A live user sign-in succeeded through Microsoft and Xbox/XSTS, then failed at Minecraft authentication with HTTP 403. No Minecraft account was saved from that failed attempt. A full authenticated game session remains unverified and requires approved Minecraft Services access.
