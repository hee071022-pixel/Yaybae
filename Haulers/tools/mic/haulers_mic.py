#!/usr/bin/env python3
"""Haulers 마이크 연동 프로그램.

PC 마이크 음량을 측정해서 Minecraft Bedrock의 WebSocket 연결(/connect)로
`/scriptevent haul:mic <음량 0~100> [플레이어 이름]` 명령을 보냅니다.
애드온은 이 값으로 소음을 올려, 말하거나 소리치면 몬스터가 듣고 쫓아옵니다.

사용법:
  pip install websockets sounddevice numpy
  python haulers_mic.py                # 실행 후 게임 채팅에: /connect localhost:3000
  python haulers_mic.py --list         # 마이크 장치 목록
  python haulers_mic.py --device 2     # 특정 마이크 사용
  python haulers_mic.py --demo         # 마이크 없이 가짜 음량으로 테스트
"""
import argparse
import asyncio
import json
import math
import random
import sys
import time
import uuid

try:
    import websockets
except ImportError:
    sys.exit("websockets 패키지가 필요합니다:  pip install websockets sounddevice numpy")

BLOCK_SEC = 0.05     # 음량 측정 단위 (50ms)
SEND_MIN_GAP = 0.2   # 최대 초당 5회 전송
KEEPALIVE = 1.0      # 음량이 그대로여도 1초마다 전송 (게임은 3초간 신호가 없으면 끊김으로 봄)


class Meter:
    """마이크 RMS(dBFS) → 0~100 음량. 빠르게 오르고 천천히 내려감."""

    def __init__(self, floor_db, ceil_db):
        self.floor_db, self.ceil_db = floor_db, ceil_db
        self.level = 0.0

    def feed_db(self, db):
        raw = (db - self.floor_db) / (self.ceil_db - self.floor_db) * 100
        raw = max(0.0, min(100.0, raw))
        k = 0.6 if raw > self.level else 0.15
        self.level += (raw - self.level) * k
        return self.level


def rms_db(samples):
    import numpy as np
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    return 20 * math.log10(max(rms, 1e-9))


class MicSource:
    def __init__(self, device):
        import sounddevice as sd
        self.sd = sd
        self.queue = asyncio.Queue()
        self.loop = asyncio.get_running_loop()
        self.stream = sd.InputStream(device=device, channels=1, samplerate=16000,
                                     blocksize=int(16000 * BLOCK_SEC), callback=self._cb)
        self.stream.start()

    def _cb(self, indata, frames, t, status):  # noqa: ARG002 (sounddevice 콜백 시그니처)
        db = rms_db(indata[:, 0])
        self.loop.call_soon_threadsafe(self.queue.put_nowait, db)

    async def next_db(self):
        return await self.queue.get()


class DemoSource:
    """마이크 없이 테스트: 조용함 → 말하기 → 가끔 외침을 흉내냄."""

    def __init__(self):
        self.t0 = time.time()

    async def next_db(self):
        await asyncio.sleep(BLOCK_SEC)
        t = time.time() - self.t0
        phase = t % 12
        if phase < 4:
            return -62 + random.uniform(-3, 3)                      # 조용함
        if phase < 10:
            return -32 + 8 * math.sin(t * 9) + random.uniform(-4, 4)  # 말하기
        return -12 + random.uniform(-2, 2)                          # 외침


def command(line):
    return json.dumps({
        "header": {"version": 1, "requestId": str(uuid.uuid4()),
                   "messagePurpose": "commandRequest", "messageType": "commandRequest"},
        "body": {"version": 1, "commandLine": line, "origin": {"type": "player"}},
    })


def meter_text(level):
    n = int(level / 5)
    return f"[{'#' * n}{'.' * (20 - n)}] {int(level):3d}"


async def main_async(args):
    source = DemoSource() if args.demo else MicSource(args.device)
    meter = Meter(args.floor, args.ceil)
    clients = set()

    async def handler(ws, *_):
        clients.add(ws)
        print(f"\n[연결됨] Minecraft가 연결되었습니다. ({len(clients)}명)")
        await ws.send(command("tellraw @s {\"rawtext\":[{\"text\":\"§b[Haulers] 마이크 프로그램이 연결되었습니다.\"}]}"))
        warned = False
        try:
            async for msg in ws:
                try:
                    data = json.loads(msg)
                except ValueError:
                    continue
                body = data.get("body", {})
                if data.get("header", {}).get("messagePurpose") == "commandResponse" and body.get("statusCode", 0) < 0:
                    if not warned:
                        warned = True
                        print(f"\n[오류] 게임이 명령을 거부했습니다: {body.get('statusMessage')}"
                              "\n       → 월드 설정에서 '치트 활성화'를 켜고, 플레이어가 관리자(OP)인지 확인하세요.")
        finally:
            clients.discard(ws)
            print(f"\n[연결 끊김] ({len(clients)}명 남음)")

    async with websockets.serve(handler, args.host, args.port, max_size=2 ** 20):
        print(f"Haulers 마이크 프로그램 실행 중 — 게임 채팅에 입력:  /connect localhost:{args.port}")
        print("(중지: Ctrl+C)\n")
        last_sent, last_val = 0.0, -1
        suffix = f" {args.player}" if args.player else ""
        while True:
            level = meter.feed_db(await source.next_db())
            val = int(round(level))
            now = time.time()
            print(f"\r마이크 {meter_text(level)}  {'연결됨' if clients else '연결 대기'}   ", end="", flush=True)
            if not clients:
                continue
            changed = abs(val - last_val) >= 3
            if now - last_sent >= SEND_MIN_GAP and (changed or now - last_sent >= KEEPALIVE):
                last_sent, last_val = now, val
                line = command(f"scriptevent haul:mic {val}{suffix}")
                for ws in list(clients):
                    try:
                        await ws.send(line)
                    except Exception:  # noqa: BLE001 (끊긴 연결은 handler가 정리)
                        pass


def main():
    ap = argparse.ArgumentParser(description="Haulers 마이크 연동 프로그램")
    ap.add_argument("--port", type=int, default=3000)
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--device", type=int, default=None, help="마이크 장치 번호 (--list 로 확인)")
    ap.add_argument("--list", action="store_true", help="마이크 장치 목록 보기")
    ap.add_argument("--player", default="", help="플레이어 이름 (여러 명이 한 PC로 플레이할 때만)")
    ap.add_argument("--floor", type=float, default=-55.0, help="이 dB 이하는 0 (주변 소음이 크면 올리세요)")
    ap.add_argument("--ceil", type=float, default=-12.0, help="이 dB 이상은 100 (외침 기준)")
    ap.add_argument("--demo", action="store_true", help="마이크 없이 가짜 음량으로 테스트")
    args = ap.parse_args()
    if args.list:
        import sounddevice as sd
        print(sd.query_devices())
        return
    if args.ceil <= args.floor:
        sys.exit("--ceil 은 --floor 보다 커야 합니다.")
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n종료합니다.")


if __name__ == "__main__":
    main()
