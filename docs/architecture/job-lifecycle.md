# Job Lifecycle

```
Client → POST /jobs
         CreatePrintJobService
           → JobRepository.create()     status: PENDING
           → JobQueue.enqueue()         status: QUEUED
           → EventBus.publish(JobCreated, JobQueued)
           → TraceRepository.create()

Runner polls GET /jobs?status=QUEUED
         → POST /jobs/:id/execute (with runnerId)
           → ExecuteJobService
             → JobRepository.update()   status: RUNNING
             → EventBus.publish(JobStarted)
             → AdapterRegistry.getAdapterForPrinter()
             → adapter.executeCommand()

On success:
             → JobRepository.update()   status: SUCCESS
             → TraceRepository.update() (add step)
             → AuditRepository.create()
             → EventBus.publish(JobSucceeded)
             → queue.ack()

On failure:
             → JobRepository.update()   status: FAILED
             → TraceRepository.update() (add step with error)
             → AuditRepository.create()
             → EventBus.publish(JobFailed)
             → queue.nack()
```

## JobStatus State Machine

```
PENDING → QUEUED → RUNNING → SUCCESS
                           → FAILED → RETRYING → RUNNING (loop)
                           → TIMEOUT
              → CANCELLED (from any non-terminal state)
```
