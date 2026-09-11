# Adapter System

## PrinterAdapterPort

All printer communication goes through `PrinterAdapterPort`:

```typescript
interface PrinterAdapterPort {
  protocol: string;
  adapterName: string;
  detect(uri): Promise<boolean>
  getStatus(uri): Promise<PrinterStatus>
  getCapabilities(uri): Promise<PrinterCapability>
  executeCommand(cmd): Promise<PrinterAdapterResult>
  printTestPage(uri, printerId): Promise<PrinterAdapterResult>
  listQueue(uri): Promise<QueueEntry[]>
  cancelJob(uri, jobId): Promise<PrinterAdapterResult>
}
```

## AdapterRegistry

```typescript
registry.registerAdapter(new FakePrinterAdapter())
registry.getAdapterForPrinter(printer)  // matches printer.protocol
registry.listAdapters()
```

## Available Adapters

| Adapter | Protocol | Status |
|---------|----------|--------|
| FakePrinterAdapter | fake | ✅ MVP – full simulation |
| IppPrinterAdapter | ipp | 🔲 Placeholder |
| SnmpPrinterStatusAdapter | snmp | 🔲 Placeholder |
| CupsPrinterAdapter | cups | 🔲 Placeholder |
| WindowsSpoolerAdapter | windows_spooler | 🔲 Placeholder |

## Adding a New Adapter

1. Implement `PrinterAdapterPort` in `packages/adapters/src/<protocol>/`
2. Export from `packages/adapters/src/index.ts`
3. Register in `apps/api/src/app.ts`: `registry.registerAdapter(new MyAdapter())`
