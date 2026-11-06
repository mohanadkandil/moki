"""Build Moki's architecture diagram from local assets.

Run from anywhere: python3 scripts/render-architecture.py

Writes web/public/architecture/index.html, docs/diagrams/moki-architecture.svg and
docs/media/architecture-2026-11.png. The PNG needs a Chromium binary: set MOKI_CHROME, or have one
on PATH or in the Playwright cache. The script makes no model or network calls.

The layout is drawn for a 1200-unit width because GitHub shows the PNG about 830 px wide. Readable
text stays at 16 units or more; only the quiet small-caps labels go below that. The paper has
rounded, transparent corners so it sits well on GitHub's light and dark pages.

Every node here was read from the code, and docs/diagrams/README.md lists the source of each one.
The pictures in assets/evidence are crops of real output, listed in assets/sources.json.
"""
from pathlib import Path
import base64, glob, html, math, os, shutil, subprocess, sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/diagrams/assets'
FONT = ROOT / 'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'
OUT_HTML = ROOT / 'web/public/architecture/index.html'
OUT_SVG = ROOT / 'docs/diagrams/moki-architecture.svg'
OUT_PNG = ROOT / 'docs/media/architecture-2026-11.png'

WIDTH, HEIGHT = 1200, 1444
PAPER, PAPER_2, INK, MUTED, QUIET, LINE, CONNECTOR, BLUE, BLUE_LIGHT = (
    '#f8f7f3', '#f0efea', '#252525', '#5f5f58', '#6b6b63', '#dcdcd3', '#6f6f69', '#139df2', '#80ccfa')
MARKS = ['react', 'vite', 'threejs', 'nodejs', 'typescript', 'openai', 'bun', 'python', 'platformio', 'nvidia', 'modal']


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


def embedded(path, kind):
    return f'data:image/{kind};base64,' + base64.b64encode((ASSETS / path).read_bytes()).decode()


def tscircuit_logo(x, y, size=28):
    return f'<image aria-hidden="true" href="{embedded("tscircuit.png", "png")}" x="{x}" y="{y}" width="{size}" height="{size}"/>'


def text(x, y, value, cls='body', anchor=None):
    return f'<text x="{x}" y="{y}" class="{cls}"' + (f' text-anchor="{anchor}"' if anchor else '') + f'>{html.escape(value)}</text>'


def card(x, y, w, h, fill='#ffffff', stroke=LINE, kind='card', rx=12):
    return f'<rect data-kind="{kind}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>'


def arrow(d, name, both=False):
    start = ' marker-start="url(#arrow-back)"' if both else ''
    return f'<path class="connector" data-arrow="{name}" d="{d}" marker-end="url(#arrow)"{start}/>'


def ink(x, y, size, eye=PAPER):
    return f'<g aria-hidden="true" transform="translate({x} {y}) scale({size / 100})"><path fill="{INK}" d="M76 6C43-6 8 15 5 49 1 83 25 99 54 97c28-1 45-17 44-41-1-18-9-21-16-24C66 26 72 15 76 6Z"/><ellipse fill="{eye}" cx="56" cy="54" rx="5.7" ry="9.5" transform="rotate(-18 56 54)"/><ellipse fill="{eye}" cx="76" cy="45" rx="5.1" ry="8.8" transform="rotate(-18 76 45)"/></g>'


_clips = []


def picture(name, x, y, w, h, clip, rx=0):
    """A real image cropped to a box. `clip` is the card it may not leave, so it can bleed to that card's edge."""
    cid = f'clip-{name}'
    _clips.append(f'<clipPath id="{cid}"><rect x="{clip[0]}" y="{clip[1]}" width="{clip[2]}" height="{clip[3]}" rx="{clip[4]}"/></clipPath>')
    corner = f' rx="{rx}"' if rx else ''
    return (f'<g clip-path="url(#{cid})"><image data-picture="{name}" href="{embedded(f"evidence/{name}.jpg", "jpeg")}" x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="xMidYMid slice"/></g>')


def dither(x0, y0, cols, rows, cell, value, solid, band, fringe):
    """The landing's stepped field: solid colour, a lighter dotted band, then scattered dots on paper."""
    paths = {'solid': [], 'band': [], 'fringe': []}
    for i in range(cols):
        for j in range(rows):
            v = value(i, j)
            key = 'solid' if v < solid else 'band' if v < band else 'fringe' if v < fringe else None
            if key:
                paths[key].append(f'M{x0 + i * cell} {y0 + j * cell}h{cell}v{cell}h-{cell}z')
    return (f'<path d="{"".join(paths["fringe"])}" fill="url(#dots-blue)"/>'
            f'<path d="{"".join(paths["band"])}" fill="{BLUE_LIGHT}"/><path d="{"".join(paths["band"])}" fill="url(#dots-paper)"/>'
            f'<path d="{"".join(paths["solid"])}" fill="{BLUE}"/>')


def corner_field():
    cols, rows, cell = 42, 10, 12
    x0 = WIDTH - cols * cell

    def value(i, j):
        fromright, fromtop = cols - 1 - i, j
        return fromright * .62 + fromtop * 1.75 + 1.7 * math.sin(fromright * .42) + 1.3 * math.sin(fromtop * .9 + fromright * .23)
    return dither(x0, 0, cols, rows, cell, value, 10, 16.5, 23)


def spine_field(x, y, w, h):
    """Dotted steps at the foot of the plan spine, cut from the same material as the landing."""
    cell = 10
    cols, rows = w // cell, 11

    def value(i, j):
        fromfoot = rows - 1 - j
        return fromfoot * 1.5 + 2.2 * math.sin(i * .95 + 1) + 1.1 * math.sin(i * 2.1)
    return dither(x, y + h - rows * cell, cols, rows, cell, value, -99, 7, 11)


def gate_mark(x, y):
    return f'<path aria-hidden="true" d="M{x} {y + 7}l5 5 9-11" fill="none" stroke="{INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'


def lock(x, y):
    return f'<g aria-hidden="true" fill="none" stroke="{INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="{x}" y="{y + 8}" width="16" height="11" rx="2.5"/><path d="M{x + 3.5} {y + 8}v-3a4.5 4.5 0 0 1 9 0v3"/></g>'


def wave(x, y):
    """A plain waveform for ngspice, which has no published mark."""
    return f'<path aria-hidden="true" d="M{x} {y + 12}c4-16 8-16 13 0s9 16 13 0" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>'


ROLES = [('Verifier', 'Turns words into requirements'),
         ('Designer, Block Author', 'Write the plan and new blocks'),
         ('Reviewer', 'Checks against datasheets'),
         ('Firmware', 'Writes the app code'),
         ('Fixer, Editor', 'Bounded repairs, your changes')]
GATES = ['Requirements', 'ERC, SPICE', 'Review', 'Compile', 'Build, DRC']

T = 586                     # Top of the agents and workers row.
ROW_Y = [T + 104 + i * 82 for i in range(5)]
ROW_H = 68


def agents():
    out = [logo('openai', 60, T + 18, 28), text(98, T + 41, 'Agents', 'name'),
           text(680, T + 40, '$2 CAP PER TURN', 'caps', 'end'),
           text(60, T + 68, 'gpt-6.1-sol, swappable in src/agents/model.ts'),
           text(60, T + 94, 'MODELS DECIDE', 'caps'), text(466, T + 94, 'CODE CHECKS', 'caps')]
    # Stubs join each row to the plan. Every role and gate works on that one object.
    for y in ROW_Y:
        out.append(f'<path class="stub" d="M322 {y + ROW_H / 2}H344M444 {y + ROW_H / 2}H466"/>')
    # The plan: the one blue thing on the page, in the landing's own material.
    spine_h = ROW_Y[-1] + ROW_H - ROW_Y[0]
    x, y, w = 344, ROW_Y[0], 100
    out.append(f'<clipPath id="clip-spine"><rect x="{x}" y="{y}" width="{w}" height="{spine_h}" rx="14"/></clipPath>')
    out += ['<g data-node-id="plan">', f'<rect data-kind="card" x="{x}" y="{y}" width="{w}" height="{spine_h}" rx="14" fill="{BLUE}"/>',
            f'<g clip-path="url(#clip-spine)">{spine_field(x, y, w, spine_h)}</g>',
            f'<circle cx="{x + 50}" cy="{y + 44}" r="28" fill="{PAPER}"/>', ink(x + 31, y + 25, 38),
            text(x + 50, y + 106, 'One', 'plan', 'middle'), text(x + 50, y + 130, 'shared', 'plan', 'middle'), text(x + 50, y + 154, 'plan', 'plan', 'middle'),
            text(x + 50, y + 186, 'the source', 'plan-small', 'middle'), text(x + 50, y + 207, 'of truth', 'plan-small', 'middle'), '</g>']
    for i, ((title, job), y) in enumerate(zip(ROLES, ROW_Y)):
        out += [f'<g data-node-id="role-{i}">', card(60, y, 262, ROW_H), text(78, y + 29, title, 'item'), text(78, y + 52, job), '</g>']
    for i in range(4):
        out.append(f'<path class="connector" data-arrow="role-{i}" d="M191 {ROW_Y[i] + ROW_H}V{ROW_Y[i + 1]}" marker-end="url(#arrow)"/>')
    for i, (title, y) in enumerate(zip(GATES, ROW_Y)):
        out += [f'<g data-node-id="gate-{i}">', card(466, y, 214, ROW_H), gate_mark(484, y + 28), text(512, y + 40, title, 'item'), '</g>']
    out.append(text(60, T + 532, 'A failed gate stops the build, or goes to the Fixer for at most 2 tries'))
    return out


def workers():
    x, w = 806, 338
    y1, h1 = T + 76, 198
    out = [text(806, T + 38, 'Build workers', 'name'), text(806, T + 63, 'Subprocesses: timeout, env allowlist')]
    clip = (x, y1, w, h1, 12)
    out += ['<g data-node-id="tscircuit">', card(x, y1, w, h1),
            picture('schematic', x, y1, w / 2, 116, clip), picture('board', x + w / 2, y1, w / 2, 116, clip),
            tscircuit_logo(x + 12, y1 + 128), text(x + 50, y1 + 147, 'tscircuit in Bun, eda/', 'item'), logo('bun', x + w - 34, y1 + 127, 22),
            text(x + 50, y1 + 169, 'Schematic, PCB, autorouting,'), text(x + 50, y1 + 189, 'Gerbers, BOM, GLB, KiCad export'),
            card(x, y1, w, h1, 'none'), '</g>']
    y2, h2 = y1 + h1 + 8, 104
    out += ['<g data-node-id="build123d">', card(x, y2, w, h2),
            picture('case', x + w - 136, y2, 136, h2, (x, y2, w, h2, 12)),
            logo('python', x + 14, y2 + 18, 26), text(x + 50, y2 + 36, 'build123d, mech/', 'item'),
            text(x + 50, y2 + 60, 'Case STEP and STL,'), text(x + 50, y2 + 81, 'in Python'),
            card(x, y2, w, h2, 'none'), '</g>']
    y3 = y2 + h2 + 8
    out += [f'<g data-node-id="platformio">', card(x, y3, w, 66), logo('platformio', x + 14, y3 + 20, 26),
            text(x + 50, y3 + 29, 'PlatformIO, firmware', 'item'), text(x + 50, y3 + 52, 'Model code: no-network sandbox'), '</g>']
    y4 = y3 + 66 + 8
    out += ['<g data-node-id="ngspice">', card(x, y4, w, 66), wave(x + 12, y4 + 21),
            text(x + 50, y4 + 29, 'ngspice', 'item'), text(x + 50, y4 + 52, 'SPICE checks, run through Bun'), '</g>']
    return out


web = ['<g data-node-id="web">', card(40, 136, 1120, 124), text(64, 174, 'Web', 'name'),
       logo('react', 124, 156, 22), text(151, 173, 'React', 'tech'), logo('vite', 214, 156, 22), text(241, 173, 'Vite', 'tech'),
       logo('threejs', 288, 156, 22), text(315, 173, 'Three.js', 'tech'),
       text(64, 208, 'Blue landing and project gallery with server-rendered thumbnails'),
       text(64, 233, 'Studio: schematic canvas with editing; PCB, 3D, Case, Firmware tabs'),
       # Real screens, running off the card's foot rather than floating inside it.
       picture('landing', 676, 152, 230, 108, (676, 152, 230, 120, 8)), f'<rect x="676" y="152" width="230" height="130" rx="8" fill="none" stroke="{LINE}" stroke-width="1.5" clip-path="url(#clip-web)"/>',
       picture('studio', 918, 152, 226, 108, (918, 152, 226, 120, 8)), f'<rect x="918" y="152" width="226" height="130" rx="8" fill="none" stroke="{LINE}" stroke-width="1.5" clip-path="url(#clip-web)"/>',
       '</g>']
_clips.append('<clipPath id="clip-web"><rect x="40" y="136" width="1120" height="124"/></clipPath>')

body = [
    # Paper and the dotted corner.
    f'<clipPath id="clip-paper"><rect width="{WIDTH}" height="{HEIGHT}" rx="28"/></clipPath>',
    f'<g clip-path="url(#clip-paper)"><rect width="{WIDTH}" height="{HEIGHT}" fill="{PAPER}"/>{corner_field()}</g>',

    # Headline.
    ink(40, 22, 62), text(116, 68, 'Moki, under the hood.', 'title'),
    text(40, 112, 'Models decide. Code builds and checks. One plan holds it together.', 'tagline'),

    # Zones first, so arrows and cards sit on top of them.
    card(40, 370, 1120, 156, PAPER_2, LINE, 'zone', rx=16),
    card(40, T, 660, 550, PAPER_2, LINE, 'zone', rx=16),
    card(790, T, 370, 550, PAPER_2, LINE, 'zone', rx=16),
    card(40, 1200, 660, 164, PAPER_2, LINE, 'zone', rx=16),

    # Relationships, unchanged from the code. Straight runs, each with its own ports.
    arrow('M600 260V294', 'web-gateway', both=True),
    arrow('M600 336V370', 'gateway-server', both=True),
    arrow('M450 510V586', 'agent-api-agents'),
    arrow(f'M640 {T}V548H880V510', 'agents-board-api'),
    arrow(f'M1030 510V{T}', 'board-api-workers'),
    arrow('M700 842H790', 'agents-workers'),
    arrow('M370 1136V1200', 'agents-parts'),
    arrow('M790 1300H684', 'nemotron-datasheets'),

    *web,
    text(612, 282, 'HTTPS: JSON, BUILD FILES, SSE EVENTS', 'caps'),

    # Gateway.
    '<g data-node-id="gateway">', card(40, 294, 1120, 42), lock(416, 303),
    text(442, 321, 'Sogo Apps gateway: a private, authenticated link', 'item'), '</g>',

    # Server.
    text(60, 408, 'Server', 'name'), logo('nodejs', 148, 390, 22), text(175, 407, 'Node', 'tech'),
    logo('typescript', 228, 391, 20), text(255, 407, 'TypeScript', 'tech'),
    text(1140, 407, 'VITE-PLUGIN APIS IN SERVER/', 'caps', 'end'),
    '<g data-node-id="project-api">', card(56, 420, 340, 90),
    text(76, 448, 'project-api', 'item'), text(76, 472, 'Projects and gallery summaries'), text(76, 494, 'Saved as JSON and files in var/'), '</g>',
    '<g data-node-id="agent-api">', card(412, 420, 340, 90),
    text(432, 448, 'agent-api', 'item'), text(432, 472, 'Runs agent turns'), text(432, 494, 'Streams each step over SSE'), '</g>',
    '<g data-node-id="board-api">', card(768, 420, 376, 90),
    text(788, 448, 'board-api', 'item'), text(788, 472, 'One build at a time, up to 5 waiting'), text(788, 494, 'Serves build files and thumbnails'), '</g>',

    # Edge labels between the server and the two columns.
    text(460, 572, 'STARTS A TURN', 'caps'),
    text(650, 572, 'THE JOB API THE STUDIO USES', 'caps'),
    text(1040, 572, 'SPAWNS', 'caps'),
    text(708, 814, 'SPICE,', 'caps'), text(708, 832, 'COMPILE', 'caps'),

    *agents(),
    *workers(),

    # Parts and evidence.
    text(60, 1236, 'Parts and evidence', 'name'),
    text(380, 1174, 'READS PARTS, BLOCKS, DATASHEETS', 'caps'),
    '<g data-node-id="catalog">', card(56, 1248, 200, 104),
    text(72, 1274, 'Catalog', 'item'), text(72, 1298, 'JLCPCB and LCSC'), text(72, 1319, 'via jlcsearch, plus'), text(72, 1340, 'EasyEDA importer'), '</g>',
    '<g data-node-id="blocks">', card(270, 1248, 200, 104),
    text(286, 1274, 'Block library', 'item'), text(286, 1298, 'Reusable circuits,'), text(286, 1319, 'with review receipts'), '</g>',
    '<g data-node-id="datasheets">', card(484, 1248, 200, 104),
    text(500, 1274, 'Datasheets', 'item'), text(500, 1298, 'Read with pdf.js;'), text(500, 1319, 'code checks every'), text(500, 1340, 'citation'), '</g>',

    # The parse service feeds Datasheets, with pdf.js as its fallback.
    '<g data-node-id="nemotron">', card(790, 1200, 370, 164),
    logo('nvidia', 814, 1220, 24), text(846, 1238, 'NVIDIA', 'tech'), logo('modal', 924, 1220, 24), text(956, 1238, 'Modal', 'tech'),
    text(814, 1284, 'Nemotron 3.5 Parse', 'item'), text(814, 1310, 'Datasheet tables and layout'), text(814, 1336, 'Runs on Modal; pdf.js is the fallback'), '</g>',
    text(712, 1290, 'PAGES', 'caps'),

    # Footer: the date and the honest limit.
    f'<path d="M40 1388H1160" stroke="{LINE}" stroke-width="1.5"/>',
    text(40, 1420, 'Board pictures are real output from one temp-monitor build. Nothing has been fabricated or powered.'),
    text(1160, 1419, 'READ FROM THE CODE · 6 NOV 2026', 'caps', 'end'),
]

svg = [
    f'<svg class="architecture" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="moki-architecture-title moki-architecture-desc">',
    '<title id="moki-architecture-title">Moki, under the hood</title>',
    '<desc id="moki-architecture-desc">A browser reaches a Node server through a private gateway. The server runs agent turns and one build at a time. Narrow model agents share one plan, code gates check it, and subprocess workers produce the schematic, PCB, case and firmware, shown here with real output from one build. Agents read a parts catalog, datasheets and a block library. Nemotron 3.5 Parse on Modal reads datasheet tables and layout.</desc>',
    '<style>__STYLE__</style>',
    f'<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="m1 1 7 3.5-7 3.5" fill="none" stroke="{CONNECTOR}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>',
    f'<marker id="arrow-back" markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M8 1 1 4.5 8 8" fill="none" stroke="{CONNECTOR}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>',
    f'<pattern id="dots-blue" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="2" height="2" fill="{BLUE}"/></pattern>',
    f'<pattern id="dots-paper" width="4" height="4" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="2" height="2" fill="{PAPER}" opacity=".85"/></pattern>',
    *[symbol(name) for name in MARKS], *_clips, '</defs>',
    *body,
    '</svg>',
]

try:
    FONT_DATA = base64.b64encode(FONT.read_bytes()).decode()
except FileNotFoundError:
    sys.exit('Manrope is missing. Run npm ci first.')

STYLE = f'''@font-face{{font-family:"Manrope Variable";font-weight:200 800;src:url(data:font/woff2;base64,{FONT_DATA}) format("woff2")}}
svg.architecture{{color:{INK};font-family:"Manrope Variable",sans-serif}}
.title{{font-size:46px;font-weight:650;letter-spacing:-2px;fill:{INK}}}
.tagline{{font-size:21px;font-weight:450;letter-spacing:-.2px;fill:{MUTED}}}
.name{{font-size:24px;font-weight:700;letter-spacing:-.5px;fill:{INK}}}
.plan{{font-size:21px;font-weight:750;letter-spacing:-.3px;fill:{INK}}}
.plan-small{{font-size:16px;font-weight:600;fill:{INK}}}
.item{{font-size:18px;font-weight:680;letter-spacing:-.2px;fill:{INK}}}
.body{{font-size:16px;font-weight:500;fill:{MUTED}}}
.tech{{font-size:16px;font-weight:600;fill:{INK}}}
.caps{{font-size:13.5px;font-weight:700;letter-spacing:1px;fill:{QUIET}}}
.connector{{fill:none;stroke:{CONNECTOR};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}}
.stub{{fill:none;stroke:{CONNECTOR};stroke-width:1.75}}'''

drawing = ''.join(svg).replace('__STYLE__', STYLE)
PAGE_STYLE = f'*{{box-sizing:border-box}}html,body{{margin:0;background:#fff}}@media (prefers-color-scheme:dark){{html,body{{background:#0d1117}}}}main{{max-width:{WIDTH}px;margin:0 auto}}div{{overflow-x:auto}}svg.architecture{{display:block;width:100%;height:auto;min-width:760px}}'
page = f'<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Moki, under the hood</title><style>{PAGE_STYLE}</style></head><body><main><div>{drawing}</div></main></body></html>\n'

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
subprocess.run([browser, '--headless', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--default-background-color=00000000',
                f'--window-size={WIDTH},{HEIGHT}', '--virtual-time-budget=3000', f'--screenshot={OUT_PNG}', OUT_SVG.as_uri()],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(f'Built {OUT_PNG.relative_to(ROOT)} ({OUT_PNG.stat().st_size:,} bytes)')
