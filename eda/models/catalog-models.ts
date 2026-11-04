// Recognition models, in the existing mechanical envelopes. Dimensions/positions are catalog
// estimates; sources and remaining uncertainty are in the realism report. No fit data lives here.
import { moduleDef } from '../../src/circuit/catalog.js';
import { MODULE_MECH, type LocalBlock } from '../enclosure/module-mech.js';

export type Plan = Record<string, any>;
export interface ModelPiece { label: string; role: 'module' | 'socket'; plan: Plan }
export const MATERIALS = {
  socket: { color: '#181a1c', roughness: 0.72 }, plastic: { color: '#24282a', roughness: 0.64 },
  'pcb-blue': { color: '#1356a1', roughness: 0.43 }, 'pcb-black': { color: '#202629', roughness: 0.5 },
  'pcb-dark': { color: '#183c32', roughness: 0.5 }, metal: { color: '#b9bdc2', metalness: 0.82, roughness: 0.28 },
  glass: { color: '#101821', roughness: 0.15 }, active: { color: '#152a34', roughness: 0.17 },
  amber: { color: '#ffb629', opacity: 0.66, transparent: true, roughness: 0.18 },
  resistor: { color: '#c59e72', roughness: 0.75 }, gold: { color: '#d9b45e', metalness: 0.78, roughness: 0.26 },
  silk: { color: '#e3e4da', roughness: 0.8 }, ribbon: { color: '#9e5425', roughness: 0.5 }, ceramic: { color: '#bc9e79', roughness: 0.8 },
};
export type Finish = keyof typeof MATERIALS;
const box = (x: number, y: number, z: number, w: number, h: number, d: number): Plan => ({ type: 'cuboid', size: [w,h,d], center: [x,y,z+d/2] });
const cyl = (x: number, y: number, z: number, diameter: number, height: number, segments = 12): Plan => ({ type: 'cylinder', radius: diameter/2, height, center: [x,y,z+height/2], segments });
const sub = (...shapes: Plan[]): Plan => ({ type: 'subtract', shapes });
const paint = (shape: Plan, finish: Finish): Plan => ({ ...shape, material: MATERIALS[finish] });
const FONT: Record<string, string[]> = {
  E:['111','100','110','100','111'], S:['111','100','111','001','111'], P:['110','101','110','100','100'],
  W:['101','101','101','111','101'], R:['110','101','110','101','101'], O:['111','101','101','101','111'],
  M:['101','111','111','101','101'], N:['101','111','111','111','101'], B:['110','101','110','101','110'],
  T:['111','010','010','010','010'], '3':['111','001','111','001','111'], '2':['110','001','010','100','111'],
  '0':['111','101','101','101','111'], '1':['010','110','010','010','111'], '+':['000','010','111','010','000'], '6':['100','100','111','101','111'],
  '-':['000','000','111','000','000'],
};

/** Pieces stay independent during export: a boolean union erases per-solid PBR metadata. */
export function detailedModulePieces(moduleId: string, value?: string): ModelPiece[] {
  const def = moduleDef(moduleId); const mech = MODULE_MECH[moduleId]!;
  const top = mech.socketMm + mech.spacerMm + mech.pcbMm + mech.componentsMm;
  const blocks = mech.blocks(def.size.w, def.size.h, top);
  const out: ModelPiece[] = [];
  const add = (label: string, shape: Plan, finish: Finish, role: ModelPiece['role'] = 'module') => out.push({label, role, plan: paint(shape, finish)});
  const B = (label: string) => blocks.find(b => b.label === label)!;
  const solid = (b: LocalBlock) => b.shape === 'box' ? box(b.x,b.y,b.z0,b.w,b.h,b.z1-b.z0) : cyl(b.x,b.y,b.z0,b.w,b.z1-b.z0);
  const text = (str: string, x: number, y: number, z: number, pixel = 0.2, finish: Finish = 'silk') => {
    [...str].forEach((c,i) => FONT[c]?.forEach((row,iy) => [...row].forEach((v,ix) => { if(v==='1') add(`mark ${str}`,box(x+i*4*pixel+ix*pixel,y+iy*pixel,z,pixel*.85,pixel*.85,.012),finish); })));
  };
  const chip = (x: number,y: number,z: number,w: number,h: number,d: number,pins = 4) => {
    add('IC moulding',box(x,y,z,w,h,d),'plastic');
    for(let i=0;i<pins;i++) for(const side of [-1,1]) add('IC lead',box(x+side*(w/2+.2),y+(i-(pins-1)/2)*h/pins,z+.05,.45,h/pins*.55,.18),'metal');
    add('pin one',cyl(x-w*.3,y-h*.3,z+d,.25,.015,10),'silk');
  };
  // Header openings follow actual catalog pin centres; gold pins enter each hollow socket.
  for (const b of blocks.filter(b => b.color === 'socket' || b.label.startsWith('male spacer'))) {
    if (b.color !== 'socket') { add(b.label,solid(b),'plastic'); continue; }
    const pins = def.pins.filter(p => Math.abs(p.physical.x-b.x)<=b.w/2 && Math.abs(p.physical.y-b.y)<=b.h/2);
    add(b.label,sub(solid(b),...pins.map(p => box(p.physical.x,p.physical.y,b.z1-2,1.05,1.05,2.1))),'socket','socket');
    for(const p of pins) {
      add('socket contact',sub(box(p.physical.x,p.physical.y,b.z1-1.6,.95,.95,1.3),box(p.physical.x,p.physical.y,b.z1-1.7,.66,.66,1.5)),'gold','socket');
      add('male header pin',box(p.physical.x,p.physical.y,b.z1-1.4,.58,.58,mech.spacerMm+mech.pcbMm+1.4),'gold');
      add('module solder',cyl(p.physical.x,p.physical.y,mech.socketMm+mech.spacerMm+mech.pcbMm-.12,1.45,.12,8),'metal');
    }
  }
  for(const b of blocks.filter(b => b.label.endsWith('pcb'))) {
    const holes = def.pins.map(p => cyl(p.physical.x,p.physical.y,b.z0-.1,.8,b.z1-b.z0+.2,12));
    if(moduleId.startsWith('ssd1306')) for(const x of [2.2,def.size.w-2.2]) for(const y of [4.3,def.size.h-1.9]) holes.push(cyl(x,y,b.z0-.1,2,b.z1-b.z0+.2,20));
    add(b.label,sub(solid(b),...holes),b.color as Finish);
    if(moduleId.startsWith('ssd1306')) for(const x of [2.2,def.size.w-2.2]) for(const y of [4.3,def.size.h-1.9]) add('mounting ring',sub(cyl(x,y,b.z1-.03,2.7,.03,20),cyl(x,y,b.z1-.1,2,.2,20)),'gold');
  }
  if(moduleId==='esp32-devkitc-v4') {
    const z=B('devkit pcb').z1; const shield=B('wroom shield');
    add('WROOM shield',solid(shield),'metal');
    // Raised edge is inside the original shield's volume.
    add('shield lid',box(shield.x,shield.y,shield.z1-.1,shield.w-.55,shield.h-.55,.1),'metal');
    add('antenna substrate',solid(B('wroom antenna')),'pcb-dark');
    for(let i=0;i<6;i++) {
      add('antenna trace',box(7+i*2.35,4.2,z+.78,.38,4.5,.02),'gold');
      if(i<5) add('antenna meander',box(8.175+i*2.35,4.2+(i%2?2.05:-2.05),z+.78,2.7,.4,.02),'gold');
    }
    text('ESP32',9,13,shield.z1-.012,.36,'plastic'); text('WROOM',9,17,shield.z1-.012,.28,'plastic');
    for(const [label,mark] of [['en button','EN'],['boot button','BOOT']]) {
      const b=B(label!); add('switch housing',box(b.x,b.y,b.z0,b.w,b.h,1.3),'metal');
      add('switch actuator',box(b.x,b.y,b.z0+1.3,1.75,1.75,b.z1-b.z0-1.3),'plastic');
      text(mark!,b.x-1.4,b.y-3.2,z,.15);
    }
    const usb=B('micro-usb');
    add('micro USB shell',sub(solid(usb),box(usb.x,usb.y+1,usb.z0+.45,usb.w-1,usb.h,usb.z1-usb.z0-.9)),'metal');
    add('USB tongue',box(usb.x,usb.y,usb.z0+1.05,5,usb.h-1.3,.5),'plastic');
    for(let i=0;i<5;i++) add('USB contact',box(usb.x+(i-2)*.65,usb.y+.8,usb.z0+1.55,.25,2.7,.08),'gold');
    chip(13.95,36,z,5,5,1,7); chip(7.5,44,z,3.7,6.3,1.5,3);
    add('LDO heat tab',box(7.5,40.3,z,3.5,1,.4),'metal');
    for(let i=0;i<14;i++) {
      const x=i%2?19.7:9.3, y=27+Math.floor(i/2)*2;
      add('SMD termination',box(x,y,z,1.55,.75,.5),'metal');
      add('SMD body',box(x,y,z+.12,1,.75,.42),i%3?'ceramic':'plastic');
    }
    for(const x of [3.5,23.2]) for(let i=0;i<16;i++) add('pin legend',box(x,8+i*2.54,z,1.2,.15,.015),'silk');
  } else if(moduleId.startsWith('ssd1306')) {
    add('OLED glass',solid(B('oled glass')),'glass'); add('active display',solid(B('oled active area')),'active');
    const pcb=B('oled pcb');
    add('ribbon fold',box(13.65,25.7,pcb.z1,12,1.8,1.15),'ribbon');
    for(let i=0;i<20;i++) add('ribbon conductor',box(8+i*.58,25.7,pcb.z1+1.15,.17,1.6,.02),'gold');
    text('SSD1306',7,3.7,pcb.z1,.17);
  } else if(moduleId==='ky040-rotary-encoder') {
    const body=B('encoder body'), bush=B('encoder bushing'), shaft=B('encoder shaft'),z=B('ky040 pcb').z1;
    add('EC11 phenolic base',box(body.x,body.y,z,body.w,body.h,1.2),'plastic');
    add('EC11 metal housing',box(body.x,body.y,z+1.2,body.w,body.h,body.z1-z-1.2),'metal');
    for(const x of [-1,1]) add('EC11 crimp',box(body.x+x*5.6,body.y,body.z1-.7,1.2,8,.7),'metal');
    add('threaded bushing',solid(bush),'metal');
    for(let z1=bush.z0+.3;z1<bush.z1;z1+=.65) add('thread groove',sub(cyl(bush.x,bush.y,z1,7,.13,32),cyl(bush.x,bush.y,z1-.01,6.65,.15,32)),'plastic');
    add('D flat shaft',sub(solid(shaft),box(shaft.x+3.7,shaft.y,shaft.z0+2,3,8,shaft.z1-shaft.z0)),'metal');
    for(let i=0;i<18;i++) { const a=i/18*Math.PI*2; if(Math.cos(a)>.72)continue; add('shaft knurl',cyl(shaft.x+2.85*Math.cos(a),shaft.y+2.85*Math.sin(a),shaft.z0+2,.16,shaft.z1-shaft.z0-2,6),'plastic'); }
    for(let i=0;i<3;i++) { add('pullup end cap',box(23,5+i*3.8,z,2.5,1,.5),'metal'); add('pullup resistor',box(23,5+i*3.8,z+.1,1.6,1,.45),'plastic'); }
    text('SW',23.5,16,z,.18);
  } else if(moduleId==='bme280-i2c-4pin') {
    const b=B('bme280 sensor'),z=B('bme280 pcb').z1;
    add('BME280 lid',sub(solid(b),cyl(b.x+.6,b.y-.6,b.z1-.2,.4,.3,12)),'metal');
    for(const x of [3,10]) { add('bypass end caps',box(x,7.5,z,1.8,.8,.35),'metal'); add('bypass ceramic',box(x,7.5,z+.06,1,.8,.34),'ceramic'); }
    text('BME',4,9,z,.2);
  } else if(moduleId==='piezo-passive-12mm') {
    const b=blocks[0]!; add('piezo body with sound port',sub(solid(b),cyl(0,0,b.z1-1.8,2.1,2,24)),'plastic');
    add('piezo rim',sub(cyl(0,0,b.z1-.25,11.4,.25,40),cyl(0,0,b.z1-.3,10.8,.4,40)),'plastic');
    text('+',-3,0,b.z1-.01,.25);
  } else if(moduleId==='ds18b20-to92') {
    const b=blocks[0]!; add('TO92 D package',sub(solid(b),box(0,2.6,b.z0-.1,6,3,b.z1-b.z0+.2)),'plastic');
    for(const p of def.pins) add('TO92 lead',box(p.physical.x-def.size.w/2,0,0,.42,.42,b.z0),'metal');
  } else if(moduleId==='resistor-axial') {
    // Horizontal cylinder along Y, inside the old 2.4 x 7 x 2.4 body.
    const b=blocks[0]!;
    const axial=(radius: number,length: number,y: number): Plan => ({type:'translate',vector:[0,y,(b.z0+b.z1)/2],shape:{type:'rotateX',angle:Math.PI/2,shape:{type:'cylinder',radius,height:length,segments:20}}});
    add('axial resistor',axial(1.2,7,0),'resistor');
    const bands=resistorBands(value);
    bands.forEach((color,i) => out.push({label:`resistor band ${i+1}`,role:'module',plan:{...axial(1.201,.48,-2.2+i*1.35),material:{color,roughness:.65}}}));
    for(const sign of [-1,1]) {
      add('resistor straight lead',axial(.24,4.5,sign*5.75),'metal');
      add('resistor bent lead',cyl(0,sign*8,0,.48,(b.z0+b.z1)/2),'metal');
    }
  } else if(moduleId==='ldr-5mm') {
    const b=blocks[0]!; add('LDR ceramic disk',solid(b),'ceramic');
    for(let i=0;i<5;i++) { const x=-1.6+i*.8, h=2*Math.sqrt(2.2**2-x**2); add('LDR serpentine',box(x,0,b.z1-.025,.24,h,.025),'ribbon'); if(i<4)add('LDR turn',box(x+.4,(i%2?1:-1)*(h/2-.25),b.z1-.025,.8,.25,.025),'ribbon'); }
  } else if(moduleId==='led-5mm-amber') {
    const b=blocks[0]!;
    add('LED internal cathode',box(-.6,0,1,1.4,1.6,3),'metal'); add('LED internal anode',box(1.1,0,1,.4,.5,3.8),'metal');
    add('LED lens', {type:'union',shapes:[cyl(0,0,0,5,6.2,32),{type:'intersect',shapes:[{type:'sphere',radius:2.5,center:[0,0,6.2],segments:24},box(0,0,6.2,6,6,2.5)]}]},'amber');
    // Lead endpoints retain the catalog's asymmetric anode/cathode locations.
    for(const p of def.pins) add('LED lead',box(p.physical.x-def.pins.reduce((a,p)=>a+p.physical.x,0)/2,p.physical.y-def.pins.reduce((a,p)=>a+p.physical.y,0)/2,0,.4,.4,1.6),'metal');
    void b;
  }
  // Convert catalog Y-down to centered circuit Z-up, with leaded bodies centred on pads.
  const leaded=Boolean(mech.bodyMm);
  const px=def.pins.reduce((a,p)=>a+p.physical.x,0)/def.pins.length-def.size.w/2;
  const py=def.size.h/2-def.pins.reduce((a,p)=>a+p.physical.y,0)/def.pins.length;
  return out.map(p=>({...p,plan:{type:'translate',vector:leaded?[px,py,0]:[-def.size.w/2,def.size.h/2,0],shape:{type:'transform',matrix:[1,0,0,0,0,-1,0,0,0,0,1,0,0,0,0,1],shape:p.plan}}}));
}

export function resistorBands(value = '10 kΩ'): string[] {
  const parsed=/([\d.]+)\s*([kKmM]?)/.exec(value);
  const ohms=parsed?Number(parsed[1])*(parsed[2]?.toLowerCase()==='k'?1000:parsed[2]?.toLowerCase()==='m'?1e6:1):10000;
  const exponent=Math.floor(Math.log10(Math.max(ohms,1)))-1;
  const digits=Math.round(ohms/10**exponent);
  const colors=['#151515','#6b3520','#c83025','#ed7d20','#efcf29','#21823d','#2866ae','#93449a','#858585','#f2f0df'];
  return [colors[Math.floor(digits/10)]!,colors[digits%10]!,colors[exponent]??colors[0]!,'#c6a457'];
}
