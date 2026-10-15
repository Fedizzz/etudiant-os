// Captures réelles de l'application (données d'exemple) pour la landing page et l'image de partage.
// Prérequis : build local (OUT_DIR=dist-local … --local-only) servi sur APP_URL. Lancer : node scripts/screens.mjs
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
const APP = process.env.APP_URL ?? "http://127.0.0.1:5174/etudiant-os/app";
const OUT = "public/screens";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
async function shoot(name, view, w, h, mobile = false) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: "light" });
  const p = await ctx.newPage();
  await p.goto(APP); await p.click("text=Explorer avec des données d'exemple"); await p.waitForTimeout(600);
  if (view) { await p.goto(APP + "/" + view); }
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: "[role=status].animate-slide, .pointer-events-none.fixed { display:none !important }" });
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
  await ctx.close();
}
await shoot("dashboard-desktop", "", 1280, 800);
await shoot("planning-desktop", "planning", 1280, 800);
await shoot("focus-desktop", "focus", 1280, 800);
await shoot("budget-desktop", "budget", 1280, 800);
await shoot("dashboard-mobile", "", 390, 844, true);
await shoot("focus-mobile", "focus", 390, 844, true);
// Image de partage 1200×630
const shot = readFileSync(`${OUT}/dashboard-desktop.jpg`).toString("base64");
const og = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await og.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#eeecf4;font-family:'Bricolage Grotesque',sans-serif;overflow:hidden;position:relative">
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(24,22,46,.09) 1px,transparent 1.2px);background-size:22px 22px"></div>
<div style="position:absolute;left:64px;top:84px;width:470px">
<div style="display:inline-block;background:#ff488c;color:#fff;border:3px solid #18162e;border-radius:14px;padding:8px 14px;font-weight:800;font-size:28px;box-shadow:4px 4px 0 #18162e;transform:rotate(-2deg)">Étudiant.OS</div>
<h1 style="font-size:58px;line-height:1.02;margin:34px 0 0;color:#18162e;font-weight:800">Tes études.<br>Ton organisation.<br><span style="background:linear-gradient(transparent 55%,#ffe240 55%)">Un seul espace.</span></h1>
<p style="font-size:24px;color:#4a4766;margin-top:22px;font-family:sans-serif">Planning · Focus · Budget · Courses · Ménage · Sommeil</p></div>
<div style="position:absolute;left:590px;top:70px;width:680px;border:3px solid #18162e;border-radius:22px;overflow:hidden;box-shadow:8px 8px 0 #18162e;transform:rotate(2deg);background:#fff"><img src="data:image/jpeg;base64,${shot}" style="width:100%;display:block"></div>
</body></html>`);
await og.waitForTimeout(500); await og.screenshot({ path: "public/og-image.jpg", type: "jpeg", quality: 85 });
await b.close();
console.log("✓ captures dans public/screens et public/og-image.png");
