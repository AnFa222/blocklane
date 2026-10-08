# Minecraft launch policy

Reviewed upstream source on 6 October 2026:

- [Prism Java argument construction](https://github.com/PrismLauncher/PrismLauncher/blob/develop/launcher/minecraft/MinecraftInstance.cpp): explicit minimum/maximum heap, version-specific compatibility handling, configurable arguments and a Windows Intel driver workaround.
- [Modrinth JVM arguments](https://github.com/modrinth/code/blob/main/packages/app-lib/src/launcher/args.rs): Mojang argument expansion, maximum heap, logging configuration and its own integration agent.
- [Modrinth process launch](https://github.com/modrinth/code/blob/main/packages/app-lib/src/launcher/mod.rs): separate game process, removal of `_JAVA_OPTIONS`, optional launcher hiding.

## Blocklane decisions

Use the 64-bit runtime specified by the selected game's Mojang metadata. Preserve its JVM arguments, native paths, classpath, logging configuration and game arguments. The current bundled Java 25 is for versions requiring Java 25; older versions receive their matching runtime. Do not force every game onto the newest Java.

Version 0.4.34 restores the saved 0.4.20 launch policy: initial heap is half the selected maximum rounded up, capped at 2 GiB, with G1GC, ParallelRefProcEnabled, DisableExplicitGC and MaxGCPauseMillis=50. The selected maximum and custom profile arguments remain unchanged. This is a regression rollback, not a verified stutter fix.

Use `javaw.exe` from the selected runtime for the Windows game process when it is available. Runtime inspection still uses `java.exe`. Launch Java as a separate process with an argument array and the profile instance as its working directory. Paths containing spaces remain single arguments. Do not inject an integration agent or change process priority for vanilla play.

Exclude `_JAVA_OPTIONS`, `JAVA_TOOL_OPTIONS`, and `JDK_JAVA_OPTIONS` from the child's inherited environment, case-insensitively. This extends Modrinth's isolation principle to all three JVM injection variables so profile settings cannot silently be replaced by a global heap/agent/collector setting. Preserve PATH and ordinary environment variables; never modify the machine's environment.

Preserve Mojang logging configuration and pipe both output streams as in 0.4.20. When launcher logging is enabled, write redacted output to disk and batch live updates every 1,000 ms with at most 4,096 pending characters. Flush the final tail when the game exits. When disabled, drain and discard both streams without saving or displaying them. This setting does not disable Minecraft internal logging.

Blocklane already inherits Mojang's Windows driver arguments when supplied in version metadata; do not duplicate a workaround merely because Prism includes it. The measured game used the NVIDIA GPU.

These changes reduce avoidable configuration surprises and launcher activity. They do not establish the cause of the user's intermittent stutter or demonstrate an FPS increase. The existing running game continues using its previous launch environment until restarted through the new build.
