import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPrinterRepository } from '../infra/repos/in-memory-printer.repo.js';
import { InMemoryJobRepository } from '../infra/repos/in-memory-job.repo.js';
import { InMemoryTraceRepository } from '../infra/repos/in-memory-trace.repo.js';
import { InMemoryAuditRepository } from '../infra/repos/in-memory-audit.repo.js';
import { InMemoryEventBus } from '../infra/eventbus/in-memory-eventbus.js';
import { InMemoryJobQueue } from '../infra/queue/in-memory-queue.js';
import { InMemoryDiscoveredPrinterRepository } from '../infra/repos/in-memory-discovered-printer.repo.js';
import { InMemoryLocationPrinterBindingRepository } from '../infra/repos/in-memory-location-printer-binding.repo.js';
import { AcceptExternalJobService } from '../services/accept-external-job.service.js';
import { DynamicPrintService } from '../services/dynamic-print.service.js';
import { LocationPrinterService, printerIp } from '../services/location-printer.service.js';
import type { ResolvePrinterBindingService } from '../services/resolve-printer-binding.service.js';

let printers: InMemoryPrinterRepository;
let jobs: InMemoryJobRepository;
let locations: LocationPrinterService;
let dynamicPrint: DynamicPrintService;

beforeEach(async () => {
  printers = new InMemoryPrinterRepository();
  jobs = new InMemoryJobRepository();
  const accept = new AcceptExternalJobService(
    jobs, printers, new InMemoryJobQueue(), new InMemoryTraceRepository(), new InMemoryAuditRepository(), new InMemoryEventBus(),
  );
  locations = new LocationPrinterService(new InMemoryLocationPrinterBindingRepository(), printers);
  const noBinding = { resolve: async () => { throw new Error('binding resolver must not be used'); } } as unknown as ResolvePrinterBindingService;
  dynamicPrint = new DynamicPrintService(noBinding, accept, undefined, undefined, undefined, undefined, undefined, locations);
  await printers.create({ code: 'WARD_A_1', name: 'Ward A Zebra', protocol: 'raw_tcp_9100', connectionUri: 'tcp://192.168.10.11:9100', metadata: { driverName: 'ZDesigner ZD421' } });
  await printers.create({ code: 'WARD_A_2', name: 'Ward A Spare', protocol: 'windows_spooler', connectionUri: 'spooler://r1/Spare', metadata: { portName: 'IP_192.168.10.12' } });
});

const submit = (location_code: string, printer_code?: string) =>
  dynamicPrint.submit({ request_id: `r-${Math.random()}`, source_system: 'his', code_template: '', code_profile: '', location_code, printer_code, payload: {} }, 'sa');

describe('location → printer binding', () => {
  it('reads the IP from a tcp URI or a Windows IP_ port name', async () => {
    const all = await printers.findAll();
    expect(all.map(printerIp).sort()).toEqual(['192.168.10.11', '192.168.10.12']);
  });

  it('routes a location_code job to the printer at the bound IP, and fills name/model from it', async () => {
    const binding = await locations.create({ locationCode: 'wardA', printerIp: '192.168.10.11' });
    expect(binding).toMatchObject({ isDefault: true, printerName: 'Ward A Zebra', printerModel: 'ZDesigner ZD421' });

    const res = await submit('wardA', 'SOMETHING_ELSE');
    const job = await jobs.findById(res.print_job_id);
    expect((await printers.findById(job!.printerId))!.code).toBe('WARD_A_1');
  });

  it('switching the default moves the location to the new printer', async () => {
    await locations.create({ locationCode: 'wardA', printerIp: '192.168.10.11' });
    const spare = await locations.create({ locationCode: 'wardA', printerIp: '192.168.10.12', isDefault: true });
    expect((await locations.printerCodeFor('wardA'))).toBe('WARD_A_2');
    const all = await locations['bindings'].findAll({ locationCode: 'wardA' });
    expect(all.filter((b) => b.isDefault).map((b) => b.id)).toEqual([spare.id]);
  });

  it('rejects unknown locations, unregistered IPs, bad IPs and duplicates', async () => {
    await expect(submit('nowhere')).rejects.toMatchObject({ statusCode: 404 });
    await locations.create({ locationCode: 'wardB', printerIp: '10.0.0.99' });
    await expect(submit('wardB')).rejects.toMatchObject({ code: 'LOCATION_PRINTER_NOT_REGISTERED' });
    await expect(locations.create({ locationCode: 'wardB', printerIp: 'not-an-ip' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(locations.create({ locationCode: 'wardB', printerIp: '10.0.0.99' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('lists found printers with their IP: registered first, then discovered-only, one per IP', async () => {
    const discovered = new InMemoryDiscoveredPrinterRepository();
    await discovered.upsert({ runnerId: 'r1', localPrinterName: 'Ward A Zebra (dup)', connectionType: 'tcp_ip', isDefault: false, isShared: false, attributes: { networkAddress: '192.168.10.11' } });
    await discovered.upsert({ runnerId: 'r1', localPrinterName: 'Ward C Epson', driverName: 'EPSON TM-T82', portName: 'IP_192.168.10.30', connectionType: 'tcp_ip', isDefault: false, isShared: false });
    await discovered.upsert({ runnerId: 'r1', localPrinterName: 'USB thing', connectionType: 'usb', isDefault: false, isShared: false, portName: 'USB001' });
    const svc = new LocationPrinterService(new InMemoryLocationPrinterBindingRepository(), printers, discovered);

    expect(await svc.printerOptions()).toEqual(expect.arrayContaining([
      { ip: '192.168.10.11', name: 'Ward A Zebra', model: 'ZDesigner ZD421', printerCode: 'WARD_A_1' },
      { ip: '192.168.10.12', name: 'Ward A Spare', model: undefined, printerCode: 'WARD_A_2' },
      { ip: '192.168.10.30', name: 'Ward C Epson', model: 'EPSON TM-T82', printerCode: null },
    ]));
    expect((await svc.printerOptions()).length).toBe(3);
  });

  it('stores location_code on the job so the result callback can report it', async () => {
    await locations.create({ locationCode: 'wardA', printerIp: '192.168.10.11' });
    const res = await submit('wardA');
    expect((await jobs.findById(res.print_job_id))!.metadata['location_code']).toBe('wardA');
  });

  it('accepts printer_ip or location_code, and printer_ip wins when both are sent', async () => {
    await locations.create({ locationCode: 'wardA', printerIp: '192.168.10.11' });
    const printerOf = async (res: { print_job_id: string }) =>
      (await printers.findById((await jobs.findById(res.print_job_id))!.printerId))!.code;
    const send = (extra: Record<string, string>) =>
      dynamicPrint.submit({ request_id: `r-${Math.random()}`, source_system: 'his', code_template: '', code_profile: '', payload: {}, ...extra }, 'sa');

    expect(await printerOf(await send({ printer_ip: '192.168.10.12' }))).toBe('WARD_A_2');
    expect(await printerOf(await send({ location_code: 'wardA' }))).toBe('WARD_A_1');
    const both = await send({ location_code: 'wardA', printer_ip: '192.168.10.12' });
    expect(await printerOf(both)).toBe('WARD_A_2');
    expect((await jobs.findById(both.print_job_id))!.metadata).toMatchObject({ location_code: 'wardA', printer_ip: '192.168.10.12' });

    await expect(send({ printer_ip: 'nope' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(send({ printer_ip: '10.9.9.9' })).rejects.toMatchObject({ code: 'PRINTER_IP_NOT_REGISTERED' });
  });
});
