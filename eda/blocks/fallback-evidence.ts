import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createElement as e } from 'react';
import { RootCircuit } from 'tscircuit';
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
import { ensurePart } from './imported';
import { loadCatalogReceipt } from '../../src/blocks/catalog';
import { nativeNetlistIssues } from '../../src/blocks/native-netlist';
import { toolVersions } from '../versions';
import type { BlockPart, CatalogPart } from '../../src/blocks/contract';

const OFFICIAL =
  'https://raw.githubusercontent.com/KiCad/kicad-footprints/master/Resistor_SMD.pretty/R_0603_1608Metric.kicad_mod';
const CAPTURED_SHA = 'effcae403a15810b3a1947b8664576270d6781e7cd525e97c47d48be0fdae8ce';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );

/** Bounded engineering fixture. No owner-device, assembly-fit, MCU or 3D-model claim. */
export async function fallbackEvidence(
  directory = 'docs/engineering/2026-11-05-chip-level/evidence/chip_eda/fallback',
) {
  const output = resolve(directory),
    started = performance.now(),
    stages: any[] = [];
  await mkdir(output, { recursive: true });
  const save = (name: string, value: any) =>
    writeFile(
      resolve(output, name),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
    );
  const stage = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      const result = await run();
      stages.push({ name, status: 'done', ms: performance.now() - start });
      await save('progress.json', stages);
      return result;
    } catch (error) {
      stages.push({ name, status: 'failed', ms: performance.now() - start, error: String(error) });
      await save('progress.json', stages);
      throw error;
    }
  };
  try {
    const catalogs = JSON.parse(
      await readFile(resolve('src/blocks/data/parts.json'), 'utf8'),
    ) as CatalogPart[];
    const resistor = catalogs.find((p) => p.lcsc === 'C25804'),
      connector = catalogs.find((p) => p.lcsc === 'C160404');
    if (resistor?.mpn !== '0603WAF1002T5E' || connector?.mpn !== 'SM04B-SRSS-TB(LF)(SN)')
      throw new Error('Actual retained supplier identities differ from the bounded fixture');
    const capturedTest = await readFile(resolve('tests/blocks-footprint.test.ts'), 'utf8');
    const literal = capturedTest.match(/^const KICAD_SOURCE = ("[^\n]*");$/m);
    if (!literal) throw new Error('Retained official KiCad footprint literal is missing');
    const captured: string = JSON.parse(literal[1]!);
    if (sha(captured) !== CAPTURED_SHA)
      throw new Error('Retained official KiCad source changed: review before running native evidence');
    await save('R_0603_1608Metric.kicad_mod', captured);
    await save('kicad-source-receipt.json', {
      mode: 'offline-captured-official-source',
      sourceUrl: OFFICIAL,
      sourceSha256: CAPTURED_SHA,
      capturedAt: '2026-11-05',
      fixture: 'tests/blocks-footprint.test.ts#KICAD_SOURCE',
      fixtureFileSha256: sha(capturedTest),
      fetchedThisRun: false,
      note: 'Exact first-party bytes retained by the existing test fixture; injected fetch supplies only these bytes to ensurePart. No fresh upstream request or stock claim.',
    });
    await mkdir(resolve(output, 'receipts'), { recursive: true });
    for (const c of [resistor, connector])
      for (const id of [c.catalogReceipt, c.datasheetReceipt].filter(Boolean) as string[]) {
        const receipt = await loadCatalogReceipt(id);
        await save(`receipts/${id.slice(7)}.json`, receipt);
      }
    await save('catalog.json', [resistor, connector]);
    const r = (ref: string, source: 'footprinter' | 'kicad', x: number): BlockPart => ({
      ref,
      lcsc: resistor.lcsc,
      mpn: resistor.mpn,
      catalogReceipt: resistor.catalogReceipt,
      pinout: 'verified',
      value: '10kOhm',
      datasheet: {
        url: resistor.datasheetUrl!,
        pages: '1',
        note: 'Actual supplier identity:0603WAF1002T5E/C25804, two numeric resistor terminals. This fixture verifies native pin correspondence; alternate land-pattern fit is separately unqualified.',
      },
      pins: { A: { pad: '1', role: 'passive' }, B: { pad: '2', role: 'passive' } },
      at: { x, y: -3, rotation: 0 },
      footprint:
        source === 'footprinter'
          ? {
              source,
              id: '0603',
              citation: {
                url: resistor.datasheetUrl!,
                pages: '1',
                note: 'Explicit standard0603 fallback for the real supplier identity; package/land-pattern manufacturing qualification remains open.',
              },
            }
          : {
              source,
              id: 'kicad:Resistor_SMD/R_0603_1608Metric',
              citation: {
                url: OFFICIAL,
                sha256: CAPTURED_SHA,
                pages: 'unpaginated official footprint source',
                note: 'Exact captured first-party KiCad bytes, offline cache. Native render/route/pad evidence is this fixture; standard package fit remains unqualified.',
              },
            },
    });
    const parts: BlockPart[] = [
      r('R1', 'footprinter', -4),
      r('R2', 'kicad', 4),
      {
        ref: 'J1',
        lcsc: connector.lcsc,
        mpn: connector.mpn,
        catalogReceipt: connector.catalogReceipt,
        pinout: 'verified',
        datasheet: {
          url: 'https://www.jst-mfg.com/product/pdf/eng/eSH.pdf',
          pages: '1–3',
          note: 'Actual4-contact SH connector plus2 mounting tabs; fixture assignment1=GND/2=3.3V is not a universal cable pinout.',
        },
        pins: Object.fromEntries(
          connector.pins.map((p) => [
            `P${p.pad}`,
            { pad: p.pad, role: ['5', '6'].includes(p.pad) ? ('nc' as const) : ('passive' as const) },
          ]),
        ),
        at: { x: 0, y: 5, rotation: 180 },
      },
    ];
    const imports = new Map<string, any>();
    let offlineCalls = 0;
    await stage('ensure-pinned-footprints', async () => {
      for (const p of parts) {
        const result = await ensurePart(p, p.ref === 'J1' ? connector : resistor, {
          cacheDir: output,
          assetDir: resolve(output, 'assets'),
          fetch: (async (input) => {
            offlineCalls++;
            if (String(input) !== OFFICIAL) throw new Error('Unexpected fallback fetch');
            return new Response(captured, { status: 200, headers: { 'content-type': 'text/plain' } });
          }) as typeof fetch,
        });
        if (
          p.ref !== 'J1' &&
          (result.raw !== null ||
            (result as any).modelsProvided !== false ||
            result.component({}).props.cadModel !== undefined)
        )
          throw new Error('Fallback unexpectedly claims an imported model');
        imports.set(p.ref, result);
      }
    });
    const kicad = imports.get('R2');
    if (
      kicad.sourceSha256 !== CAPTURED_SHA ||
      kicad.sourceUrl !== OFFICIAL ||
      !['fetch', 'source-cache', 'audit-cache'].includes(kicad.sourceCacheMode) ||
      offlineCalls !== (kicad.sourceCacheMode === 'fetch' ? 1 : 0)
    )
      throw new Error('Expected verified pinned KiCad source fetch or zero-request cache reuse');
    const nets = [
      {
        name: 'V3V3',
        pins: [
          { ref: 'J1', logical: 'P2', pad: '2' },
          { ref: 'R1', logical: 'A', pad: '1' },
          { ref: 'R2', logical: 'A', pad: '1' },
        ],
      },
      {
        name: 'GND',
        pins: [
          { ref: 'J1', logical: 'P1', pad: '1' },
          { ref: 'R1', logical: 'B', pad: '2' },
          { ref: 'R2', logical: 'B', pad: '2' },
        ],
      },
    ];
    await save('input.json', {
      fixture: 'engineering-only-fallback-native-smoke',
      board: { widthMm: 30, heightMm: 25, layers: 2 },
      parts,
      nets,
      externalSupplyAssumption:
        '3.3V/GND at J1 contacts2/1; unpowered engineering fixture, no actual battery/regulator or owner-device function implied',
    });
    const nodes: any[] = parts.map((p) =>
      imports.get(p.ref).component({ name: p.ref, pcbX: p.at.x, pcbY: p.at.y, pcbRotation: p.at.rotation }),
    );
    for (const n of nets) {
      nodes.push(e('net', { name: n.name }));
      for (const pin of n.pins)
        nodes.push(
          e('trace', {
            from: `.${pin.ref} > .${imports.get(pin.ref).pins.get(pin.pad)}`,
            to: `net.${n.name}`,
            thickness: 0.2,
          }),
        );
    }
    const circuit = new RootCircuit();
    await stage('native-render', async () => {
      circuit.add(
        e(
          'board',
          {
            width: 30,
            height: 25,
            layers: 2,
            schematicDisabled: true,
            minTraceWidth: 0.15,
            minTraceToPadEdgeClearance: 0.127,
            minPadEdgeToPadEdgeClearance: 0.127,
            minViaEdgeToPadEdgeClearance: 0.127,
            minViaHoleDiameter: 0.3,
            minViaPadDiameter: 0.6,
            pcbStyle: { viaHoleDiameter: 0.3, viaPadDiameter: 0.6 },
            autorouter: { preset: 'auto' },
          },
          ...nodes,
        ),
      );
      circuit.render();
    });
    await stage('native-route', () => circuit.renderUntilSettled());
    const cj: any[] = circuit.getCircuitJson();
    await save('circuit.json', cj);
    const mapping = Object.fromEntries(
      parts.map((p) => [p.ref, Object.fromEntries(imports.get(p.ref).pins)]),
    );
    const netlistIssues = nativeNetlistIssues(
      { parts: parts.map((part) => ({ ref: part.ref, part })), nets } as any,
      cj,
      mapping,
    );
    const padIssues: string[] = [],
      actualPads: any[] = [];
    for (const p of parts) {
      const sources = cj.filter((x) => x.type === 'source_component' && x.name === p.ref),
        source = sources[0];
      if (
        sources.length !== 1 ||
        source.manufacturer_part_number !== p.mpn ||
        !source.supplier_part_numbers?.jlcpcb?.includes(p.lcsc)
      ) {
        padIssues.push(`${p.ref}: actual native supplier/MPN mismatch`);
        continue;
      }
      const components = cj.filter(
          (x) => x.type === 'pcb_component' && x.source_component_id === source.source_component_id,
        ),
        pcb = components[0];
      if (components.length !== 1) {
        padIssues.push(`${p.ref}: missing/ambiguous native placement`);
        continue;
      }
      const pads = cj.filter(
        (x) =>
          ['pcb_smtpad', 'pcb_plated_hole'].includes(x.type) && x.pcb_component_id === pcb.pcb_component_id,
      );
      if (pads.length !== Object.keys(p.pins).length)
        padIssues.push(`${p.ref}: native pad count differs from exact physical pin map`);
      for (const [logical, pin] of Object.entries(p.pins)) {
        const native = mapping[p.ref][pin.pad],
          found = pads.filter((x) => x.port_hints?.includes(native));
        if (found.length !== 1) {
          padIssues.push(`${p.ref}.${pin.pad}: missing/ambiguous actual numeric native pad`);
          continue;
        }
        const pad = found[0],
          port = cj.find((x) => x.type === 'pcb_port' && x.pcb_port_id === pad.pcb_port_id),
          sourcePort = cj.find((x) => x.type === 'source_port' && x.source_port_id === port?.source_port_id);
        if (
          !sourcePort ||
          sourcePort.source_component_id !== source.source_component_id ||
          sourcePort.pin_number !== Number(pin.pad)
        )
          padIssues.push(`${p.ref}.${pin.pad}: pad/source-port physical number differs`);
        if (
          p.ref !== 'J1' &&
          (!['rect', 'rotated_rect'].includes(pad.shape) ||
            ![pad.x, pad.y, pad.width, pad.height].every(Number.isFinite) ||
            pad.width <= 0 ||
            pad.height <= 0)
        )
          padIssues.push(`${p.ref}.${pin.pad}: invalid actual fallback pad geometry`);
        actualPads.push({ ref: p.ref, logical, physicalPad: pin.pad, native, sourcePort, pad });
      }
    }
    const nativeErrors = cj
      .filter((x) => x.type.endsWith('_error'))
      .map((x) => ({ type: x.type, message: String(x.message ?? x.error_type ?? x.type) }));
    const nativeWarnings = cj
      .filter((x) => x.type.endsWith('_warning'))
      .map((x) => ({ type: x.type, message: String(x.message ?? x.type) }));
    const fallback = parts
      .filter((p) => p.ref !== 'J1')
      .map((p) => {
        const r = imports.get(p.ref);
        return {
          ref: p.ref,
          lcsc: p.lcsc,
          mpn: p.mpn,
          catalogReceipt: p.catalogReceipt,
          footprintSource: r.footprintSource,
          footprintId: r.footprintId,
          resolvedFootprintSha256: r.resolvedFootprintSha256,
          sourceSha256: r.sourceSha256 ?? null,
          sourceUrl: r.sourceUrl ?? null,
          sourceCacheMode: r.sourceCacheMode ?? null,
          modelsProvided: r.modelsProvided,
          footprintAuditPath: relative(output, r.footprintAuditPath),
          requestedMapping: Object.fromEntries(r.pins),
        };
      });
    await save('import-map.json', {
      parts: [
        ...fallback,
        {
          ref: 'J1',
          lcsc: connector.lcsc,
          mpn: connector.mpn,
          catalogReceipt: connector.catalogReceipt,
          footprintSource: 'jlcpcb',
          footprintSha256: connector.footprintSha256,
          requestedMapping: mapping.J1,
        },
      ],
    });
    await save('pad-attestation.json', {
      ok: !padIssues.length && !netlistIssues.length,
      issues: padIssues,
      netlistIssues,
      pads: actualPads,
    });
    await save('drc.json', {
      checked: true,
      engine: 'native RootCircuit renderUntilSettled',
      errors: nativeErrors,
      warnings: nativeWarnings,
    });
    await save('pcb.svg', convertCircuitJsonToPcbSvg(cj));
    const csv = (s: unknown) => `"${String(s ?? '').replaceAll('"', '""')}"`;
    await save(
      'bom.csv',
      [
        'Manufacturer Part Number,Designator,Footprint,LCSC Part #,Review status',
        ...parts.map((p) =>
          [p.mpn, p.ref, p.footprint?.id ?? p.lcsc, p.lcsc, 'unreviewed-engineering-fixture']
            .map(csv)
            .join(','),
        ),
      ].join('\n') + '\n',
    );
    const traceCount = cj.filter((x) => x.type === 'pcb_trace').length;
    const generatorPath = import.meta.resolve('@tscircuit/footprinter');
    const receipt = {
      ok: !nativeErrors.length && !padIssues.length && !netlistIssues.length && traceCount > 0,
      scope: 'native-render-route-numeric-pad-netlist-evidence; engineering fixture only',
      stages,
      totalMs: performance.now() - started,
      native: {
        checked: true,
        drcErrors: nativeErrors,
        padIssues,
        netlistIssues,
        traceCount,
        viaCount: cj.filter((x) => x.type === 'pcb_via').length,
      },
      fallback,
      sourceMode: 'offline-captured-official-KiCad-bytes',
      officialSourceSha256: CAPTURED_SHA,
      offlineSourceRequests: offlineCalls,
      toolVersions: await toolVersions(),
      scriptSha256: sha(await readFile(new URL('./fallback-evidence.ts', import.meta.url))),
      importerAdapterSha256: sha(await readFile(new URL('./imported.ts', import.meta.url))),
      footprinterGeneratorModuleSha256: sha(
        await readFile(generatorPath.startsWith('file:') ? new URL(generatorPath) : generatorPath),
      ),
      sourceGeometry: 'fallback footprint arrays were passed to native RootCircuit chip components',
      importedFallback3DModels: false,
      compileClaim: false,
      physicalBuild: false,
      manufacturingFitQualified: false,
      limitations: [
        'Standard0603/KiCad land pattern was not qualified against purchasedC25804 terminal tolerances or solder process.',
        'No fresh KiCad source/stock/purchasing check; captured immutable source used explicitly offline.',
        'No MCU compile, owner-device behavior, imported fallback3D alignment or manufactured-board claim.',
      ],
    };
    await save('receipt.json', receipt);
    return receipt;
  } catch (error) {
    const failure = {
      ok: false,
      stages,
      totalMs: performance.now() - started,
      error: String(error),
      nativeSuccessClaim: false,
    };
    await save('failure.json', failure);
    return failure;
  }
}

if (import.meta.main) {
  const receipt = await fallbackEvidence(process.argv[2]);
  console.log(JSON.stringify(receipt));
  if (!receipt.ok) process.exitCode = 2;
}
