# Diagnosing periodic game freezes

Use the capture script while the affected vanilla profile is running in a world. It records Java garbage-collection, safepoint, allocation, lock, thread, and execution-sample events with Java Flight Recorder. It also samples process CPU, memory, thread count, handles, and window responsiveness every 250 ms.

1. Start Minecraft from Blocklane and enter a world where the freezes occur.
2. Open PowerShell in the Blocklane project folder.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\capture-game-stutter.ps1 -Seconds 60
   ```

4. Keep walking and turning until the script reports `Capture complete`.
5. Share the newly created folder under `diagnostics`. The `.jfr` recording is the primary evidence; `process-samples.csv` and `jfr-summary.txt` provide supporting data.

The capture contains JVM and process diagnostics. It does not read account tokens, worlds, chat, screenshots, or keystrokes. Java Flight Recorder has low overhead, but test results should still be confirmed once without the recorder after identifying a cause.

## Windows GPU and driver trace

If the Java recording rules out garbage collection, run `Capture Windows GPU Stutter.cmd` while reproducing the problem. It records 30 seconds of Windows GPU, CPU, and disk scheduling through Windows Performance Recorder. Windows asks for administrator approval because kernel scheduling events require elevation. The resulting ETL file is written under `diagnostics\windows-stutter-*`.
