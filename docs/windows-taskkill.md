# Windows process-tree termination

The trusted deployment operator must set
PLAYWRIGHT_FRAMEWORK_TASKKILL_EXECUTABLE to the drive-rooted absolute path of
the Windows taskkill.exe before starting the framework. For example,
C:\Windows\System32\taskkill.exe on a conventional installation, or
D:\Windows\System32\taskkill.exe on a verified non-C installation.

This is executable configuration, not user input. Do not populate it from
scenario payloads, request parameters, PATH, SystemRoot or WINDIR. The operator
must verify the binary's provenance and that its file, parent directories and
any reparse targets are protected from untrusted writes. The framework checks
path syntax only; it does not verify Windows ACLs or signatures. Administrators
who can change this deployment configuration already control executable selection.

There is deliberately no inferred default or executable search. Missing or
invalid configuration, an unavailable binary, a spawn error or a taskkill timeout
does not prove tree termination. The existing direct-child SIGTERM/SIGKILL
fallback still runs and reports false, even if that child exits, because its
descendants are not confirmed stopped. Successful taskkill still requires the
existing child-exit observation. Arguments (/PID, PID, /T, /F), the 3-second
taskkill timeout and child-exit/fallback deadlines are unchanged.

The regression suite tests resolution and mocked invocation on any host.
A Windows-native validation must additionally exercise an actual owned process
tree on a trusted installation (including a non-C installation if supported by
the deployment). Linux unit tests do not validate Windows process behavior,
filesystem ACLs or reparse-point security.

## Artifact identity and platform scope

Build reviewed artifacts from exact Git blob bytes (LF line endings). A Windows
checkout that converts source files to CRLF is not byte-identical to the reviewed
artifact and must not be treated as satisfying its implementation fingerprint.
The source-text regression tolerates checkout line endings only for its assertion;
this does not normalize or relax implementation approval checks.

The trusted taskkill helper does not broaden the public adapter's platform
contract. Its existing Windows descriptor refusal remains in force. Focused
native helper validation is not public Windows adapter or browser acceptance.
