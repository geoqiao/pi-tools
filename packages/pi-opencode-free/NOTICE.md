# Implementation references

The request compatibility design was informed by:

- [apmantza/pi-free](https://github.com/apmantza/pi-free), commit
  `364f36613610ccc070900cdc03e4fa700a301e2b`, MIT.
  In particular, `providers/opencode-session.ts` and
  [issue #544](https://github.com/apmantza/pi-free/issues/544).
- [OpenCode](https://github.com/anomalyco/opencode/tree/v1.18.32), v1.18.32:
  request identity, Zen catalog handling, and provider metadata selection.
- Pi's native provider, streaming, compaction, and RPC documentation.

The package does not bundle either project's implementation. It uses Pi's
host-provided protocol adapters and independently implemented catalog/cache and
request-compatibility code.

Upstream policy and compatibility evidence:

- [Official free-tier restriction](https://github.com/anomalyco/opencode/issues/49621#issuecomment-5723383322)
- [Official compaction misclassification and fix](https://github.com/anomalyco/opencode/issues/49610)
- [Community investigation](https://github.com/can1357/oh-my-pi/issues/12306)

Community measurements are snapshots with different endpoints, credentials, and
models, not a documented or predictable server-side change schedule.
