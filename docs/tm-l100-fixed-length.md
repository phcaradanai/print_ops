# TM-L100 cuts after the last printed line

## Confirmed cause on 2026-11-19

The local `printops-cups` queue `epsonTM-L100` uses Epson's `rastertotmtr`
filter, with `TmxPaperReduction=Bottom` and `TmxPaperCut=CutPerJob`.
The supplied PPD also defaults to bottom reduction.

In `cups-epson/driver/filter/TmThermalReceipt.c`, `WriteRaster` finds the last
nonblank raster line. With `Bottom` or `Both`, it omits the feed for the
remaining blank rows before cutting. A correct PDF page height alone therefore
does not preserve the intended label length.

## Preserve the requested page length

In the CUPS queue's default options, set **Paper Reduction → None**
(`TmxPaperReduction=Off`). Keep the intended cut policy. For this local setup:

```powershell
docker exec printops-cups lpadmin -p epsonTM-L100 -o TmxPaperReduction=Off
docker exec printops-cups lpoptions -p epsonTM-L100 -l
```

These commands change defaults; they do not submit a print. This investigation
only read the queue settings; it did not apply the change or print a test label.
Do not edit the vendor filter or add invisible marks to force paper feeding.
Make sure the queue defaults persist in the CUPS configuration volume.

Also verify the job uses the intended custom page size. In this queue the
default is `RP80x200`; PrintOps profile jobs must supply their own page size.

If the physical result still differs after disabling driver reduction, inspect
the printer's own automatic paper reduction and feed/backfeed settings. Epson
documents separate upper/lower space reduction and cutting/feed offsets in the
[TM-L100 Technical Reference Guide](https://download4.epson.biz/sec_pubs/bs/pdf/TM-L100_trg_en_revK.pdf).
Physical cut length remains unverified until a deliberately authorized test is
measured; cutter/head spacing and backfeed can contribute an offset.

## Preview comparison

The editor displays default/sample values. Sandbox payload values can override
them. Compare the same saved profile, companion template, and payload when
checking positions. The local database inspected here did not contain `CHG`. A subsequent authorized read of the HAPY application confirmed that saved `CHG` coordinates match its `CHG_auto` markup. Most profile defaults are empty while the editor displays their labels. The authorized Sandbox payload omits several expected keys, and sends `drug_unit` while the profile expects `unit`. Supply the correct payload/mapping or deliberate static defaults; never convert sample patient labels into production defaults. Live Sandbox also adds 20px padding plus a 1px border around the 80mm sheet, making it about 91.1mm wide; the workspace CSS correction removes this extra page area.
