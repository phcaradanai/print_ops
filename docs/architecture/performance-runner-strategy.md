# Performance Runner Strategy

## Objective

Establish a baseline for PrintOps runner performance and define the metrics that matter for production.

## Metrics Collected by Go Runner

| Metric | Unit | Source | Purpose |
|---|---|---|---|
| `job_pickup_latency_ms` | ms | jobs loop | Time from poll start to job received |
| `runner_exec_ms` | ms | executor | Pure execution time (fake or real) |
| `result_report_ms` | ms | jobs loop | Time to POST result to API |
| `discovery_duration_ms` | ms | discovery loop | Full discovery + parse + sync |
| `api_roundtrip_ms` | ms | api client | Generic HTTP roundtrip |
| `heartbeat_roundtrip_ms` | ms | heartbeat loop | Heartbeat HTTP roundtrip |

All metrics are tracked in `internal/telemetry.Metrics` with rolling averages and latest values, emitted to structured logs.

## How to Measure

### 1. Create a Job

```bash
# Create a print job via API
curl -X POST http://localhost:3001/api/v1/jobs \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "printer_code": "LAB_LABEL_01",
    "payload": "SGVsbG8gV29ybGQ=",
    "copies": 1,
    "priority": 5
  }'
```

### 2. Watch Runner Logs

```bash
# Run Go runner with debug logging
PRINTOPS_LOG_LEVEL=debug go run ./cmd/printops-runner run

# Logs will show:
# {"level":"info","msg":"job received","job_id":"...","trace_id":"...","pickup_latency_ms":12}
# {"level":"info","msg":"execution complete","job_id":"...","exec_ms":150}
# {"level":"info","msg":"result reported","job_id":"...","report_ms":45}
```

### 3. Check API Trace Events

Query the API for a job's trace events:

```bash
curl http://localhost:3001/api/v1/jobs/<jobId>/events \
  -H "Authorization: Bearer <token>"
```

This returns all events with timestamps, allowing end-to-end latency calculation:
- `job_received_at - created_at` = queue latency
- `execution_finished_at - execution_started_at` = exec latency
- `result_reported_at - execution_finished_at` = report latency

### 4. Compare TypeScript vs Go Runner — no longer applicable

> **Obsolete section (2026-08-03).** This comparison decided the question it
> was written for: the Go runner won and the TypeScript runner was deleted.
> There is nothing left to compare, and `cd apps/runner && npm run dev` no
> longer resolves. Kept for the reasoning, not as an instruction.

To measure the Go runner on its own:

```bash
cd apps/runner-go && go run ./cmd/printops-runner run

# Create batches of 10, 50, 100 jobs and record:
# - Memory usage (Task Manager / Activity Monitor)
# - Startup time (time to first heartbeat)
# - Job throughput (jobs/min)
# - Average exec latency
```

Note that in the packaged desktop the Go runner does **not** execute jobs at
all — it is discovery and heartbeat only, and the API's in-process worker is the
sole executor. Job-throughput figures for the runner therefore describe a
deployment shape that is currently deferred.

## Expected Baselines (MVP, Fake Mode)

| Metric | Go Runner (expected) | TypeScript Runner (expected) |
|---|---|---|
| Memory | 10-20 MB | 50-100 MB |
| Startup | <100 ms | 1-2 s |
| Job pickup latency | 5-20 ms | 10-50 ms |
| Fake exec latency | ~100 ms (configurable) | ~100 ms (configurable) |
| Result report | 10-30 ms | 20-60 ms |
| Heartbeat roundtrip | 5-15 ms | 10-30 ms |

These are approximate dev-environment values. Production numbers depend on network, printer hardware, and API load.

## Benchmarking Guidelines

1. **Always use fake mode** for controlled benchmarks (no printer variability)
2. **Run 100+ jobs** to get stable averages
3. **Measure cold start** separately from steady state
4. **Log to file** to avoid console I/O skewing results
5. **Isolate network** — run API and runner on the same machine for baseline, then measure network overhead separately

## Future: Prometheus + OpenTelemetry

The current metrics are log-based. Future work:
- Prometheus `/metrics` endpoint on the runner
- OpenTelemetry trace spans exported to Jaeger/Tempo
- Grafana dashboards for runner fleet

See [next-steps.md](../status/next-steps.md).