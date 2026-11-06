import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRpClockPhase } from '../eda/blocks/rp-clock.js';
import { createRpEscapePhase } from '../eda/blocks/rp-escape.js';
import { createRpSignalEscapeProposals } from '../eda/blocks/rp-signal-escape.js';
const root = new URL(
    '../docs/engineering/2026-11-06-chip-live/evidence/chip_eda/rp-routing-robust/',
    import.meta.url,
  ),
  read = (n: string) => JSON.parse(readFileSync(new URL(n, root), 'utf8')),
  fixture = () => read('rp-signal-escape-fixture.json');
function rotate(f: any) {
  const turn = (p: any) => {
    const x = p.x;
    p.x = -p.y;
    p.y = x;
  };
  for (const p of f.graph.parts) {
    turn(p.at);
    p.at.rotation = (p.at.rotation ?? 0) + 90;
  }
  for (const e of f.circuit) {
    if (Number.isFinite(e.x) && Number.isFinite(e.y)) turn(e);
    for (const field of ['center', 'footprint_origin']) if (e[field]) turn(e[field]);
    if (e.type === 'pcb_component') e.rotation += 90;
    if (e.type === 'pcb_smtpad' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
    if (e.shape?.startsWith('rotated_')) e.ccw_rotation = (e.ccw_rotation ?? 0) + 90;
    if (e.type === 'pcb_plated_hole') {
      e.rect_ccw_rotation = (e.rect_ccw_rotation ?? 0) + 90;
      e.hole_ccw_rotation = (e.hole_ccw_rotation ?? 0) + 90;
    }
    for (const field of ['points', 'outline']) if (Array.isArray(e[field])) for (const p of e[field]) turn(p);
    if (e.type === 'pcb_board') [e.width, e.height] = [e.height, e.width];
    if (e.type === 'pcb_keepout' && ['rect', 'pill', 'oval'].includes(e.shape))
      [e.width, e.height] = [e.height, e.width];
  }
}
const run = (f: any) => {
  const clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    power = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { applicationVias: true }),
    signals = createRpSignalEscapeProposals(
      f.circuit,
      f.graph,
      f.mapping,
      clock,
      power,
      new Set(power.netNames),
    );
  return { clock, power, signals };
};
test('finite connected GPIO17/18 inward vias pass actual native geometry on2/4layers and all cardinal orientations', () => {
  for (const layers of [2, 4])
    for (const turns of [0, 1, 2, 3]) {
      const f = fixture();
      f.circuit.find((e: any) => e.type === 'pcb_board').num_layers = layers;
      for (let i = 0; i < turns; i++) rotate(f);
      const before = structuredClone(f),
        r = run(f),
        apps = r.power.audit.filter((p) => p.kind === 'application-gpio');
      assert.deepEqual(f, before);
      assert.equal(r.power.audit.length, 16);
      assert.equal(r.signals.audit.length, 10);
      assert.deepEqual(
        apps.map((p) => p.pad),
        ['17', '18'],
      );
      assert.equal(r.power.scope, 'finite-rp2040-power-ground-application-native-escapes');
      assert.ok(r.power.netNames.includes('IN1') && r.power.netNames.includes('IN2'));
      for (const p of apps) {
        assert.equal(p.route.length, 4);
        assert.ok(
          p.route.slice(0, -1).every((p) => p.route_type === 'wire' && p.width === 0.15 && p.layer === 'top'),
        );
        const v = p.route.at(-1)!;
        assert.equal(v.route_type, 'via');
        if (v.route_type === 'via') {
          assert.equal(v.via_diameter, 0.6);
          assert.equal(v.via_hole_diameter, 0.3);
          assert.equal(v.from_layer, 'top');
          assert.equal(v.to_layer, 'bottom');
        }
        assert.ok(!r.signals.audit.some((a) => a.pad === p.pad), 'Application pin is handed off once');
      }
      assert.ok(
        Math.abs(
          Math.hypot(apps[0]!.via.x - apps[1]!.via.x, apps[0]!.via.y - apps[1]!.via.y) - Math.hypot(0.7, 0.4),
        ) < 1e-7,
      );
    }
});
test('default14prefix API remains unchanged and actual55x40 native90degree placement also validates16', () => {
  const f = fixture(),
    clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    plain = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock);
  assert.equal(plain.audit.length, 14);
  assert.equal(plain.scope, 'finite-rp2040-power-ground-native-escapes');
  assert.deepEqual(
    createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, { applicationVias: false }),
    plain,
  );
  const dir = 'actual-e7a97ca9/',
    raw = read(dir + 'pre-pour-circuit.json'),
    actual = {
      circuit: raw.filter(
        (e: any) => !['pcb_trace', 'pcb_via', 'pcb_copper_pour'].includes(e.type) && !e.error_type,
      ),
      graph: read(dir + 'plan-graph.json'),
      mapping: Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    },
    result = run(actual);
  assert.equal(result.power.audit.length, 16);
  assert.equal(result.signals.audit.length, 10);
});
function disconnect(f: any, pad: string) {
  const mcu = f.graph.parts.find((p: any) => p.part.lcsc === 'C2040'),
    owner = f.circuit.find((e: any) => e.type === 'source_component' && e.name === mcu.ref),
    port = f.circuit.find(
      (e: any) =>
        e.type === 'source_port' &&
        e.source_component_id === owner.source_component_id &&
        e.pin_number === Number(pad),
    );
  for (const net of f.graph.nets)
    net.pins = net.pins.filter((p: any) => !(p.ref === mcu.ref && p.pad === pad));
  f.circuit = f.circuit.filter(
    (e: any) => e.type !== 'source_trace' || !e.connected_source_port_ids.includes(port.source_port_id),
  );
  delete port.subcircuit_connectivity_map_key;
}
test('only connected application pins receive vias; unsupported aliases, roles and counterfeit optional prefix ownership reject', () => {
  for (const pads of [['17'], ['17', '18']]) {
    const f = fixture();
    for (const pad of pads) disconnect(f, pad);
    const r = run(f);
    assert.equal(r.power.audit.length, 16 - pads.length);
    for (const pad of pads) assert.ok(!r.power.audit.some((p) => p.pad === pad));
  }
  const alias = fixture();
  alias.mapping.U1['17'] = 'unregistered17';
  assert.throws(() => run(alias), /source|alias|mapping|map|port/i);
  const role = fixture();
  role.graph.parts.find((p: any) => p.part.lcsc === 'C2040').part.pins['17'].role = 'ground';
  assert.throws(() => run(role), /source|role|net/i);
  const f = fixture(),
    r = run(f),
    bad = structuredClone(r.power);
  bad.audit.find((p) => p.pad === '17')!.pad = '20';
  assert.throws(
    () => createRpSignalEscapeProposals(f.circuit, f.graph, f.mapping, r.clock, bad, new Set(bad.netNames)),
    /complete distinct/,
  );
  const wrongNet = structuredClone(r.power);
  wrongNet.audit.find((p) => p.pad === '17')!.netName = 'V3V3';
  assert.throws(
    () =>
      createRpSignalEscapeProposals(
        f.circuit,
        f.graph,
        f.mapping,
        r.clock,
        wrongNet,
        new Set(wrongNet.netNames),
      ),
    /named net|source\/port/,
  );
});
test('foreign clock copper and same-net SMD copper at a proposed via remain hard geometry failures', () => {
  const f = fixture(),
    r = run(f),
    application = r.power.audit.find((p) => p.pad === '17')!,
    foreignClock = structuredClone(r.clock);
  foreignClock.audit[0]!.route.splice(1, 0, {
    ...foreignClock.audit[0]!.route[0]!,
    x: application.via.x,
    y: application.via.y,
  });
  assert.throws(
    () => createRpEscapePhase(f.circuit, f.graph, f.mapping, foreignClock, { applicationVias: true }),
    /native geometry/,
  );
  const blocked = fixture(),
    ownPad = blocked.circuit.find(
      (e: any) => e.type === 'pcb_smtpad' && e.pcb_port_id === application.diagnosticPcbPortId,
    );
  blocked.circuit.push({
    ...structuredClone(ownPad),
    pcb_smtpad_id: 'DERIVED_SAME_NET_PAD_AT_INWARD_VIA',
    x: application.via.x,
    y: application.via.y,
    width: 0.4,
    height: 0.4,
  });
  const clock = createRpClockPhase(blocked.circuit, blocked.graph, blocked.mapping);
  assert.throws(
    () =>
      createRpEscapePhase(blocked.circuit, blocked.graph, blocked.mapping, clock, { applicationVias: true }),
    /native geometry|Via hole|SMD/,
  );
});

const coupled = (f: any) => {
  const clock = createRpClockPhase(f.circuit, f.graph, f.mapping),
    power = createRpEscapePhase(f.circuit, f.graph, f.mapping, clock, {
      applicationVias: true,
      usbVias: true,
    }),
    signals = createRpSignalEscapeProposals(
      f.circuit,
      f.graph,
      f.mapping,
      clock,
      power,
      new Set(power.netNames),
    );
  return { clock, power, signals };
};
test('coupled USB/power profile validates18 escapes plus8 signals on actual2/4layer cardinal geometry', () => {
  for (const layers of [2, 4])
    for (const turns of [0, 1, 2, 3]) {
      const f = fixture();
      f.circuit.find((e: any) => e.type === 'pcb_board').num_layers = layers;
      for (let i = 0; i < turns; i++) rotate(f);
      const before = structuredClone(f),
        r = coupled(f),
        usb = r.power.audit.filter((p) => p.kind === 'usb-signal');
      assert.deepEqual(f, before);
      assert.equal(r.power.audit.length, 18);
      assert.equal(r.signals.audit.length, 8);
      assert.deepEqual(
        usb.map((p) => p.pad),
        ['46', '47'],
      );
      assert.equal(r.power.scope, 'finite-rp2040-coupled-usb-power-native-escapes');
      assert.ok(r.power.netNames.includes('USB_DM') && r.power.netNames.includes('USB_DP'));
      assert.ok(!r.signals.audit.some((p) => ['46', '47'].includes(p.pad)));
      assert.ok(
        Math.abs(Math.hypot(usb[0]!.via.x - usb[1]!.via.x, usb[0]!.via.y - usb[1]!.via.y) - 1) < 1e-7,
      );
      const mcu = f.graph.parts.find((p: any) => p.part.lcsc === 'C2040'),
        local = (p: any) => {
          let x = p.x - mcu.at.x,
            y = p.y - mcu.at.y;
          for (let i = 0; i < turns; i++) {
            const before = x;
            x = y;
            y = -before;
          }
          return { x, y };
        };
      for (const [pad, expected] of [
        ['42', { x: 4.55, y: 2.600071 }],
        ['44', { x: 2.1, y: 1.3 }],
        ['45', { x: 1.799844, y: 2.1 }],
        ['46', { x: 1.8, y: 4.6 }],
        ['47', { x: 0.8, y: 4.6 }],
      ] as const) {
        const actual = local(r.power.audit.find((p) => p.pad === pad)!.via);
        assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7);
      }
    }
  const dir = 'actual-e7a97ca9/',
    actual = {
      circuit: read(dir + 'pre-pour-circuit.json').filter(
        (e: any) => !['pcb_trace', 'pcb_via', 'pcb_copper_pour'].includes(e.type) && !e.error_type,
      ),
      graph: read(dir + 'plan-graph.json'),
      mapping: Object.fromEntries(read(dir + 'import-map.json').parts.map((p: any) => [p.ref, p.pins])),
    };
  assert.equal(coupled(actual).power.audit.length, 18);
});
test('USB mode remains optional, only emits connected USB pins, and refuses forged USB ownership or aliases', () => {
  const f = fixture(),
    base = run(f),
    r = coupled(f),
    usb = r.power.audit.find((p) => p.pad === '46')!;
  assert.equal(base.power.audit.length, 16);
  assert.ok(!base.power.audit.some((p) => p.kind === 'usb-signal'));
  const usbOnly = createRpEscapePhase(f.circuit, f.graph, f.mapping, r.clock, { usbVias: true });
  assert.equal(usbOnly.audit.length, 16);
  assert.ok(!usbOnly.audit.some((p) => p.kind === 'application-gpio'));
  for (const pads of [['46'], ['46', '47']]) {
    const unconnected = fixture();
    for (const pad of pads) disconnect(unconnected, pad);
    const next = coupled(unconnected);
    assert.equal(next.power.audit.length, 18 - pads.length);
    for (const pad of pads) assert.ok(!next.power.audit.some((p) => p.pad === pad));
    if (pads.length === 2) {
      assert.equal(next.power.scope, 'finite-rp2040-power-ground-application-native-escapes');
      assert.equal(
        next.power.audit.find((p) => p.pad === '45')!.via.y,
        base.power.audit.find((p) => p.pad === '45')!.via.y,
      );
    }
  }
  const alias = fixture();
  alias.mapping.U1['46'] = 'USB_DM_unknown';
  assert.throws(() => coupled(alias), /source|alias|mapping|port/i);
  const role = fixture();
  role.graph.parts.find((p: any) => p.part.lcsc === 'C2040').part.pins['46'].role = 'ground';
  assert.throws(() => coupled(role), /source|role|net/i);
  const forged = structuredClone(r.power);
  forged.audit.find((p) => p.pad === '46')!.kind = 'application-gpio';
  assert.throws(
    () =>
      createRpSignalEscapeProposals(f.circuit, f.graph, f.mapping, r.clock, forged, new Set(forged.netNames)),
    /complete distinct/,
  );
  const wrongPort = structuredClone(r.power);
  wrongPort.audit.find((p) => p.pad === '46')!.diagnosticSourcePortId = r.power.audit.find(
    (p) => p.pad === '17',
  )!.diagnosticSourcePortId;
  assert.throws(
    () =>
      createRpSignalEscapeProposals(
        f.circuit,
        f.graph,
        f.mapping,
        r.clock,
        wrongPort,
        new Set(wrongPort.netNames),
      ),
    /prefix source|source\/port/,
  );
  const blocked = fixture(),
    ownPad = blocked.circuit.find(
      (e: any) => e.type === 'pcb_smtpad' && e.pcb_port_id === usb.diagnosticPcbPortId,
    );
  blocked.circuit.push({
    ...structuredClone(ownPad),
    pcb_smtpad_id: 'DERIVED_OWN_USB_PAD_AT_VIA',
    x: usb.via.x,
    y: usb.via.y,
    width: 0.4,
    height: 0.4,
  });
  assert.throws(() => coupled(blocked), /native geometry|Via hole|SMD/);
});
test('old outward power45 barrel physically collides with the new USB46 barrel, so USB and power relocation must stay coupled', async () => {
  const { checkDifferentNetViaSpacing } = await import('../eda/node_modules/@tscircuit/checks/dist/index.js'),
    f = fixture(),
    old = run(f),
    r = coupled(f),
    old45 = old.power.audit.find((p) => p.pad === '45')!,
    usb46 = r.power.audit.find((p) => p.pad === '46')!,
    checks = structuredClone(f.circuit);
  for (const p of [old45, usb46]) {
    const source = checks.find(
        (e: any) => e.type === 'source_trace' && e.source_trace_id === p.diagnosticSourceTraceId,
      ),
      id = 'DERIVED_COUPLING_' + p.pad;
    checks.push({
      type: 'pcb_trace',
      pcb_trace_id: id,
      source_trace_id: source.source_trace_id,
      subcircuit_id: source.subcircuit_id,
      route: p.route,
    });
    checks.push({
      type: 'pcb_via',
      pcb_via_id: id + '_via',
      pcb_trace_id: id,
      ...p.via,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      layers: ['top', 'inner1', 'inner2', 'bottom'],
      from_layer: 'top',
      to_layer: 'bottom',
      subcircuit_id: source.subcircuit_id,
      subcircuit_connectivity_map_key: source.subcircuit_connectivity_map_key,
    });
  }
  assert.ok(checkDifferentNetViaSpacing(checks, { minClearance: 0.127 }).length > 0);
});
