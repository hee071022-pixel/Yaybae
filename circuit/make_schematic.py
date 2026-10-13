import sys
import schemdraw, schemdraw.elements as elm
import matplotlib; matplotlib.use("Agg")
ext = sys.argv[1]
OUT = "/home/user/Yaybae/circuit/schematic." + ext
RED = 'red'

def opamp(d, name, at):
    op = d.add(elm.Opamp(leads=True).right().at(at).anchor('in1'))
    d += elm.Label().at((op.center[0]+0.1, op.center[1])).label(name+'\nLF356', fontsize=8)
    d += elm.Line().at(op.vd).up(0.4); d += elm.Vdd().label('+V(7)', fontsize=8)
    d += elm.Line().at(op.vs).down(0.4); d += elm.Vss().label('-V(4)', fontsize=8, loc='bottom')
    return op

def tag(d, at, name, direction='right', color='black'):
    t = elm.Tag().at(at).label(name, fontsize=9, color=color)
    d += getattr(t, direction)()

with schemdraw.Drawing(file=OUT, show=False, dpi=150) as d:
    d.config(fontsize=10, unit=2.5)
    d += elm.Label().at((-14, 7)).label('Circuit Design Practice (3) - Wien-bridge oscillator with JFET AGC', fontsize=14, halign='left')

    # ===== U1 Wien-bridge oscillator =====
    U1 = opamp(d, 'U1', (0, 0))
    d += elm.Line().at(U1.in1).left(1.5); NI = d.here; d += elm.Dot()
    d += elm.Line().up(2.5)
    d += elm.Potentiometer().right().tox(U1.out[0] + 1.5).label('VR1 4.7k', loc='top')
    d += elm.Line().down().toy(U1.out); O1 = d.here; d += elm.Dot()
    d += elm.Line().at(U1.out).to(O1)
    d += elm.Line().at(O1).down(3.5)
    d += elm.Capacitor().left().label('C1 0.0047u', loc='bottom')
    d += elm.Resistor().left().label('R5 3k', loc='bottom')
    d += elm.Line().left().tox(U1.in2[0] - 1); P = d.here; d += elm.Dot()
    d += elm.Line().at(P).up().toy(U1.in2); d += elm.Line().right().tox(U1.in2)
    d += elm.Resistor().at(P).down(2.5).label('R10 3k', loc='bottom'); d += elm.Ground()
    d += elm.Line().at(P).left(2.5); d += elm.Capacitor().down(2.5).label('C3\n0.0047u', loc='bottom'); d += elm.Ground()

    # JFET AGC element
    d += elm.Resistor().at(NI).left(3).label('R9 3k'); D = d.here; d += elm.Dot()
    d += elm.Line().down(1); Dq = d.here
    Q2 = d.add(elm.JFetN().right().reverse().anchor('drain').at(Dq))
    d += elm.Label().at((Q2.center[0] + 0.5, Q2.center[1])).label('Q2\n2SK30', halign='left')
    d += elm.Ground().at(Q2.source)
    d += elm.Line().at(Q2.gate).left(1.5); G = d.here; d += elm.Dot()
    d += elm.Line().at(D).up(1.5)
    d += elm.Resistor().left().tox(G[0]).label('R11 100k', loc='top')
    d += elm.Line().down().toy(G)
    d += elm.Line().at(G).down(1.5); GG = d.here; d += elm.Dot()
    d += elm.Line().at(GG).left(1); tag(d, d.here, 'SIG_1', 'left')
    d += elm.Line().at(GG).down(1); tag(d, d.here, 'G', 'down')

    # ===== U2 inverting amp =====
    d += elm.Line().at(O1).right(1)
    d += elm.Capacitor(polar=True).right().label('C2 1u')
    d += elm.Resistor().right().label('R8 10k'); N2 = d.here; d += elm.Dot()
    U2 = opamp(d, 'U2', N2)
    d += elm.Line().at(U2.in2).left(0.8); d += elm.Ground()
    d += elm.Line().at(N2).up(2.5)
    d += elm.Resistor().right().tox(U2.out[0] + 1.5).label('R3 3.3k')
    d += elm.Line().down().toy(U2.out); V2 = d.here; d += elm.Dot()
    d += elm.Line().at(U2.out).to(V2)
    d += elm.Line().at(V2).right(1); tag(d, d.here, 'V2')

    # ===== rectifier / control voltage =====
    y = -11; x = -12
    tag(d, (x, y), 'G', 'left'); d += elm.Line().at((x, y)).right(0.01)
    d += elm.Resistor().at((x, y)).right().label('R12 100k', loc='bottom')
    d += elm.Resistor().right().label('R13 2k', loc='bottom'); A = d.here; d += elm.Dot()
    d += elm.Capacitor(polar=True).right(3).label('C4 10u', loc='bottom'); B = d.here; d += elm.Dot()
    d += elm.Line().at(A).up(1.8); d += elm.Zener().right().tox(B).label('D4 RD5.1E')
    d += elm.Line().down().toy(B)
    d += elm.Resistor().at(B).right().label('R14 10k', loc='bottom')
    d += elm.Diode().right().label('D3 1S1588', loc='bottom')
    tag(d, d.here, 'V2')

    # ===== Q1 + U3 output stage =====
    y = -19; x = 6
    tag(d, (x, y), 'V2', 'left'); d += elm.Line().at((x, y)).right(0.01)
    d += elm.Resistor().at((x, y)).right().label('R15 1k')
    Q1 = d.add(elm.BjtNpn(circle=True).anchor('base').label('Q1\n2SC1815', loc='right', ofst=(0.1, -0.8)))
    d += elm.Ground().at(Q1.emitter)
    d += elm.Line().at(Q1.collector).up(1); K = d.here; d += elm.Dot()
    U3top = (K[0] + 4, K[1] + 3.6)
    U3 = opamp(d, 'U3', U3top)
    d += elm.Line().at(K).right().tox(U3.in2[0] - 1); d += elm.Line().up().toy(U3.in2); d += elm.Line().right().tox(U3.in2)
    d += elm.Resistor().at(K).up(6).label('R6 10k'); VR = d.here; d += elm.Dot()
    d += elm.Line().left(1); tag(d, d.here, 'VREF', 'left')
    d += elm.Line().at(VR).right().tox(U3.in1[0] - 2)
    d += elm.Resistor().down().toy(U3.in1).label('R4 10k', loc='bottom'); N3 = d.here; d += elm.Dot()
    d += elm.Line().right().tox(U3.in1)
    d += elm.Line().at(N3).up(0.01)
    d += elm.Line().at(U3.out).right(1.5); O3 = d.here; d += elm.Dot()
    d += elm.Line().at(N3).toy(N3[1] + 0.01)
    d += elm.Line().at((N3[0] + 0.0, N3[1])).right(0.01)
    d += elm.Line().at(O3).up(3.2); top = d.here
    d += elm.Resistor().left().tox(N3[0] + 1).label('R7 10k')
    d += elm.Line().left().tox(N3[0] + 0.6); d += elm.Line().down().toy(N3); d += elm.Line().left().tox(N3)
    d += elm.Line().at(O3).right(1.5); d += elm.Dot(open=True).label('OUT_1', loc='right')

    # ===== U4 reference =====
    x0, y0 = -14, -19
    d += elm.Line().at((x0, y0 - 3)).up(0.01)
    d += elm.Vss().at((x0, y0 - 3)).label('-V', loc='bottom')
    d += elm.Resistor().at((x0, y0 - 3)).up(3).label('R1 3.3k')
    Z = d.here; d += elm.Dot()
    d += elm.Line().at(Z).left(3)
    d += elm.Zener().down(2.5).label('D2 RD5.1E', loc='top'); d += elm.Ground()
    d += elm.Diode().at(Z).right().reverse().label('D1 1S1588', loc='bottom')
    d += elm.Resistor().right().label('R2 10k', loc='bottom'); N4 = d.here; d += elm.Dot()
    U4 = opamp(d, 'U4', N4)
    d += elm.Line().at(U4.in2).left(0.8); d += elm.Ground()
    d += elm.Line().at(U4.out).right(1.5); tag(d, d.here, 'VREF')

    # ===== J1 power =====
    J = d.add(elm.Header(rows=3, pinsright=['1', '2', '3']).at((x0, -28)).label('J1 CON3', loc='top'))
    d += elm.Line().at(J.pin1).right(1.5); d += elm.Vdd().label('+V (+12V)', fontsize=9)
    d += elm.Line().at(J.pin2).right(3.5); d += elm.Ground()
    d += elm.Line().at(J.pin3).right(1.5); d += elm.Vss().label('-V (-12V)', fontsize=9, loc='bottom')
    d += elm.Label().at((-4, -28)).label('U1~U4 = LF356 : pin7 = +V, pin4 = -V, pin1/5/8 = NC (X)\n'
                                       'U4 has no feedback resistor (all R1~R15 are used elsewhere) -> works as comparator', halign='left', fontsize=10)
