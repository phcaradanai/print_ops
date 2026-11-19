docker build -t registry.pg.xenex.io/cups:epson-thermal-3.1.0 ./cups-epson
docker push registry.pg.xenex.io/cups:epson-thermal-3.1.0

## Verified delivery for TM printers (escposack backend)

A `socket://host:9100` queue can never be confirmed: CUPS marks the job
completed as soon as the bytes are written, so PrintOps reports UNVERIFIED.
The image ships `escposack://`, a drop-in replacement that appends ESC/POS
`GS ( H` fn48 after the job and completes it only when the printer answers
with this job's process ID. That answer comes after the job has printed.
PrintOps then reports SUCCESS for that CUPS job id.

Point the queue at it (keeps the PPD/filter, changes only the device URI):

    docker exec printops-cups lpadmin -p epsonTM-L100 -v 'escposack://192.168.10.164:9100'

Optional query parameters: `?ack-timeout=25&connect-timeout=10` (seconds).
A job without an acknowledgement is cancelled, never retried, and stays
UNVERIFIED in PrintOps. Check the paper before reprinting it by hand.

Backend tests: `python3 -I cups-epson/backend/test_escposack.py`
