"""크리스탈 길드 디스코드 봇 (파이썬)

/사이트 /로또권 /회차 /당첨번호 를 봇이 직접 받아서, 답은 사이트에서 받아온다.
처음 실행하면 봇 토큰과 사이트 주소를 물어보고 config.json 에 저장한다.
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

import aiohttp
import discord
from discord import app_commands

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
DEFAULT_GUILD_ID = 1176515670624698418
DEFAULT_SITE = "https://crystal-guild-lotto-ao21.netlify.app"


def load_config():
    cfg = json.loads(CONFIG.read_text("utf-8")) if CONFIG.exists() else {}
    cfg["token"] = os.environ.get("DISCORD_BOT_TOKEN") or cfg.get("token") or ""
    cfg["site"] = os.environ.get("SITE_URL") or cfg.get("site") or ""
    cfg["guild_id"] = int(os.environ.get("DISCORD_GUILD_ID") or cfg.get("guild_id") or DEFAULT_GUILD_ID)
    changed = False
    try:
        if not cfg["token"]:
            print("config.json 에 봇 토큰이 없어요. 콘솔에 봇 토큰을 붙여넣고 엔터 (개발자 포털 → Bot → Reset Token)")
            cfg["token"] = input("봇 토큰: ").strip()
            changed = True
        if not cfg["site"]:
            cfg["site"] = DEFAULT_SITE
            changed = True
    except EOFError:
        print("콘솔 입력을 받을 수 없어요. config.example.json 을 config.json 으로 복사해서 token 칸에 봇 토큰을 넣고 다시 켜세요.")
        sys.exit(1)
    if not cfg["token"] or cfg["token"].startswith("여기에"):
        print("봇 토큰이 비어 있어요. config.json 의 token 칸에 넣고 다시 켜세요.")
        sys.exit(1)
    cfg["site"] = cfg["site"].rstrip("/")
    if not cfg["site"].startswith("http"):
        cfg["site"] = "https://" + cfg["site"]
    if changed:
        CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), "utf-8")
        print(f"설정을 {CONFIG.name} 에 저장했어요. (토큰이 들어 있으니 남에게 주지 마세요)")
    return cfg


cfg = load_config()
# 사이트가 봇을 알아보는 열쇠: 토큰 자체가 아니라 토큰으로 만든 값만 보낸다
BOT_KEY = hmac.new(b"crystal-bot", cfg["token"].encode(), hashlib.sha256).hexdigest()
GUILD = discord.Object(id=cfg["guild_id"])


class SiteError(Exception):
    pass


async def ask_site(session, name, user_id=""):
    try:
        async with session.post(
            f"{cfg['site']}/api/bot/command",
            json={"name": name, "discordUserId": str(user_id)},
            headers={"x-bot-key": BOT_KEY},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as res:
            data = await res.json(content_type=None)
            if res.status != 200:
                raise SiteError(data.get("error") or f"사이트 오류 {res.status}")
            return data
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as e:
        raise SiteError(f"사이트에 연결하지 못했어요. ({e.__class__.__name__})") from e


class CrystalBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)
        self.session = None

    async def setup_hook(self):
        self.session = aiohttp.ClientSession()
        # 명령어 목록은 사이트에서 받아온다 (사이트에 명령어가 늘면 봇 재시작만 하면 됨)
        try:
            commands = (await ask_site(self.session, "목록"))["commands"]
        except SiteError as e:
            print("명령어 목록을 못 받아서 기본 목록을 씁니다:", e)
            commands = [
                {"name": "사이트", "description": "크리스탈 길드 사이트 링크"},
                {"name": "로또권", "description": "내 로또권 장수 확인 (나에게만 보임)"},
                {"name": "회차", "description": "지금 로또 회차 상태와 응모 기간"},
                {"name": "당첨번호", "description": "최근 로또 당첨번호와 당첨자"},
            ]
        for c in commands:
            self.tree.add_command(make_command(c["name"], c["description"]), guild=GUILD)
        synced = await self.tree.sync(guild=GUILD)  # 서버 명령어라 바로 반영
        print("명령어 등록:", " ".join("/" + c.name for c in synced))

    async def close(self):
        if self.session:
            await self.session.close()
        await super().close()

    async def on_ready(self):
        print(f"봇 켜짐: {self.user} (서버 {cfg['guild_id']}, 사이트 {cfg['site']})")
        await self.change_presence(activity=discord.Game("/사이트"))


bot = CrystalBot()


def make_command(name, description):
    async def callback(interaction: discord.Interaction):
        await interaction.response.defer(thinking=True, ephemeral=(name == "로또권"))
        try:
            data = (await ask_site(bot.session, name, interaction.user.id)).get("data", {})
        except SiteError as e:
            await interaction.followup.send(str(e), ephemeral=True)
            return
        embeds = [discord.Embed.from_dict(e) for e in data.get("embeds", [])]
        await interaction.followup.send(
            content=data.get("content") or None,
            embeds=embeds,
            ephemeral=bool(data.get("flags", 0) & 64),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    return app_commands.Command(name=name, description=description[:100], callback=callback)


if __name__ == "__main__":
    try:
        bot.run(cfg["token"])
    except discord.LoginFailure:
        print("봇 토큰이 올바르지 않아요. config.json 을 지우고 다시 실행해서 새 토큰을 넣으세요.")
        sys.exit(1)
