import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await p.goto("http://127.0.0.1:5174/etudiant-os/app"); await p.click("text=Explorer avec des données d'exemple"); await p.waitForTimeout(800);
const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log("visible:", await p.locator("button[aria-label='Changer de thème']").isVisible(), await bg());
await p.click("button[aria-label=Menu]"); await p.click("[role=menu] >> text=Thème clair"); await p.waitForTimeout(400);
console.log("après:", await p.evaluate(() => document.documentElement.getAttribute("data-theme")), await bg());
await b.close();
