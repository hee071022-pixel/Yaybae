"""Generate EDIF 2 0 0 schematic (for OrCAD Capture: File > Import Design > EDIF)
and a Telesis netlist (for Allegro PCB Editor: File > Import > Logic > Other)."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------- symbol library (units: mil, pin ends on 100mil grid) -------------
# pins: (pinNumber, name, x, y, stub_dx, stub_dy)  stub goes from pin end toward body
SYMS = {
 'RES':    dict(pins=[('1','1',0,0,100,0), ('2','2',300,0,-100,0)],
                body=[[(100,0),(117,30),(150,-30),(183,30),(200,0)]], fp='RES400'),
 'CAP':    dict(pins=[('1','1',0,0,130,0), ('2','2',300,0,-130,0)],
                body=[[(130,60),(130,-60)], [(170,60),(170,-60)]], fp='CAP200'),
 'CAPPOL': dict(pins=[('1','+',0,0,130,0), ('2','-',300,0,-130,0)],
                body=[[(130,60),(130,-60)], [(170,60),(170,-60)], [(90,50),(110,50)], [(100,40),(100,60)]], fp='CAPPOL200'),
 'DIODE':  dict(pins=[('2','A',0,0,120,0), ('1','K',300,0,-120,0)],
                body=[[(120,50),(120,-50),(180,0),(120,50)], [(180,50),(180,-50)]], fp='DIODE400'),
 'ZENER':  dict(pins=[('2','A',0,0,120,0), ('1','K',300,0,-120,0)],
                body=[[(120,50),(120,-50),(180,0),(120,50)], [(165,65),(180,50),(180,-50),(195,-65)]], fp='DIODE400'),
 'POT':    dict(pins=[('1','1',0,0,100,0), ('3','3',300,0,-100,0), ('2','2',150,200,0,-150)],
                body=[[(100,0),(117,30),(150,-30),(183,30),(200,0)], [(135,65),(150,50),(165,65)]], fp='POT3'),
 'NPN':    dict(pins=[('3','B',0,0,100,0), ('2','C',200,200,0,-100), ('1','E',200,-200,0,100)],
                body=[[(100,70),(100,-70)], [(100,30),(200,100)], [(100,-30),(200,-100)], [(170,-70),(200,-100),(160,-95)]], fp='TO92'),
 'NJFET':  dict(pins=[('2','G',0,0,100,0), ('3','D',200,200,0,-130), ('1','S',200,-200,0,130)],
                body=[[(100,0),(130,0)], [(130,80),(130,-80)], [(130,70),(200,70)], [(130,-70),(200,-70)], [(110,15),(130,0),(110,-15)]], fp='TO92'),
 'OPAMP':  dict(pins=[('2','IN-',0,100,100,0), ('3','IN+',0,-100,100,0), ('6','OUT',500,0,-100,0),
                     ('7','V+',200,300,0,-100), ('4','V-',200,-300,0,100),
                     ('5','N2',300,300,0,-150), ('1','N1',300,-300,0,150)],
                body=[[(100,250),(100,-250),(400,0),(100,250)], [(120,100),(160,100)], [(120,-100),(160,-100)], [(140,-80),(140,-120)]], fp='DIP8'),
 'CON3':   dict(pins=[('1','1',0,0,-100,0), ('2','2',0,-100,-100,0), ('3','3',0,-200,-100,0)],
                body=[[(-100,50),(-200,50),(-200,-250),(-100,-250),(-100,50)]], fp='HDR3'),
 'CON2':   dict(pins=[('1','1',0,0,-100,0), ('2','2',0,-100,-100,0)],
                body=[[(-100,50),(-200,50),(-200,-150),(-100,-150),(-100,50)]], fp='HDR2'),
}

# ---------------- parts: ref, symbol, value, x, y (mil), rotation -------------------
P = []
def part(ref, sym, val, x, y, rot=0): P.append((ref, sym, val, x, y, rot))
# U1 oscillator block (top-left)
part('U1','OPAMP','LF356', 3000, 6000)
part('VR1','POT','4.7k', 2700, 6700)
part('R9','RES','3k', 1900, 6100)
part('Q2','NJFET','K30', 1300, 5300)
part('R11','RES','100k', 1300, 6600)
part('R12','RES','100k', 1200, 3300)
part('R5','RES','3k', 2500, 5000)
part('C1','CAP','0.0047uF', 3200, 5000)
part('R10','RES','3k', 2200, 4300, 90)
part('C3','CAP','0.0047uF', 1800, 4300, 90)
# U2 block (top-right)
part('C2','CAPPOL','1uF', 4000, 6000)
part('R8','RES','10k', 4500, 6000)
part('U2','OPAMP','LF356', 5200, 6000)
part('R3','RES','3.3k', 5200, 6700)
# rectifier chain (middle)
part('R13','RES','2k', 1900, 3300)
part('C4','CAPPOL','10uF', 2500, 3300)
part('D4','ZENER','RD5.1E', 2500, 3800)
part('R14','RES','10k', 3100, 3300)
part('D3','DIODE','1S1588', 3700, 3300)
part('R15','RES','1k', 4400, 3300)
# Q1 / U3 output (bottom-right)
part('Q1','NPN','C1815', 4900, 2500)
part('R6','RES','10k', 5300, 2300, 90)
part('R4','RES','10k', 5700, 2300, 90)
part('U3','OPAMP','LF356', 6000, 1900)
part('R7','RES','10k', 6100, 2700)
part('J2','CON2','CON2', 7000, 1500)
# U4 reference (bottom-left)
part('R1','RES','3.3k', 800, 1500, 90)
part('D2','ZENER','RD5.1E', 300, 1500, 90)
part('D1','DIODE','1S1588', 1200, 1800)
part('R2','RES','10k', 1800, 1800)
part('U4','OPAMP','LF356', 2500, 1700)
# power connector
part('J1','CON3','CON3', 700, 700)
part('J3','CON2','CON2', 7000, 800)

# ---------------- nets: name -> [(ref, pin)] -------------------------------------
NETS = {
 '+V':   [('J1','1')] + [(u,'7') for u in ('U1','U2','U3','U4')],
 '-V':   [('J1','3'), ('R1','1')] + [(u,'4') for u in ('U1','U2','U3','U4')],
 'GND':  [('J1','2'), ('C3','1'), ('R10','1'), ('Q2','1'), ('U2','3'), ('Q1','1'), ('D2','1'), ('U4','3'), ('J2','2')],
 'U1_OUT': [('U1','6'), ('VR1','3'), ('C1','2'), ('C2','1')],
 'N_C1R5': [('C1','1'), ('R5','2')],
 'U1_INP': [('U1','3'), ('R5','1'), ('R10','2'), ('C3','2')],
 'U1_INN': [('U1','2'), ('VR1','1'), ('VR1','2'), ('R9','2')],
 'DRAIN':  [('R9','1'), ('Q2','3'), ('R11','2')],
 'SIG_1':  [('Q2','2'), ('R11','1'), ('R12','1')],
 'N_R12R13': [('R12','2'), ('R13','1')],
 'N_A':    [('R13','2'), ('C4','1'), ('D4','1')],
 'N_B':    [('C4','2'), ('D4','2'), ('R14','1')],
 'N_R14D3': [('R14','2'), ('D3','2')],
 'V2':     [('U2','6'), ('R3','2'), ('D3','1'), ('R15','1')],
 'N_C2R8': [('C2','2'), ('R8','1')],
 'U2_INN': [('U2','2'), ('R8','2'), ('R3','1')],
 'Q1_B':   [('R15','2'), ('Q1','3')],
 'Q1_C':   [('Q1','2'), ('R6','1'), ('U3','3')],
 'VREF':   [('R6','2'), ('R4','2'), ('U4','6')],
 'U3_INN': [('U3','2'), ('R4','1'), ('R7','1')],
 'OUT_1':  [('U3','6'), ('R7','2'), ('J2','1')],
 'N_Z':    [('R1','2'), ('D2','2'), ('D1','1')],
 'N_D1R2': [('D1','2'), ('R2','1')],
 'U4_INN': [('U4','2'), ('R2','2')],
}

# ---------------- helpers --------------------------------------------------------
def rot(x, y, r):
    return {0:(x,y), 90:(-y,x), 180:(-x,-y), 270:(y,-x)}[r]
def pinpos(ref, pin):
    _, sym, _, X, Y, r = next(p for p in P if p[0] == ref)
    for num, name, x, y, dx, dy in SYMS[sym]['pins']:
        if num == pin:
            rx, ry = rot(x, y, r); return X+rx, Y+ry, rot(-dx, -dy, r)
    raise KeyError((ref, pin))
def pt(x, y): return f'(pt {int(x)} {int(y)})'
def ident(s):
    import re
    return '&' + re.sub(r'[^A-Za-z0-9_]', '_', s)

# sanity: every pin used at most once
seen = {}
for n, pins in NETS.items():
    for rp in pins:
        assert rp not in seen, (rp, n, seen.get(rp)); seen[rp] = n; pinpos(*rp)

# ---------------- EDIF writer ----------------------------------------------------
o = []
w = o.append
w('(edif PRACTICE3\n (edifVersion 2 0 0)\n (edifLevel 0)\n (keywordMap (keywordLevel 0))')
w(' (status (written (timeStamp 2026 10 13 0 0 0) (program "make_orcad.py")))')
w(' (library PRACTICE3_LIB\n  (edifLevel 0)\n  (technology (numberDefinition (scale 1 (e 254 -7) (unit DISTANCE)))\n   (figureGroup WIRE (pathWidth 0)))')
for name, s in SYMS.items():
    w(f'  (cell {name} (cellType GENERIC)\n   (view SYMBOL (viewType SCHEMATIC)\n    (interface')
    for num, pname, *_ in s['pins']:
        w(f'     (port (rename P{num} "{num}") (direction INOUT) (designator "{num}"))')
    w('     (symbol')
    for num, pname, x, y, dx, dy in s['pins']:
        w(f'      (portImplementation P{num} (connectLocation (figure WIRE (dot {pt(x,y)}))))')
        w(f'      (figure WIRE (path (pointList {pt(x,y)} {pt(x+dx,y+dy)})))')
    for poly in s['body']:
        w('      (figure WIRE (path (pointList ' + ' '.join(pt(*q) for q in poly) + ')))')
    w('    ))))')
w(' )')
w(' (library PRACTICE3_DESIGN\n  (edifLevel 0)\n  (technology (numberDefinition (scale 1 (e 254 -7) (unit DISTANCE)))\n   (figureGroup WIRE (pathWidth 0)))')
w('  (cell PRACTICE3 (cellType GENERIC)\n   (view SCHEMATIC (viewType SCHEMATIC)\n    (interface)\n    (contents\n     (page PAGE1')
ORI = {0:'R0', 90:'R90', 180:'R180', 270:'R270'}
for ref, sym, val, x, y, r in P:
    w(f'      (instance {ref} (viewRef SYMBOL (cellRef {sym} (libraryRef PRACTICE3_LIB)))')
    w(f'       (transform (orientation {ORI[r]}) (origin {pt(x,y)}))')
    w(f'       (designator "{ref}")')
    w(f'       (property VALUE (string "{val}"))')
    w(f'       (property PCB_FOOTPRINT (string "{SYMS[sym]["fp"]}")))')
# nets: short wire stub from each pin + net label (same names connect in Capture)
for i, (n, pins) in enumerate(NETS.items()):
    w(f'      (net (rename N{i:02d}_{ident(n)[1:]} "{n}")\n       (joined')
    for ref, pin in pins:
        w(f'        (portRef P{pin} (instanceRef {ref}))')
    w('       )')
    for ref, pin in pins:
        x, y, (dx, dy) = pinpos(ref, pin)
        ex, ey = x + (dx and (100 if dx > 0 else -100)), y + (dy and (100 if dy > 0 else -100))
        w(f'       (figure WIRE (path (pointList {pt(x,y)} {pt(ex,ey)})))')
    w('      )')
w('     ))))\n )')
w(' (design PRACTICE3 (cellRef PRACTICE3 (libraryRef PRACTICE3_DESIGN))))')
open(os.path.join(HERE, 'PRACTICE3.edf'), 'w').write('\n'.join(o) + '\n')

# ---------------- Telesis netlist for Allegro PCB Editor -------------------------
groups = {}
for ref, sym, val, *_ in P:
    groups.setdefault((SYMS[sym]['fp'], val), []).append(ref)
t = ['$PACKAGES']
for (fp, val), refs in groups.items():
    dev = (fp + '_' + val).upper().replace('.', 'P')
    t.append(f"'{fp}' ! '{dev}' ! '{val}' ; " + ' '.join(refs))
t.append('$NETS')
for n, pins in NETS.items():
    t.append(f"'{n}' ; " + ' '.join(f'{r}.{p}' for r, p in pins))
t.append('$END')
open(os.path.join(HERE, 'PRACTICE3_telesis.net'), 'w').write('\n'.join(t) + '\n')
print('parts', len(P), 'nets', len(NETS), 'pins', len(seen))
