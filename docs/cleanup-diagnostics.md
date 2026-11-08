# Opt-in cleanup diagnostics

The existing `executeOwnedLocalAdapter` API and strict v2 result schema are
unchanged. `executeOwnedLocalAdapterWithDiagnostics`, exported from the same public
`@universal/playwright-framework/adapter/v2` entry, accepts the same arguments and
performs one execution. It returns a separate envelope:

```ts
{
  diagnosticsVersion: 1,
  result: OwnedLocalResult,
  cleanupDiagnostics: [{
    attemptNumber: 1,
    scenarioId: "local-demo-navigation",
    phase: "context-close" | "browser-close",
    category: "playwright-timeout" | "unclassified"
  }]
}
```

Pass the nested `result` to existing v2 consumers. The envelope itself is a
separate contract; `validateOwnedLocalDiagnosticEnvelope(request, envelope)`
checks its version, strict fields, result, phase uniqueness and correspondence to
that scenario's failure codes. At most two entries are retained. Rejected runs
and scenarios without business evidence have no diagnostic entries. The existing
v1 API does not expose the new diagnostics.

`playwright-timeout` denotes recognition of the public Playwright `TimeoutError`
identity, not a root cause. All other identities, including errors whose identity
cannot safely be inspected, are `unclassified`. Error names, messages, stacks,
causes, URLs and payloads are never copied into these diagnostics. The hooks keep
their existing fixed sanitized errors and failure precedence.

The array is not an event timeline and establishes no disconnect or process-exit
ordering. Missing entries do not imply successful cleanup. Categories never
change business status, operational failure, cleanup confirmation, retries or
execution budgets. In particular this diagnostic does not explain or fix a
historical context-close rejection that has not reproduced.
