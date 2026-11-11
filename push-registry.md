# Web Control 1.0.5

Published for `linux/amd64` from app release `0.1.39`, commit
`128d74461e4d6aa3f3c4995c63d9cd64267451ea`.

[Successful GitHub Actions publish](https://github.com/phcaradanai/print_ops/actions/runs/42981313244)

| Image | Published digest |
| --- | --- |
| `registry.pg.xenex.io/printops-control-plane-api:1.0.5` | `sha256:a1273c0ec0ea9240b323916c9f3cf3fb5ce101ea9822115bf2918e372feb5034` |
| `registry.pg.xenex.io/printops-control-plane-web:1.0.5` | `sha256:959cf03281105e98e88ec9129bbb0d78c724e9fe42e53ba2192ada8d990df273` |

Manual publish from a Docker build host:

```powershell
$env:PRINTOPS_IMAGE_PREFIX = "registry.pg.xenex.io/printops-control-plane"
$env:PRINTOPS_CONTROL_PLANE_VERSION = "1.0.5"
node scripts/publish-control-plane-images.mjs
```
