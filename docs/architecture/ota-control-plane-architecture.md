# PrintOps Control Plane & OTA Distribution Architecture

```text
                   ┌──────────────────────────┐
                   │ PrintOps Control Plane   │
                   │                          │
                   │ Release Registry         │
                   │ Content Registry         │
                   └───────────┬──────────────┘
                               │
                    WAN / HTTPS│
                               ▼
                  ┌────────────────────────┐
                  │ Artifact Store / CDN   │
                  │                        │
                  │ app-2.4.1              │
                  │ runner-2.4.1           │
                  │ profiles-18            │
                  │ templates-32           │
                  └────────────┬───────────┘
                               │
                ┌──────────────┴───────────────┐
                │                              │
              WAN                           LAN Site
                │                              │
                │                    ┌─────────▼─────────┐
                │                    │ PrintOps Relay     │
                │                    │ Local Update Cache │
                │                    └─────────┬─────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                 ┌──────────────────────────┐
                 │ PrintOps Update Agent    │
                 │                          │
                 │ LAN → WAN resolver       │
                 │ verify signature/hash    │
                 │ download / stage         │
                 │ idle detection           │
                 │ install / rollback       │
                 └────────────┬─────────────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
          PrintOps App                   Runner
                │
                ▼
        Profile / Template DB
```
