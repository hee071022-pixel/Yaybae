"""크리스탈 길드 디스코드 봇 (파이썬)

/사이트 를 치면 크리스탈 길드 사이트 링크를 보여준다.
설정은 config.json (token, site, guild_id).
"""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import aiohttp
import discord
from discord import app_commands

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
DEFAULT_GUILD_ID = 1176515670624698418
DEFAULT_SITE = "https://fabulous-dolphin-ecf5c4.netlify.app"


def load_config():
    cfg = json.loads(CONFIG.read_text("utf-8")) if CONFIG.exists() else {}
    cfg["token"] = os.environ.get("DISCORD_BOT_TOKEN") or cfg.get("token") or ""
    cfg["site"] = (os.environ.get("SITE_URL") or cfg.get("site") or DEFAULT_SITE).rstrip("/")
    if not cfg["site"].startswith("http"):
        cfg["site"] = "https://" + cfg["site"]
    # /사이트 가 보여줄 링크 (없으면 사이트 주소/#event)
    cfg["link"] = os.environ.get("SITE_LINK") or cfg.get("link") or f"{cfg['site']}/#event"
    cfg["guild_id"] = int(os.environ.get("DISCORD_GUILD_ID") or cfg.get("guild_id") or DEFAULT_GUILD_ID)
    if not cfg["token"] or cfg["token"].startswith("여기에"):
        print("봇 토큰이 없어요. config.example.json 을 config.json 으로 바꾸고 token 칸에 봇 토큰을 넣은 뒤 다시 켜세요.")
        sys.exit(1)
    return cfg


cfg = load_config()
GUILD = discord.Object(id=cfg["guild_id"])


class CrystalBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        self.tree.add_command(site_command)
        self.tree.copy_global_to(guild=GUILD)
        await self.sync_commands()

    def invite_url(self):
        return (f"https://discord.com/oauth2/authorize?client_id={self.application_id}"
                f"&scope=bot+applications.commands&permissions=0&guild_id={cfg['guild_id']}")

    async def sync_commands(self):
        try:
            # 서버 명령어로 등록 (바로 반영). 예전에 등록된 다른 명령어는 이걸로 지워짐
            synced = await self.tree.sync(guild=GUILD)
        except discord.Forbidden:
            print("=" * 60)
            print(f"봇이 서버({cfg['guild_id']})에 없어요. 아래 링크로 초대하면 자동으로 명령어를 등록해요.")
            print(self.invite_url())
            print("=" * 60)
            return
        print("명령어 등록:", " ".join("/" + c.name for c in synced))

    async def on_guild_join(self, guild):
        if guild.id == cfg["guild_id"]:
            print(f"서버에 초대됨: {guild.name}")
            await self.sync_commands()

    async def update_avatar(self):
        # avatar.png 가 있으면 봇 프로필 사진으로 (바뀌었을 때만 한 번 — 디스코드가 자주 바꾸는 걸 막음)
        img = HERE / "avatar.png"
        mark = HERE / ".avatar_done"
        if not img.exists():
            return
        data = img.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if mark.exists() and mark.read_text().strip() == digest:
            return
        try:
            await self.user.edit(avatar=data)
            mark.write_text(digest)
            print("봇 프로필 사진을 바꿨어요.")
        except discord.HTTPException as e:
            print(f"프로필 사진을 못 바꿨어요 (잠시 후 재시작하면 다시 시도): {e}")

    async def on_ready(self):
        print(f"봇 켜짐: {self.user} (서버 {cfg['guild_id']}, 사이트 {cfg['site']})")
        await self.update_avatar()
        await self.change_presence(activity=discord.Game("/사이트"))


def site_base():
    # /사이트 링크에서 #event 같은 뒤쪽을 뺀 주소
    return cfg["link"].split("#")[0].rstrip("/")


async def fetch_round():
    """사이트에서 지금 회차 정보를 받아온다 (안 되면 None)."""
    try:
        timeout = aiohttp.ClientTimeout(total=2.5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(f"{site_base()}/api/stats") as res:
                if res.status != 200:
                    return None
                return await res.json(content_type=None)
    except Exception:
        return None


def round_text(stats):
    r = (stats or {}).get("round")
    if not r:
        return "**이번 회차** 다음 회차 준비 중"
    no = r.get("no")
    if r.get("status") == "drawn":
        return f"**이번 회차** 제{no}회 추첨 완료 · 결과는 사이트에서 확인하세요"
    now = time.time() * 1000
    start, end = r.get("startAt"), r.get("endAt")
    if start and now < start:
        return f"**이번 회차** 제{no}회 응모 예정 · <t:{int(start // 1000)}:R> 시작"
    if end and now >= end:
        return f"**이번 회차** 제{no}회 마감 · 곧 추첨해요"
    line = f"**이번 회차** 제{no}회 응모 중 · {r.get('entryCount', 0)}줄 응모"
    if end:
        line += f"\n마감 <t:{int(end // 1000)}:F> (<t:{int(end // 1000)}:R>)"
    prize = (r.get("prizes") or {}).get("1")
    if prize:
        line += f"\n1등 상품 **{prize}**"
    return line


class SiteCard(discord.ui.LayoutView):
    """/사이트 답장: 로고가 들어간 카드 + 바로가기 버튼"""

    def __init__(self, stats):
        super().__init__(timeout=None)
        base = site_base()
        members = (stats or {}).get("members")
        intro = "길드원 전용 사이트예요. 공지 확인하고, 받은 로또권으로 매 회차 이벤트에 참여해 보세요."
        if members:
            intro += f"\n-# 길드원 {members}명 가입"
        header = discord.ui.Section(
            discord.ui.TextDisplay("## 크리스탈 길드"),
            discord.ui.TextDisplay(intro),
            accessory=discord.ui.Thumbnail(f"{base}/logo.png"),
        )
        buttons = discord.ui.ActionRow(
            discord.ui.Button(label="로또 이벤트", url=cfg["link"]),
            discord.ui.Button(label="공지사항", url=f"{base}/#notices"),
            discord.ui.Button(label="당첨 결과", url=f"{base}/#results"),
            discord.ui.Button(label="사이트 홈", url=f"{base}/"),
        )
        self.add_item(discord.ui.Container(
            header,
            discord.ui.Separator(),
            discord.ui.TextDisplay(round_text(stats)),
            discord.ui.Separator(visible=False),
            buttons,
            discord.ui.TextDisplay("-# 이 메시지는 나에게만 보여요"),
            accent_colour=discord.Colour(0x8B7BFF),
        ))


@app_commands.command(name="사이트", description="크리스탈 길드 사이트 링크")
async def site_command(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)  # 사이트 정보 받아오는 동안
    stats = await fetch_round()
    await interaction.followup.send(view=SiteCard(stats), ephemeral=True)


bot = CrystalBot()

if __name__ == "__main__":
    try:
        bot.run(cfg["token"])
    except discord.LoginFailure:
        print("봇 토큰이 올바르지 않아요. config.json 의 token 을 새 토큰으로 바꾸고 다시 켜세요.")
        sys.exit(1)
