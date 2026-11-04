// Mechanical estimates per catalog module. The catalog (src/circuit/catalog.ts) owns outlines and pins;
// this table owns what the catalog does not hold: how tall each part stands on the carrier and where
// its interaction point is. Every number here is an estimate from public seller data or the catalog
// drawing. None was measured on a physical part. `confidence` says how far to trust each entry.

export const SOCKET_MM = 8.5; // Standard 2.54 mm female header body.
export const MALE_SPACER_MM = 2.54; // Plastic spacer of the male header soldered to the module.

export type BlockColor = 'socket' | 'pcb-blue' | 'pcb-black' | 'pcb-dark' | 'metal' | 'glass' | 'active' | 'plastic' | 'amber' | 'resistor';

/** One placeholder solid for the assembly preview, in the module's catalog frame (x right, y down, mm). */
export interface LocalBlock {
  shape: 'box' | 'cylinder';
  color: BlockColor;
  x: number; y: number; w: number; h: number; // Box centre and size, or cylinder centre with w as diameter.
  z0: number; z1: number; // Above the carrier's top surface.
  label: string;
}

export interface LocalAperture {
  purpose: 'usb' | 'display-active-area' | 'encoder-shaft' | 'light-sensor' | 'indicator' | 'sound' | 'sensor-air';
  surface: 'wall' | 'lid';
  shape: 'pill' | 'rect' | 'circle' | 'grid';
  x: number; y: number; // Catalog frame.
  widthMm: number; heightMm: number; // Diameter for circle; grid uses holeMm/columns/rows.
  /** Height of the opening's centre (wall), or of the part's top under the opening (lid), above the carrier. */
  zMm: number;
  outwardLocal?: { x: number; y: number }; // Wall apertures only: catalog-frame direction the mating part leaves.
  overhangMm?: number; // How far the connector passes the module outline along outwardLocal.
  grid?: { holeMm: number; columns: number; rows: number; pitchMm: number };
  activeAreaMm?: { w: number; h: number };
  note: string;
}

export interface ModuleMech {
  mount: 'socketed' | 'soldered' | 'on-leads';
  socketMm: number; spacerMm: number; pcbMm: number; componentsMm: number;
  /** Parts above the body that pass through the lid and so do not set the box height. */
  throughLid?: { bushingTopMm: number; shaftTopMm: number; bushingDiameterMm: number; shaftDiameterMm: number };
  /** The part's real body, when it differs from the catalog's wiring outline (leaded parts). */
  bodyMm?: { w: number; h: number };
  /** The body sits under the lid on long leads rather than at a fixed height. */
  raisedToLid?: boolean;
  blocks: (w: number, h: number, top: number) => LocalBlock[];
  apertures: (w: number, h: number, top: number) => LocalAperture[];
  confidence: string;
}

const box = (color: BlockColor, label: string, x: number, y: number, w: number, h: number, z0: number, z1: number): LocalBlock => ({ shape: 'box', color, label, x, y, w, h, z0, z1 });
const cyl = (color: BlockColor, label: string, x: number, y: number, d: number, z0: number, z1: number): LocalBlock => ({ shape: 'cylinder', color, label, x, y, w: d, h: d, z0, z1 });
const pcbBottom = SOCKET_MM + MALE_SPACER_MM;

// ESP32-DevKitC V4. Pins: catalog rows at x=1.25 and x=26.65, y=6.9..52.62.
const ESP32_PCB = 1.6; const ESP32_COMPONENTS = 4.0; const USB_CENTRE_ABOVE_PCB = 1.5; const USB_OVERHANG = 1.0;
// EC11-style encoder on the KY-040 PCB. Pins at the catalog's x=30.6, y=4.4..14.56; shaft at the drawing's (9.2, 9.5).
const KY_PCB = 1.6; const KY_BODY = 6.6; const KY_BUSHING_TOP = 12; const KY_SHAFT_TOP = 20;
// OLED: seller total thickness 4.1 mm. Active area 21.744 x 10.864 mm from the DM-OLED096-624 datasheet.
const OLED_PCB = 1.2; const OLED_COMPONENTS = 2.9;
const OLED_ACTIVE = { w: 21.744, h: 10.864 }; const OLED_ACTIVE_Y = 12.6; const OLED_WINDOW_MARGIN = 1.2;

export const MODULE_MECH: Readonly<Record<string, ModuleMech>> = {
  'esp32-devkitc-v4': {
    mount: 'socketed', socketMm: SOCKET_MM, spacerMm: MALE_SPACER_MM, pcbMm: ESP32_PCB, componentsMm: ESP32_COMPONENTS,
    confidence: 'Outline 54.4 x 27.9 mm is quoted by a third-party guide, whose own caption also says 48.2 mm; another database says 54 x 27 mm. Espressif publishes a drawing we could not read numerically. 25.4 mm row spacing comes from the catalog and was not confirmed. USB position and component height are estimates, and USB-C clones differ.',
    blocks: (w, h) => {
      const top = pcbBottom + ESP32_PCB;
      return [
        box('socket', 'socket left', 1.25, 29.76, 2.54, 48.26, 0, SOCKET_MM),
        box('socket', 'socket right', 26.65, 29.76, 2.54, 48.26, 0, SOCKET_MM),
        box('plastic', 'male spacer left', 1.25, 29.76, 2.54, 48.26, SOCKET_MM, pcbBottom),
        box('plastic', 'male spacer right', 26.65, 29.76, 2.54, 48.26, SOCKET_MM, pcbBottom),
        box('pcb-black', 'devkit pcb', w / 2, h / 2, w, h, pcbBottom, top),
        box('metal', 'wroom shield', 13.95, 16.4, 16.1, 17.6, top, top + 3.2),
        box('pcb-dark', 'wroom antenna', 13.95, 4.2, 18, 6.6, top, top + 0.8),
        box('metal', 'micro-usb', 13.95, h - 2.1 + USB_OVERHANG / 2, 7.6, 5.2 + USB_OVERHANG, top, top + 3),
        box('plastic', 'en button', 6.7, h - 2.9, 2.6, 2.6, top, top + 3.5),
        box('plastic', 'boot button', 21.2, h - 2.9, 2.6, 2.6, top, top + 3.5),
      ];
    },
    apertures: (w, h) => [{
      purpose: 'usb', surface: 'wall', shape: 'pill', x: 13.95, y: h, widthMm: 12.5, heightMm: 8.5,
      zMm: pcbBottom + ESP32_PCB + USB_CENTRE_ABOVE_PCB, outwardLocal: { x: 0, y: 1 }, overhangMm: USB_OVERHANG,
      note: 'Sized for a micro-USB cable overmould (estimated up to 12 x 8 mm). The plug and overmould pass through the wall.',
    }],
  },
  'ssd1306-oled-128x64-i2c': {
    mount: 'socketed', socketMm: SOCKET_MM, spacerMm: MALE_SPACER_MM, pcbMm: OLED_PCB, componentsMm: OLED_COMPONENTS,
    confidence: 'Active area 21.744 x 10.864 mm is from a panel datasheet. PCB outline varies by seller (about 27 x 27 mm). The active area position on the PCB was not found in any drawing: y = 12.6 mm is estimated, so the window carries a 1.2 mm margin per side.',
    blocks: (w, h, top) => {
      const pcbTop = pcbBottom + OLED_PCB;
      return [
        box('socket', 'socket', w / 2, 1.6, 10.16, 2.54, 0, SOCKET_MM),
        box('plastic', 'male spacer', w / 2, 1.6, 10.16, 2.54, SOCKET_MM, pcbBottom),
        box('pcb-blue', 'oled pcb', w / 2, h / 2, w, h, pcbBottom, pcbTop),
        box('glass', 'oled glass', w / 2, 14.6, 26, 18.6, pcbTop, top - 0.02),
        box('active', 'oled active area', w / 2, OLED_ACTIVE_Y, OLED_ACTIVE.w, OLED_ACTIVE.h, top - 0.02, top),
      ];
    },
    apertures: (w, _h, top) => [{
      purpose: 'display-active-area', surface: 'lid', shape: 'rect', x: w / 2, y: OLED_ACTIVE_Y,
      widthMm: OLED_ACTIVE.w + 2 * OLED_WINDOW_MARGIN, heightMm: OLED_ACTIVE.h + 2 * OLED_WINDOW_MARGIN, zMm: top,
      activeAreaMm: OLED_ACTIVE, note: 'Window over the active area plus the margin.',
    }],
  },
  'ky040-rotary-encoder': {
    mount: 'socketed', socketMm: SOCKET_MM, spacerMm: MALE_SPACER_MM, pcbMm: KY_PCB, componentsMm: KY_BODY,
    throughLid: { bushingTopMm: pcbBottom + KY_PCB + KY_BUSHING_TOP, shaftTopMm: pcbBottom + KY_PCB + KY_SHAFT_TOP, bushingDiameterMm: 7, shaftDiameterMm: 6 },
    confidence: 'PCB 32 x 19 mm is quoted by one tutorial; sellers give an overall 30-31 x 18-19 x 29-30 mm. Body 6.6 mm, bushing and 20 mm shaft are typical EC11 values and were not confirmed. Shaft position comes from the catalog drawing. Header orientation was not confirmed: right-angle pins would not plug into a vertical socket like this.',
    blocks: (w, h) => {
      const pcbTop = pcbBottom + KY_PCB;
      return [
        box('socket', 'socket', 30.6, 9.48, 2.54, 12.7, 0, SOCKET_MM),
        box('plastic', 'male spacer', 30.6, 9.48, 2.54, 12.7, SOCKET_MM, pcbBottom),
        box('pcb-dark', 'ky040 pcb', w / 2, h / 2, w, h, pcbBottom, pcbTop),
        box('metal', 'encoder body', 9.2, 9.5, 12.4, 12.4, pcbTop, pcbTop + KY_BODY),
        cyl('metal', 'encoder bushing', 9.2, 9.5, 7, pcbTop + KY_BODY, pcbTop + KY_BUSHING_TOP),
        cyl('metal', 'encoder shaft', 9.2, 9.5, 6, pcbTop + KY_BUSHING_TOP, pcbTop + KY_SHAFT_TOP),
      ];
    },
    apertures: () => [{
      purpose: 'encoder-shaft', surface: 'lid', shape: 'circle', x: 9.2, y: 9.5, widthMm: 7.4, heightMm: 7.4, zMm: pcbBottom + KY_PCB + KY_BODY,
      note: 'Clears the 7 mm threaded bushing. A panel nut on the lid carries the push force, because the single socket cannot.',
    }],
  },
  'bme280-i2c-4pin': {
    mount: 'socketed', socketMm: SOCKET_MM, spacerMm: MALE_SPACER_MM, pcbMm: 1.0, componentsMm: 1.0,
    confidence: 'Outline from the catalog. Height estimated. No drawing checked.',
    blocks: (w, h, top) => [
      box('socket', 'socket', w / 2, 1.4, 10.16, 2.54, 0, SOCKET_MM),
      box('plastic', 'male spacer', w / 2, 1.4, 10.16, 2.54, SOCKET_MM, pcbBottom),
      box('pcb-blue', 'bme280 pcb', w / 2, h / 2, w, h, pcbBottom, top - 1),
      box('metal', 'bme280 sensor', w / 2, h / 2, 2.5, 2.5, top - 1, top),
    ],
    apertures: (w, h, top) => [{
      purpose: 'sensor-air', surface: 'lid', shape: 'grid', x: w / 2, y: h / 2, widthMm: 9, heightMm: 9, zMm: top,
      grid: { holeMm: 2.5, columns: 3, rows: 3, pitchMm: 4 }, note: 'Lets room air reach the sensor.',
    }],
  },
  'ds18b20-to92': {
    mount: 'soldered', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: 13, bodyMm: { w: 5, h: 4 },
    confidence: 'TO-92 body is a standard package. 13 mm standing height comes from the catalog size with straight leads.',
    blocks: (_w, _h, top) => [cyl('plastic', 'to-92 body', 0, 0, 4.6, top - 4.6, top)],
    apertures: (_w, _h, top) => [{
      purpose: 'sensor-air', surface: 'lid', shape: 'grid', x: 0, y: 0, widthMm: 9, heightMm: 9, zMm: top,
      grid: { holeMm: 2.5, columns: 3, rows: 3, pitchMm: 4 }, note: 'Lets room air reach the sensor. It will still read warm from the ESP32 inside the box.',
    }],
  },
  'resistor-axial': {
    mount: 'soldered', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: 3.2, bodyMm: { w: 2.6, h: 18 },
    confidence: 'Standard 1/4 W axial body, lying flat.',
    blocks: (_w, _h, top) => [box('resistor', 'resistor', 0, 0, 2.4, 7, top - 2.4, top)],
    apertures: () => [],
  },
  'ldr-5mm': {
    mount: 'on-leads', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: 8, bodyMm: { w: 5.2, h: 5.2 }, raisedToLid: true,
    confidence: 'Standard 5 mm LDR. Leads must reach from the carrier to the lid; the catalog gives no lead length.',
    blocks: () => [cyl('amber', 'ldr', 0, 0, 5, 0, 2.5)],
    apertures: () => [{ purpose: 'light-sensor', surface: 'lid', shape: 'circle', x: 0, y: 0, widthMm: 6, heightMm: 6, zMm: 8, note: 'The LDR sits on its leads just under this hole.' }],
  },
  'led-5mm-amber': {
    mount: 'on-leads', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: 8.7, bodyMm: { w: 5.8, h: 5.8 }, raisedToLid: true,
    confidence: 'Standard 5 mm LED. Leads must reach from the carrier to the lid; the catalog gives no lead length.',
    blocks: () => [cyl('amber', 'led', 0, 0, 5, 0, 8.7)],
    apertures: () => [{ purpose: 'indicator', surface: 'lid', shape: 'circle', x: 0, y: 0, widthMm: 5.3, heightMm: 5.3, zMm: 8.7, note: 'The dome sits just under or in this hole, on its leads.' }],
  },
  'piezo-passive-12mm': {
    mount: 'soldered', socketMm: 0, spacerMm: 0, pcbMm: 0, componentsMm: 9.5, bodyMm: { w: 12, h: 12 },
    confidence: '12 mm body and 9.5 mm height are typical. The catalog pin spacing is 5 mm while many 12 mm transducers use 6.5-7.6 mm, so check the part.',
    blocks: () => [cyl('glass', 'piezo', 0, 0, 12, 0, 9.5)],
    apertures: (_w, _h, top) => [{
      purpose: 'sound', surface: 'lid', shape: 'grid', x: 0, y: 0, widthMm: 8, heightMm: 8, zMm: top,
      grid: { holeMm: 2, columns: 3, rows: 3, pitchMm: 3.2 }, note: 'Sound holes over the transducer.',
    }],
  },
};
