"""Build Moki's architecture diagram from local assets.

Run from anywhere: python3 scripts/render-architecture.py

Writes web/public/architecture/index.html, docs/diagrams/moki-architecture.svg and
docs/media/architecture-2026-11.png. The PNG needs a Chromium binary: set MOKI_CHROME, or have one on
PATH or in the Playwright cache. The script makes no model or network calls.

The layout is drawn for a 1200-unit width because GitHub shows the PNG about 830 px wide, so 16
units is the smallest text that stays readable there. Every node here was read from the code;
docs/diagrams/README.md lists the source of each one.
"""
from pathlib import Path
import base64, glob, html, os, shutil, subprocess, sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/diagrams/assets'
FONT = ROOT / 'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'
OUT_HTML = ROOT / 'web/public/architecture/index.html'
OUT_SVG = ROOT / 'docs/diagrams/moki-architecture.svg'
OUT_PNG = ROOT / 'docs/media/architecture-2026-11.png'

WIDTH, HEIGHT = 1200, 1236
PAPER, PAPER_2, INK, MUTED, LINE, CONNECTOR, BLUE, BLUE_TINT = (
    '#f8f7f3', '#f0efea', '#252525', '#5f5f58', '#d9d9d0', '#6f6f69', '#139df2', '#eaf5fd')
MARKS = ['react', 'vite', 'threejs', 'nodejs', 'typescript', 'openai', 'bun', 'python', 'platformio', 'nvidia', 'modal', 'fly']


def symbol(name):
    """A logo as a reusable symbol, with no scripts, ids or metadata from its source file."""
    source = ET.fromstring((ASSETS / f'{name}.svg').read_text())
    attrs = {'id': f'logo-{name}', 'viewBox': source.get('viewBox') or f"0 0 {source.get('width')} {source.get('height')}", 'fill': source.get('fill', 'currentColor')}
    if 'fill-rule' in source.attrib:
        attrs['fill-rule'] = source.get('fill-rule')
    for el in source.iter():
        el.tag = el.tag.split('}')[-1]
        for key in list(el.attrib):
            if key.startswith('{') or key.startswith('on') or key.startswith('data-') or key == 'id':
                del el.attrib[key]
    body = ''.join(ET.tostring(child, encoding='unicode') for child in source if child.tag not in ('title', 'desc', 'metadata'))
    return '<symbol ' + ' '.join(f'{k}="{v}"' for k, v in attrs.items()) + '>' + body + '</symbol>'


def logo(name, x, y, size=24):
    return f'<use aria-hidden="true" href="#logo-{name}" x="{x}" y="{y}" width="{size}" height="{size}"/>'


def tscircuit_logo(x, y, size=30):
    data = base64.b64encode((ASSETS / 'tscircuit.png').read_bytes()).decode()
    return f'<image aria-hidden="true" href="data:image/png;base64,{data}" x="{x}" y="{y}" width="{size}" height="{size}"/>'


def text(x, y, value, cls='body', anchor=None):
    return f'<text x="{x}" y="{y}" class="{cls}"' + (f' text-anchor="{anchor}"' if anchor else '') + f'>{html.escape(value)}</text>'


def card(x, y, w, h, fill='#ffffff', stroke=LINE, kind='card', dashed=False, rx=10):
    dash = ' stroke-dasharray="7 6"' if dashed else ''
    return f'<rect data-kind="{kind}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dash}/>'


def arrow(d, name, dashed=False, both=False):
    dash = ' stroke-dasharray="7 6"' if dashed else ''
    start = ' marker-start="url(#arrow-back)"' if both else ''
    return f'<path class="connector" data-arrow="{name}" d="{d}" marker-end="url(#arrow)"{start}{dash}/>'


def ink(x, y, size):
    return f'<g aria-hidden="true" transform="translate({x} {y}) scale({size / 100})"><path fill="{INK}" d="M76 6C43-6 8 15 5 49 1 83 25 99 54 97c28-1 45-17 44-41-1-18-9-21-16-24C66 26 72 15 76 6Z"/><ellipse fill="{PAPER}" cx="56" cy="54" rx="5.7" ry="9.5" transform="rotate(-18 56 54)"/><ellipse fill="{PAPER}" cx="76" cy="45" rx="5.1" ry="8.8" transform="rotate(-18 76 45)"/></g>'


def wave(x, y):
    """A plain waveform for ngspice, which has no published mark."""
    return f'<path aria-hidden="true" d="M{x} {y + 12}c5-16 10-16 15 0s10 16 15 0" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>'


def worker(name, y, h, mark, title, lines):
    """One row of the build workers column."""
    out = [f'<g data-node-id="{name}">', card(810, y, 338, h), mark]
    out.append(text(858, y + 24, title, 'item'))
    for i, line in enumerate(lines):
        out.append(text(858, y + 46 + i * 21, line))
    out.append('</g>')
    return ''.join(out)


def stage(x, y, w, h, lines, cls, fill='#ffffff', stroke=LINE):
    """A cell of the agents table, with its lines centred."""
    cx = x + w / 2
    first = y + h / 2 + 6 - (len(lines) - 1) * 10.5
    return card(x, y, w, h, fill, stroke) + ''.join(text(cx, first + i * 21, line, cls, 'middle') for i, line in enumerate(lines))


AGENT_X = [52, 182.8, 313.6, 444.4, 575.2]
AGENT_W = 116.8
ROLES = [['Verifier'], ['Designer', 'Block Author'], ['Reviewer'], ['Firmware'], ['Fixer', 'Editor']]
GATES = [['Requirements'], ['ERC, SPICE'], ['Review'], ['Compile'], ['Build, DRC']]

svg = [
    f'<svg class="architecture" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="moki-architecture-title moki-architecture-desc">',
    '<title id="moki-architecture-title">Moki architecture</title>',
    '<desc id="moki-architecture-desc">A browser reaches a Node server through a private gateway. The server runs agent turns and one build at a time. Narrow model agents share one plan, code gates check it, and subprocess workers produce the board, case and firmware. Agents read a parts catalog, datasheets and a block library. Datasheet layout parsing on Modal and per-build micro-VMs on Fly.io are proposed, not built.</desc>',
    '<style>__STYLE__</style>',
    f'<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="m1 1 7 3.5-7 3.5" fill="none" stroke="{CONNECTOR}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>',
    f'<marker id="arrow-back" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M8 1 1 4.5 8 8" fill="none" stroke="{CONNECTOR}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>',
    *[symbol(name) for name in MARKS], '</defs>',
    f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{PAPER}"/>',

    # Header and legend.
    ink(32, 26, 46), text(90, 62, 'Moki architecture', 'title'),
    f'<path class="connector" d="M868 44H908" marker-end="url(#arrow)"/>', text(918, 50, 'Implemented, as of 6 Nov 2026'),
    f'<path class="connector" d="M868 70H908" stroke-dasharray="7 6" marker-end="url(#arrow)"/>', text(918, 76, 'Proposed, not built'),

    # Zones first, so arrows and cards sit on top of them.
    card(32, 342, 1136, 176, PAPER_2, LINE, 'zone', rx=14),
    card(32, 590, 680, 366, PAPER_2, LINE, 'zone', rx=14),
    card(790, 590, 378, 366, PAPER_2, LINE, 'zone', rx=14),
    card(32, 1024, 680, 188, PAPER_2, LINE, 'zone', rx=14),

    # Relationships. Straight runs only, each with its own ports, and none passes through a card.
    arrow('M600 214V256', 'web-gateway', both=True),
    arrow('M600 300V342', 'gateway-server', both=True),
    arrow('M450 498V590', 'agent-api-agents'),
    arrow('M640 590V548H880V498', 'agents-board-api'),
    arrow('M1030 498V590', 'board-api-workers'),
    arrow('M712 800H790', 'agents-workers'),
    arrow('M366 956V1024', 'agents-parts'),
    arrow('M979 1040V956', 'fly-workers', dashed=True),
    arrow('M790 1166H692', 'nemotron-datasheets', dashed=True),

    # Web.
    '<g data-node-id="web">', card(32, 100, 1136, 114),
    text(56, 136, 'Web', 'name'),
    logo('react', 862, 118, 22), text(890, 135, 'React', 'tech'),
    logo('vite', 958, 118, 22), text(986, 135, 'Vite', 'tech'),
    logo('threejs', 1038, 118, 22), text(1066, 135, 'Three.js', 'tech'),
    text(56, 168, 'Blue landing and project gallery, with server-rendered thumbnails'),
    text(56, 193, 'Project studio: schematic canvas with editing, plus PCB, 3D, Case and Firmware tabs'),
    '</g>',
    text(612, 241, 'HTTPS: JSON, build files, SSE events', 'label'),

    # Gateway.
    '<g data-node-id="gateway">', card(32, 256, 1136, 44),
    text(600, 284, 'Sogo Apps gateway: a private, authenticated link', 'item', 'middle'), '</g>',

    # Server.
    text(52, 376, 'Server', 'name'), logo('nodejs', 136, 359, 22), text(164, 376, 'Node', 'tech'),
    logo('typescript', 216, 360, 20), text(242, 376, 'TypeScript', 'tech'),
    text(1148, 376, 'APIs are Vite plugins in server/', 'body', 'end'),
    '<g data-node-id="project-api">', card(52, 392, 340, 106),
    text(72, 422, 'project-api', 'item'), text(72, 448, 'Projects and gallery summaries'), text(72, 472, 'Saved as JSON and files in var/'), '</g>',
    '<g data-node-id="agent-api">', card(412, 392, 340, 106),
    text(432, 422, 'agent-api', 'item'), text(432, 448, 'Runs agent turns'), text(432, 472, 'Streams each step over SSE'), '</g>',
    '<g data-node-id="board-api">', card(772, 392, 376, 106),
    text(792, 422, 'board-api', 'item'), text(792, 448, 'One build at a time, up to 5 waiting'), text(792, 472, 'Serves build files and thumbnails'), '</g>',

    # Edge labels between the server and the two columns.
    text(460, 576, 'starts a turn', 'label'),
    text(650, 576, 'the job API the studio uses', 'label'),
    text(1040, 576, 'spawns', 'label'),

    # Agents: models above the plan, code below it.
    logo('openai', 52, 608, 26), text(86, 628, 'Agents', 'name'),
    text(168, 628, 'gpt-6.1-sol, swappable in src/agents/model.ts'),
    text(692, 628, '$2 cap per turn', 'body', 'end'),
    text(52, 666, 'Models decide', 'caption'),
    *[f'<g data-node-id="role-{i}">' + stage(x, 678, AGENT_W, 64, lines, 'cell') + '</g>' for i, (x, lines) in enumerate(zip(AGENT_X, ROLES))],
    *[f'<path class="connector" data-arrow="role-{i}" d="M{AGENT_X[i] + AGENT_W} 710H{AGENT_X[i + 1]}" marker-end="url(#arrow)"/>' for i in range(4)],
    '<g data-node-id="plan">', card(52, 758, 640, 56, BLUE_TINT, BLUE),
    text(372, 792, 'One shared plan, the source of truth', 'name-small', 'middle'), '</g>',
    *[f'<g data-node-id="gate-{i}">' + stage(x, 830, AGENT_W, 52, lines, 'cell') + '</g>' for i, (x, lines) in enumerate(zip(AGENT_X, GATES))],
    text(52, 908, 'Code gates', 'caption'),
    text(52, 932, 'A failed gate stops the build, or goes to the Fixer for at most 2 tries'),

    # Build workers.
    text(810, 626, 'Build workers', 'name'),
    text(810, 652, 'Subprocesses: timeout, env allowlist'),
    text(722, 770, 'SPICE,', 'label'), text(722, 790, 'compile', 'label'),
    worker('tscircuit', 666, 82, tscircuit_logo(820, 678) + logo('bun', 1116, 676, 22), 'tscircuit in Bun, eda/', ['Schematic, PCB, autorouting,', 'Gerbers, BOM, GLB, KiCad export']),
    worker('build123d', 754, 58, logo('python', 824, 770, 26), 'build123d in Python, mech/', ['Case STEP and STL']),
    worker('platformio', 818, 58, logo('platformio', 824, 834, 26), 'PlatformIO, firmware', ['Model code: no-network sandbox']),
    worker('ngspice', 882, 58, wave(822, 899), 'ngspice', ['SPICE checks, run through Bun']),

    # Parts and evidence.
    text(52, 1058, 'Parts and evidence', 'name'),
    '<g data-node-id="catalog">', card(52, 1074, 204, 118),
    text(68, 1102, 'Catalog', 'item'), text(68, 1128, 'JLCPCB and LCSC'), text(68, 1150, 'via jlcsearch, plus'), text(68, 1172, 'EasyEDA importer'), '</g>',
    '<g data-node-id="blocks">', card(270, 1074, 204, 118),
    text(286, 1102, 'Block library', 'item'), text(286, 1128, 'Reusable circuits,'), text(286, 1150, 'with review receipts'), '</g>',
    '<g data-node-id="datasheets">', card(488, 1074, 204, 118),
    text(504, 1102, 'Datasheets', 'item'), text(504, 1128, 'Read with pdf.js;'), text(504, 1150, 'code checks every'), text(504, 1172, 'citation'), '</g>',
    text(376, 996, 'reads parts, blocks, datasheets', 'label'),

    # Proposed. Dashed, and each says so in words too.
    '<g data-node-id="fly">', card(790, 1040, 378, 72, PAPER, CONNECTOR, dashed=True),
    logo('fly', 810, 1062, 28), text(852, 1070, 'A micro-VM per build, on Fly.io', 'item'), text(852, 1094, 'Proposed'), '</g>',
    text(989, 1006, 'proposed', 'label'),
    '<g data-node-id="nemotron">', card(790, 1128, 378, 84, PAPER, CONNECTOR, dashed=True),
    logo('nvidia', 810, 1140, 26), logo('modal', 810, 1174, 26),
    text(852, 1158, 'Nemotron 3.5 Parse on Modal', 'item'), text(852, 1182, 'Accepted, being integrated: ADR 0003'), '</g>',
    text(715, 1156, 'proposed', 'label'),
    '</svg>',
]

try:
    FONT_DATA = base64.b64encode(FONT.read_bytes()).decode()
except FileNotFoundError:
    sys.exit('Manrope is missing. Run npm ci first.')

STYLE = f'''@font-face{{font-family:"Manrope Variable";font-weight:200 800;src:url(data:font/woff2;base64,{FONT_DATA}) format("woff2")}}
svg.architecture{{color:{INK};font-family:"Manrope Variable",sans-serif}}
.title{{font-size:32px;font-weight:700;letter-spacing:-1px;fill:{INK}}}
.name{{font-size:22px;font-weight:700;letter-spacing:-.3px;fill:{INK}}}
.name-small{{font-size:20px;font-weight:700;letter-spacing:-.2px;fill:{INK}}}
.item{{font-size:17px;font-weight:650;letter-spacing:-.1px;fill:{INK}}}
.cell{{font-size:16px;font-weight:600;letter-spacing:-.15px;fill:{INK}}}
.body{{font-size:16px;font-weight:500;fill:{MUTED}}}
.tech{{font-size:16px;font-weight:600;fill:{INK}}}
.label{{font-size:16px;font-weight:500;fill:{MUTED}}}
.caption{{font-size:16px;font-weight:700;fill:{INK}}}
.connector{{fill:none;stroke:{CONNECTOR};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}'''

drawing = ''.join(svg).replace('__STYLE__', STYLE)
PAGE_STYLE = f'*{{box-sizing:border-box}}html,body{{margin:0;background:{PAPER}}}main{{max-width:{WIDTH}px;margin:0 auto}}div{{overflow-x:auto}}svg.architecture{{display:block;width:100%;height:auto;min-width:760px}}'
page = f'<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Moki architecture</title><style>{PAGE_STYLE}</style></head><body><main><div>{drawing}</div></main></body></html>\n'

OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
OUT_HTML.write_text(page)
OUT_SVG.write_text(drawing + '\n')
print(f'Built {OUT_HTML.relative_to(ROOT)} and {OUT_SVG.relative_to(ROOT)}')


def chrome():
    found = os.environ.get('MOKI_CHROME') or next(filter(None, map(shutil.which, ['chromium', 'chromium-browser', 'google-chrome'])), None)
    if found:
        return found
    cached = sorted(glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium*/*/chrome*')))
    return next((path for path in cached if os.access(path, os.X_OK) and os.path.isfile(path)), None)


browser = chrome()
if not browser:
    sys.exit('No Chromium found, so the PNG was not rebuilt. Set MOKI_CHROME.')
subprocess.run([browser, '--headless', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2',
                f'--window-size={WIDTH},{HEIGHT}', '--virtual-time-budget=3000', f'--screenshot={OUT_PNG}', OUT_SVG.as_uri()],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f'Built {OUT_PNG.relative_to(ROOT)} ({OUT_PNG.stat().st_size:,} bytes)')
