"""Build Moki's standalone architecture diagram from local brand/logo assets.
Run from the repository root: python3 scripts/render-architecture.py
No model calls or network requests are made by this renderer.
"""
from pathlib import Path
import html, re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/diagrams/assets'
OUT = ROOT / 'web/public/architecture/index.html'
PAPER, INK, MUTED, LINE, BLUE = '#f8f7f3', '#252525', '#66665f', '#deded6', '#139df2'


def symbol(name):
    source = ET.fromstring((ASSETS / f'{name}.svg').read_text())
    vb = source.get('viewBox') or f"0 0 {source.get('width')} {source.get('height')}"
    attrs = {'id': f'logo-{name}', 'viewBox': vb, 'fill': source.get('fill', 'currentColor')}
    for key in ('fill-rule', 'clip-rule', 'stroke'):
        if key in source.attrib: attrs[key] = source.get(key)
    ids = {el.get('id'): f'{name}-{el.get("id")}' for el in source.iter() if el.get('id')}
    for el in source.iter():
        el.tag = el.tag.split('}')[-1]
        for key, value in list(el.attrib.items()):
            if key.startswith('{') or key.startswith('on') or key.startswith('data-'):
                del el.attrib[key]
            else:
                for old, new in ids.items(): value = value.replace(f'url(#{old})', f'url(#{new})')
                if key == 'id': value = ids[value]
                el.set(key, value)
    body = ''.join(ET.tostring(child, encoding='unicode') for child in source if child.tag not in ('title', 'desc', 'metadata'))
    return '<symbol ' + ' '.join(f'{k}="{v}"' for k,v in attrs.items()) + '>' + body + '</symbol>'


def logo(name, x, y, w=24, h=None):
    return f'<use aria-hidden="true" href="#logo-{name}" x="{x}" y="{y}" width="{w}" height="{h or w}"/>'


def text(x, y, value, cls='body', anchor=None, extra=''):
    return f'<text x="{x}" y="{y}" class="{cls}"' + (f' text-anchor="{anchor}"' if anchor else '') + f' {extra}>{html.escape(value)}</text>'


def rect(x,y,w,h,fill='#ffffff',stroke=LINE,rx=10,extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" {extra}/>'


def path(d, dashed=False):
    return f'<path class="connector" d="{d}" marker-end="url(#arrow)"' + (' stroke-dasharray="5 5"' if dashed else '') + '/>'


def ink(x,y,size):
    return f'<g aria-hidden="true" transform="translate({x} {y}) scale({size/100})"><path fill="{INK}" d="M76 6C43-6 8 15 5 49 1 83 25 99 54 97c28-1 45-17 44-41-1-18-9-21-16-24C66 26 72 15 76 6Z"/><ellipse fill="{PAPER}" cx="56" cy="54" rx="5.7" ry="9.5" transform="rotate(-18 56 54)"/><ellipse fill="{PAPER}" cx="76" cy="45" rx="5.1" ry="8.8" transform="rotate(-18 76 45)"/></g>'


def stroke_icon(name,x,y,size=28):
    bodies = {
      'files':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
      'shield':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m8 12 3 3 5-6"/>',
      'desktop':'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    }
    return f'<g aria-hidden="true" transform="translate({x} {y}) scale({size/24})" fill="none" stroke="{INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{bodies[name]}</g>'

svg = ['<svg class="architecture" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="moki-architecture-title moki-architecture-desc">',
'<title id="moki-architecture-title">Moki, under the hood</title>',
'<desc id="moki-architecture-desc">Moki coordinates OpenAI specialist calls, BFL visuals, Daytona engineering tools and geometry validation through shared, persisted artifact contracts.</desc>',
'<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="m1 1 6 3-6 3" fill="none" stroke="#777771" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></marker>',
'<pattern id="microdots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.65" fill="#139df2"/></pattern>',
*[symbol(name) for name in ['react','vite','nodejs','typescript','threejs','openai','daytona','bfl','kicad','freecad']], '</defs>',
rect(0,0,1280,720,PAPER,PAPER,0),
# Quiet pixel motif borrowed from the landing, outside the content area.
'<g aria-hidden="true" opacity="0.24"><path d="M1088 0h192v128h-32V96h-32V64h-64V32h-64Z" fill="url(#microdots)"/><path d="M1216 0h64v64h-32V32h-32Z" fill="#139df2" opacity="0.18"/></g>',
ink(48,48,44), text(112,78,'Moki, under the hood.','title'),
text(48,120,'One idea. Coordinated specialists. A shared trail of design evidence.','subtitle'),
text(1232,76,'THE WORKSHOP ARCHITECTURE','eyebrow','end'),
# Runtime zone comes before edges and cards.
rect(736,164,496,452,'#f0efea',LINE,12),
logo('daytona',760,179,98,22),text(1212,195,'ISOLATED TOOL WORKSPACES','eyebrow','end'),
# Relationships. Distinct ports, no transit through other nodes.
path('M304 268H368'),
path('M672 248H768'),
path('M416 340V380Q416 388 408 388H272Q264 388 264 396V424'),
path('M176 424V340'),
path('M560 340V424',True),
path('M768 280H728Q720 280 720 288V384Q720 392 712 392H648Q640 392 640 400V424'),
path('M672 472H704Q712 472 712 464V416Q712 408 720 408H768'),
path('M984 456V512'),
path('M768 552H672',True),
# Web workspace.
'<g data-node-id="workshop">',rect(48,208,256,132),stroke_icon('desktop',72,228,24),
text(108,248,'Your workshop','name'),
text(72,280,'Prompt · choose · inspect in 3D','body'),
logo('react',72,300,18),text(98,314,'React','tech'),logo('vite',148,300,18),text(174,314,'Vite','tech'),
logo('threejs',212,300,18),text(238,314,'Three.js','tech'),'</g>',
# Coordinator, the only strongly accented card.
'<g data-node-id="orchestrator">',rect(368,208,304,132,'#eaf5fd',BLUE,10),
logo('openai',392,230,28),text(436,250,'Moki orchestrator','name'),
text(392,282,'OpenAI Responses · specialist calls','body'),
logo('nodejs',392,300,18),text(418,314,'Node.js','tech'),logo('typescript',484,300,18),text(510,314,'TypeScript','tech'),
text(648,314,'RUN CONTROL','eyebrow','end'),'</g>',
# BFL studio. The official lockup is kept intact.
'<g data-node-id="bfl">',rect(48,424,256,156),
logo('bfl',72,446,136,28),text(280,464,'FLUX 3','eyebrow','end'),
text(72,508,'Visual studio','name'),text(72,536,'Four directions → your selection','body'),
text(72,558,'A 10-second concept showcase','body'),'</g>',
# Shared state.
'<g data-node-id="artifacts">',rect(368,424,304,156),stroke_icon('files',392,446,24),
text(428,466,'Shared artifact contract','name'),
text(392,500,'Measured PCB size, holes & hashes','body'),
text(392,526,'Saved projects · runs · checker evidence','body'),
'<path d="M392 542h256" stroke="#e8e8e1"/>',
text(392,562,'LOCAL JSON + FILES','eyebrow'),text(648,562,'STEP / GLB / PCB','tech','end'),'</g>',
# Electrical specialist and actual tools.
'<g data-node-id="electrical">',rect(768,208,432,96),logo('kicad',792,232,36),
text(844,242,'Electrical specialist','name'),text(844,270,'KiCad · PCB outline & mounting holes','body'),
text(1176,236,'01','index','end'),'</g>',
# Mechanical specialist.
'<g data-node-id="mechanical">',rect(768,360,432,96),logo('freecad',792,384,36),
text(844,394,'Mechanical specialist','name'),text(844,422,'FreeCAD + build123d · STEP / GLB','body'),
text(1176,388,'02','index','end'),'</g>',
# Independent validator. Deterministic file checks, not invented LLM proof.
'<g data-node-id="validation">',rect(768,512,432,80),stroke_icon('shield',792,536,28),
text(836,542,'Validation worker','name'),text(836,570,'Reopens STEP · solids · bounds · hashes','body'),
text(1176,540,'03','index','end'),'</g>',
# Short edge annotations off the stroke, with opaque masks.
rect(48,364,120,20,PAPER,PAPER,0),text(60,378,'CHOOSE A DIRECTION','eyebrow'),
rect(560,364,140,20,PAPER,PAPER,0),text(572,378,'MEASURED HANDOFF','eyebrow'),
text(760,608,'Models plan via OpenAI; tools run in the desktops.','caption'),
# Bottom legend, scope and next implementation step.
'<path d="M48 636H1232" stroke="#deded6"/>',
'<path d="M48 660h24" class="connector" marker-end="url(#arrow)"/>',text(84,664,'API / file handoff','caption'),
'<path d="M232 660h24" class="connector" stroke-dasharray="5 5" marker-end="url(#arrow)"/>',text(268,664,'Saved state & evidence','caption'),
text(1232,664,'LIVE BUILD · OCTOBER 2026','eyebrow','end'),
text(48,696,'NEXT: schematic → electrical checks → routing → board checks → populated-board fit','caption'),
text(1232,696,'Concept film uses the selected image.','caption','end'),
'</svg>']
styles = f'''*{{box-sizing:border-box}}html,body{{margin:0;background:{PAPER};color:{INK};font-family:"Manrope",sans-serif}}body{{min-height:100vh;display:grid;place-items:center}}main{{width:100%;max-width:1440px}}.diagram-container{{width:100%;overflow-x:auto}}svg.architecture{{width:100%;min-width:1280px;display:block;color:{INK};font-family:"Manrope",sans-serif}}.title{{font-size:40px;font-weight:650;letter-spacing:-1.8px;fill:{INK}}}.subtitle{{font-size:16px;font-weight:400;fill:{MUTED}}}.name{{font-size:16px;font-weight:700;letter-spacing:-.35px;fill:{INK}}}.body{{font-size:12px;font-weight:450;fill:{MUTED}}}.tech{{font-size:10px;font-weight:550;fill:{MUTED}}}.eyebrow{{font-size:8px;font-weight:650;letter-spacing:1.1px;fill:{MUTED}}}.caption{{font-size:10px;font-weight:450;fill:{MUTED}}}.index{{font-size:10px;font-weight:500;fill:#777771}}.connector{{fill:none;stroke:#777771;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}}@media print{{body{{display:block}}main{{max-width:none}}.diagram-container{{overflow-x:visible}}svg.architecture{{min-width:0}}}}'''
page='<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Moki — architecture</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;450;500;550;600;650;700&amp;display=swap"><style>'+styles+'</style></head><body><main aria-label="Moki technical architecture"><div class="diagram-container">'+''.join(svg)+'</div></main></body></html>\n'
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(page)
print(f'Built {OUT.relative_to(ROOT)} ({len(page):,} characters)')
