FROM registry.pg.xenex.io/cups:2026-11-09-amd64

USER root
COPY driver/ /opt/epson-driver/

RUN chmod 1777 /tmp \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc libc6-dev libcups2-dev libcupsimage2-dev \
 && gcc -std=gnu99 -O2 \
      /opt/epson-driver/filter/TmThermalReceipt.c \
      -o /usr/lib/cups/filter/rastertotmtr \
      -lcupsimage -lcups \
 && chmod 0755 /usr/lib/cups/filter/rastertotmtr \
 && install -D -m 0644 \
      /opt/epson-driver/ppd/tm-ba-thermal-rastertotmtr-203.ppd \
      /usr/share/cups/model/EPSON/tm-ba-thermal-rastertotmtr-203.ppd

# escposack://host:9100 — like socket:// but a job only completes after the
# printer's ESC/POS process-ID response, so PrintOps can confirm delivery.
COPY backend/escposack /usr/lib/cups/backend/escposack
RUN chmod 0755 /usr/lib/cups/backend/escposack
