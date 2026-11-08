# Login inspection cancellation and deadline coverage

The cancellation case runs in its own Node test worker. It pauses Node work
timeouts and `Date.now` while a real matched browser navigates and sends an
admitted request to a held loopback response. It establishes that transport drain
is pending before requesting cancellation and requires the exact `interrupted`
classification, incomplete-transport evidence, and browser disconnection.

Native clocks are restored before the requested cancellation and cleanup.
On early failure, restoration transfers pending timers to native scheduling with
elapsed real time deducted, so a paused cleanup timer cannot wait indefinitely.
A separately captured five-second real preparation watchdog makes stalled
preparation fail; watchdog-triggered cancellation cannot satisfy the test.
Cleanup retains the production five-second budget. The bounded virtual clock
rejects unsupported timer operations and requires all owned timers to be cleared.

This test does **not** prove that browser startup through cancellation completes
within one wall-clock second. The separate real-clock deadline case retains the
one-second whole-lifecycle budget and existing cleanup assertion. Controlled
resource cases additionally prove cancellation-first classification and
acquisition-deadline-first classification, consumer non-entry and closure of a
late owned browser. Test files run sequentially; the clock cannot affect other
workers or the real-clock case.

The earlier real-clock cancellation failure remains unexplained: a timeout was
reported before the test could establish the intended cancellation outcome.
Later passing diagnostics did not establish its historical ordering or cause.
No production timeout, classification or cleanup contract changes are made here.
