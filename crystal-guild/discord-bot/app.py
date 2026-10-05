"""크리스탈 길드 디스코드 봇 (파이썬)

/사이트 를 치면 크리스탈 길드 사이트 링크를 보여준다.
설정은 config.json (token, site, guild_id).
"""
import json
import os
import sys
from pathlib import Path

import discord
from discord import app_commands

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
DEFAULT_GUILD_ID = 1176515670624698418
DEFAULT_SITE = "https://crystal-guild-lotto-ao21.netlify.app"


def load_config():
    cfg = json.loads(CONFIG.read_text("utf-8")) if CONFIG.exists() else {}
    cfg["token"] = os.environ.get("DISCORD_BOT_TOKEN") or cfg.get("token") or ""
    cfg["site"] = (os.environ.get("SITE_URL") or cfg.get("site") or DEFAULT_SITE).rstrip("/")
    if not cfg["site"].startswith("http"):
        cfg["site"] = "https://" + cfg["site"]
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

    async def on_ready(self):
        print(f"봇 켜짐: {self.user} (서버 {cfg['guild_id']}, 사이트 {cfg['site']})")
        await self.change_presence(activity=discord.Game("/사이트"))


@app_commands.command(name="사이트", description="크리스탈 길드 사이트 링크")
async def site_command(interaction: discord.Interaction):
    embed = discord.Embed(
        title="크리스탈 길드",
        url=cfg["site"],
        description=f"{cfg['site']}\n공지사항 · 로또 이벤트 · 당첨 결과를 확인하세요.",
        color=0x2F45C5,
    )
    await interaction.response.send_message(embed=embed, ephemeral=True)  # 친 사람에게만 보임


bot = CrystalBot()

if __name__ == "__main__":
    try:
        bot.run(cfg["token"])
    except discord.LoginFailure:
        print("봇 토큰이 올바르지 않아요. config.json 의 token 을 새 토큰으로 바꾸고 다시 켜세요.")
        sys.exit(1)
