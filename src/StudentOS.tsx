import { createPortal } from "react-dom";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MiniPdf } from "./pdf.ts";
import { layoutLanes } from "./core.ts";
import { DAY_WORDS, dayOf, pageGeometry, parseGrid } from "./timetable.ts";
import { parseIcs, normalizeFeedUrl, isFeedUrl } from "./ical.ts";
import { BACKUP_KEY, CORRUPT_KEY, DAYS, DAYS_LONG, OVERDUE_SPREAD, STORAGE_KEY, addDays, bedtimeOptions, blank, budgetStats, choreAssignee, choreHistory, choreScheduledOn, choreStepsDone, choreDoneLate, choreSlotEnd, freeStart, setOnTimeMode, todoDoneLate, taskDoneLate, habitDoneLate, habitTimePassed, nowMinutes, NO_DEADLINE, cx, daysBetween, fmtDate, fmtDur, focusStats, iso, isoWeek, lastNDays, loadState, money, monthKey, norm, onTimeGuess, onTimeStats, taskOnTimeStats, choreOnTimeStats, HABIT_CATS, habitOn, habitStats, habitStepsDone, habitStreak, todoOnTimeStats, TODO_KINDS, activeDays, xpOf, levelOf, globalStreak, LEVELS, pad, pantryItems, parseAmount, parseISO, parseReceipt, parseReceiptItems, receiptFingerprint, phaseSeconds, planFor, planRange, reducer, seed, sleepMinutes, sleepStats, timerLeft, toHHMM, toMin, todayISO, uid, validateState, weekday } from "./core.ts";
import type { Action, Aisle, PlanEvent, Chore, Habit, HabitCat, Todo, TodoKind, AppState, Block, Budget, Course, DayPlan, Expense, ExpenseCat, GroceryTemplate, ID, Phase, PomodoroCfg, Priority, ReceiptItem, ReceiptResult, Recurrence, EventRecurrence, CalFeed, FeedEvent, SettingsState, SleepLog, Step, Task, TaskKind, TaskStatus, TemplateItem, ViewKey } from "./core.ts";
import type { AppEnv } from "./env.ts";
import { LangSwitch } from "./i18n.tsx";
import { OcrError, scanReceipt } from "./ocr.ts";
import type { OcrOutput, OcrProgress } from "./ocr.ts";

/* ============================================================================
 * Étudiant.OS — interface de l'application. La logique métier est dans core.ts ;
 * le stockage (local ou compte synchronisé) est fourni par l'environnement (env.ts).
 * ========================================================================== */

/* ============================================================================
 * Icônes « cartoon au crayon » dessinées à la main : trait irrégulier, léger
 * tremblé (filtre SVG), aplat coloré décalé comme un coup de feutre.
 * Aucune dépendance externe.
 * ========================================================================== */
type IconProps = { size?: number; className?: string; strokeWidth?: number; "aria-label"?: string };
/** f = forme remplie d'un aplat (cartoon), sinon simple trait de crayon. */
type Stroke = { d: string; f?: boolean };
function sketch(name: string, strokes: Stroke[]): React.FC<IconProps> {
  const Icon: React.FC<IconProps> = ({ size = 16, className, strokeWidth = 2.4, ...rest }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={cx("sketch-icon shrink-0", className)} aria-hidden={rest["aria-label"] ? undefined : true}
      role={rest["aria-label"] ? "img" : undefined} aria-label={rest["aria-label"]}>
      {strokes.some((x) => x.f) && (
        <g className="sketch-fill" stroke="none" transform="translate(1.6 1.4)">
          {strokes.filter((x) => x.f).map((x, k) => <path key={k} d={x.d} />)}
        </g>
      )}
      <g filter="url(#pencil)">{strokes.map((x, k) => <path key={k} d={x.d} />)}</g>
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}
/** En-tête fixe (position: fixed, fiable sur Safari iOS) + hauteur mesurée pour réserver la place dans la page. */
export function useFixedHeader(): [(el: HTMLElement | null) => void, number] {
  const [h, setH] = useState(64);
  const ro = useRef<ResizeObserver | null>(null);
  // Ref « callback » : fonctionne même si l'en-tête apparaît après le premier rendu (onboarding, chargement…).
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect(); ro.current = null;
    if (!el) return;
    setH(el.offsetHeight);
    ro.current = new ResizeObserver(() => setH(el.offsetHeight)); ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, h];
}
/** Menu du haut qui se cache en descendant et réapparaît dès qu'on remonte (téléphone). */
export function useHideOnScroll(height: number, disabled = false): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (disabled) { setHidden(false); return; }
    let last = window.scrollY, ticking = false;
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const y = Math.max(0, window.scrollY), dy = y - last;
        if (y < height) setHidden(false);              // près du haut : toujours visible
        else if (dy > 6) setHidden(true);               // on descend : on cache
        else if (dy < -4) setHidden(false);             // on remonte : on montre tout de suite
        if (Math.abs(dy) > 4) last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [height, disabled]);
  return hidden && !disabled;
}

/**
 * « Tirer pour actualiser » (écrans tactiles) : seulement quand la page est tout en haut ; indicateur flèche → roue ;
 * au relâchement au-delà du seuil, appelle onRefresh (actualisation ciblée des données, pas de rechargement de page).
 */
export const PullToRefresh: React.FC<{ onRefresh: () => Promise<unknown>; top: number }> = ({ onRefresh, top }) => {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const st = useRef({ y0: 0, active: false, pull: 0, busy: false });
  const THRESHOLD = 72, MAX = 120;
  useEffect(() => {
    if (!matchMedia("(pointer: coarse)").matches) return;
    const blocked = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      // Pas dans une fenêtre, un menu, un champ, ni dans une zone qui défile elle-même et n'est pas en haut.
      if (!el?.closest || el.closest('[role="dialog"], [role="menu"], input, textarea, select, [data-no-ptr]')) return true;
      for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowY;
        if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true;
      }
      return false;
    };
    const start = (e: TouchEvent) => {
      if (st.current.busy || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) { st.current.active = false; return; }
      st.current = { ...st.current, y0: e.touches[0].clientY, active: true, pull: 0 };
    };
    const move = (e: TouchEvent) => {
      if (!st.current.active) return;
      const dy = e.touches[0].clientY - st.current.y0;
      if (window.scrollY > 0 || dy <= 0) { if (st.current.pull) { st.current.pull = 0; setPull(0); } if (dy < 0) st.current.active = false; return; }
      const p = Math.min(MAX, dy * 0.5); // résistance : la flèche suit le doigt à moitié
      st.current.pull = p; setPull(p);
    };
    const end = async () => {
      if (!st.current.active) return;
      st.current.active = false;
      if (st.current.pull >= THRESHOLD) {
        st.current.busy = true; setBusy(true); setPull(THRESHOLD);
        try { await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 600))]); } finally { st.current.busy = false; setBusy(false); setPull(0); st.current.pull = 0; }
      } else { setPull(0); st.current.pull = 0; }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end); window.addEventListener("touchcancel", end);
    return () => { window.removeEventListener("touchstart", start); window.removeEventListener("touchmove", move); window.removeEventListener("touchend", end); window.removeEventListener("touchcancel", end); };
  }, [onRefresh]);
  if (!pull && !busy) return null;
  const ratio = Math.min(1, pull / THRESHOLD), ready = ratio >= 1;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-40 flex justify-center" style={{ top: top + pull * 0.55 - 20, transition: st.current.active ? "none" : "top .3s var(--ease)" }} data-testid="ptr">
      <div className={cx("grid h-10 w-10 place-items-center rounded-full border-2 border-fg shadow-[3px_3px_0_0_rgb(var(--ink))] transition-colors", ready && !busy ? "bg-hi text-[rgb(24_22_46)]" : "bg-panel")}
        style={{ opacity: busy ? 1 : 0.35 + ratio * 0.65 }}>
        {busy ? <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-label="Actualisation…"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          : <svg className="h-5 w-5 transition-transform duration-200" style={{ transform: `rotate(${ready ? 180 : ratio * 150}deg)` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label={ready ? "Relâcher pour actualiser" : "Tirer pour actualiser"}><path d="M12 4v15M6 13l6 6 6-6" /></svg>}
      </div>
      <span className="sr-only">{busy ? "Actualisation…" : ready ? "Relâchez pour actualiser" : "Tirez pour actualiser"}</span>
    </div>
  );
};

/** Filtre global de tremblé crayon, monté une fois à la racine. */
export const PencilDefs: React.FC = () => (
  <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
    {/* Région en unités absolues : avec la boîte englobante (par défaut), Safari n'affiche pas les traits
        parfaitement horizontaux / verticaux ou les points (boîte de hauteur ou largeur nulle). */}
    <filter id="pencil" filterUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);
export const LayoutDashboard = sketch("LayoutDashboard", [
  { d: "M3.6 4.2c1.9-.4 4.1-.3 6 .1.3 1.9.2 4.3-.1 6.2-1.9.3-4 .3-5.9-.1-.3-2-.3-4.2 0-6.2Z", f: true },
  { d: "M13.9 3.8c2.2-.2 4.4 0 6.3.3.2 1.3.2 2.5 0 3.7-2 .3-4.2.2-6.2-.1-.3-1.3-.3-2.7-.1-3.9Z" },
  { d: "M14 11.2c2-.3 4.2-.2 6.2.1.3 2.9.2 5.9-.1 8.7-2 .3-4.1.2-6-.1-.3-2.9-.4-5.9-.1-8.7Z" },
  { d: "M3.8 14.1c1.9-.2 4-.2 6 .1.2 2 .2 3.9-.1 5.8-2 .2-4 .2-5.9-.1-.2-1.9-.2-3.9 0-5.8Z" },
]);
export const CalendarClock = sketch("CalendarClock", [
  { d: "M3.3 6.2c.1-1.4 1-2 2.3-2.1 3.6-.2 7.3-.2 10.9 0 1.3.1 2.1.8 2.2 2.1l.1 3.3" },
  { d: "M11.2 20.3c-1.9.1-3.8.1-5.6 0-1.3-.1-2.2-.9-2.3-2.2-.2-3.9-.2-7.9 0-11.8" },
  { d: "M7.5 2.6v3.2M15 2.5v3.3M3.4 9.6c3.8-.2 7.6-.2 11.4 0" },
  { d: "M17 12.1c2.7.1 4.6 2.1 4.6 4.7-.1 2.6-2.2 4.6-4.8 4.5-2.6-.1-4.5-2.2-4.4-4.8.1-2.5 2.1-4.5 4.6-4.4Z", f: true },
  { d: "M17 14.6v2.4l1.5 1" },
]);
export const GraduationCap = sketch("GraduationCap", [
  { d: "M2.4 9.3c3.1-1.6 6.4-3 9.7-4.3 3.2 1.2 6.4 2.6 9.5 4.2-3.1 1.6-6.3 3-9.6 4.3-3.3-1.2-6.5-2.6-9.6-4.2Z", f: true },
  { d: "M6.2 11.4c-.1 1.6-.1 3.1.1 4.6 3.6 2.6 8 2.6 11.6 0 .2-1.5.2-3 .1-4.6" },
  { d: "M21.5 9.4c.1 1.9.1 3.9-.1 5.8" },
]);
export const Timer = sketch("Timer", [
  { d: "M12 6.1c4.2-.1 7.7 3.2 7.8 7.4.1 4.3-3.3 7.8-7.6 7.9-4.3.1-7.8-3.3-7.9-7.6-.1-4.3 3.4-7.7 7.7-7.7Z", f: true },
  { d: "M9.6 2.5c1.6-.1 3.3-.1 4.9.1M12 2.6v3.3M12 10.2v3.6l2.3-1.2M18.4 6.5l1.4-1.4" },
]);
export const ShoppingCart = sketch("ShoppingCart", [
  { d: "M2.3 3.2c.9-.1 1.9 0 2.8.2l2.4 11.1c.1.6.6 1 1.2 1h8.6c.6 0 1.1-.4 1.3-1l1.6-7.2c-4.8-.3-9.7-.4-14.5-.3" },
  { d: "M6.4 7.1c4.6-.2 9.2-.1 13.8.2l-1.5 7.2c-.1.6-.6 1-1.2 1H8.7c-.6 0-1.1-.4-1.2-1L6.4 7.1Z", f: true },
  { d: "M9.4 20.6a.9.9 0 1 0 .1 0M17.6 20.5a.9.9 0 1 0 .1 0" },
]);
export const Home = sketch("Home", [
  { d: "M3.3 10.6c2.8-2.5 5.6-4.9 8.6-7.2 3 2.3 5.9 4.7 8.7 7.3" },
  { d: "M5.2 9.2c-.2 3.6-.2 7.3 0 10.9 4.5.3 9.1.3 13.6 0 .2-3.6.2-7.3 0-10.9", f: true },
  { d: "M10 20.1c-.1-1.9-.1-3.8.1-5.6 1.3-.2 2.6-.2 3.9 0 .2 1.9.2 3.7 0 5.6" },
]);
export const Moon = sketch("Moon", [
  { d: "M20.6 14.1c-1.1 4.1-5.2 6.9-9.5 6.4-4.6-.6-7.9-4.7-7.4-9.3.4-4 3.6-7.1 7.5-7.6-2.4 3.2-1.9 7.8 1.2 10.4 2.4 2 5.6 2.2 8.2.1Z", f: true },
  { d: "M17.5 3.4v2.4M16.3 4.6h2.4" },
]);
export const Sun = sketch("Sun", [
  { d: "M12 7.7c2.5-.1 4.4 1.9 4.4 4.3 0 2.4-1.9 4.4-4.4 4.4-2.4 0-4.4-2-4.4-4.4 0-2.4 2-4.3 4.4-4.3Z", f: true },
  { d: "M12 2.3v2.1M12 19.6v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.3 12h2.1M19.6 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" },
]);
export const Settings = sketch("Settings", [
  { d: "M10.3 2.6c1.1-.2 2.3-.2 3.4 0l.5 2.3c.7.3 1.3.6 1.9 1.1l2.2-.7c.8.8 1.4 1.8 1.7 2.9l-1.7 1.6c.1.8.1 1.5 0 2.3l1.7 1.6c-.3 1.1-.9 2.1-1.7 2.9l-2.2-.7c-.6.5-1.2.8-1.9 1.1l-.5 2.3c-1.1.2-2.3.2-3.4 0l-.5-2.3c-.7-.3-1.3-.6-1.9-1.1l-2.2.7c-.8-.8-1.4-1.8-1.7-2.9l1.7-1.6c-.1-.8-.1-1.5 0-2.3L3.9 8.2c.3-1.1.9-2.1 1.7-2.9l2.2.7c.6-.5 1.2-.8 1.9-1.1l.6-2.3Z", f: true },
  { d: "M12 9.3c1.5 0 2.7 1.2 2.7 2.7 0 1.5-1.2 2.7-2.7 2.7-1.5 0-2.7-1.2-2.7-2.7 0-1.5 1.2-2.7 2.7-2.7Z" },
]);
export const Plus = sketch("Plus", [{ d: "M12.1 4.6c-.2 5-.2 9.9.1 14.8M4.7 12.2c4.9-.3 9.8-.3 14.7 0" }]);
export const X = sketch("X", [{ d: "M5.6 5.4c4.4 4.2 8.6 8.6 12.8 13.1M18.3 5.6c-4.3 4.2-8.5 8.5-12.6 12.9" }]);
export const Check = sketch("Check", [{ d: "M4.2 12.8c1.6 1.4 3.2 3 4.6 4.6 3.3-4.1 6.8-7.9 10.8-11.3" }]);
export const ChevronLeft = sketch("ChevronLeft", [{ d: "M14.8 5.2c-2.3 2.2-4.6 4.5-6.6 6.9 2.1 2.3 4.3 4.5 6.7 6.6" }]);
export const ChevronRight = sketch("ChevronRight", [{ d: "M9.2 5.3c2.4 2.1 4.6 4.3 6.6 6.7-2 2.4-4.2 4.6-6.6 6.7" }]);
const Trash2 = sketch("Trash2", [
  { d: "M3.6 6.3c5.6-.3 11.2-.3 16.8 0M9.1 6.1c0-1.1.1-2.1.3-3.1 1.7-.2 3.5-.2 5.2 0 .2 1 .3 2 .3 3.1" },
  { d: "M5.6 6.4c.3 4.3.6 8.6 1.1 12.9.1.9.8 1.5 1.7 1.5h7.2c.9 0 1.6-.6 1.7-1.5.5-4.3.8-8.6 1.1-12.9", f: true },
  { d: "M10.1 10.6c.1 2.4.2 4.8.4 7.1M13.9 10.6c-.1 2.4-.2 4.8-.4 7.1" },
]);
export const Download = sketch("Download", [
  { d: "M12 3.2c-.1 4.2-.1 8.4.1 12.6M7.4 11.4c1.6 1.5 3.1 3.1 4.6 4.7 1.6-1.6 3.1-3.2 4.6-4.7" },
  { d: "M3.6 15.9c-.1 1.3-.1 2.6.2 3.9 5.4.4 10.9.4 16.3 0 .2-1.3.3-2.6.2-3.9", f: true },
]);
export const Upload = sketch("Upload", [
  { d: "M12 16.1c-.1-4.2-.1-8.4.1-12.6M7.4 7.9c1.6-1.5 3.1-3.1 4.6-4.7 1.6 1.6 3.1 3.2 4.6 4.7" },
  { d: "M3.6 15.9c-.1 1.3-.1 2.6.2 3.9 5.4.4 10.9.4 16.3 0 .2-1.3.3-2.6.2-3.9", f: true },
]);
export const Search = sketch("Search", [
  { d: "M10.6 3.6c3.9-.1 7 3 7.1 6.8 0 3.9-3.1 7-6.9 7.1-3.9 0-7-3.1-7.1-6.9 0-3.9 3.1-7 6.9-7Z", f: true },
  { d: "M15.8 15.9c1.5 1.4 3 2.9 4.4 4.5" },
]);
export const AlertTriangle = sketch("AlertTriangle", [
  { d: "M10.4 4.2c.7-1.3 2.5-1.3 3.2 0 2.6 4.6 5.1 9.2 7.4 13.9.6 1.2-.3 2.6-1.6 2.6-4.9.2-9.9.2-14.8 0-1.3 0-2.2-1.4-1.6-2.6 2.3-4.7 4.8-9.3 7.4-13.9Z", f: true },
  { d: "M12 9.1c-.1 1.6-.1 3.1.1 4.6M12 17.1v.2" },
]);
export const Play = sketch("Play", [{ d: "M6.6 4.4c4.4 2.3 8.6 4.8 12.6 7.6-4 2.8-8.2 5.4-12.6 7.6-.3-5.1-.3-10.1 0-15.2Z", f: true }]);
export const Pause = sketch("Pause", [{ d: "M6.4 4.6c1.2-.2 2.4-.2 3.6 0 .2 4.9.2 9.9 0 14.8-1.2.2-2.4.2-3.6 0-.2-4.9-.2-9.9 0-14.8ZM14 4.6c1.2-.2 2.4-.2 3.6 0 .2 4.9.2 9.9 0 14.8-1.2.2-2.4.2-3.6 0-.2-4.9-.2-9.9 0-14.8Z", f: true }]);
export const RotateCcw = sketch("RotateCcw", [{ d: "M3.4 4.3c-.1 1.8 0 3.6.2 5.3 1.7.1 3.4.1 5.1-.1M3.8 9.4c1.4-3.6 5.1-5.8 9-5.3 4.4.6 7.6 4.6 7.1 9-.5 4.4-4.5 7.6-8.9 7.1-2.6-.3-4.8-1.8-6-4" }]);
export const SkipForward = sketch("SkipForward", [
  { d: "M5.1 5c3.5 2.2 6.9 4.5 10.1 7-3.2 2.5-6.6 4.8-10.1 7-.2-4.7-.2-9.3 0-14Z", f: true },
  { d: "M19.2 5.2c.2 4.5.2 9.1 0 13.6" },
]);
export const Keyboard = sketch("Keyboard", [
  { d: "M2.6 7.1c.1-1.1.8-1.8 1.9-1.9 5-.3 10-.3 15 0 1.1.1 1.8.8 1.9 1.9.2 3.3.2 6.5 0 9.8-.1 1.1-.8 1.8-1.9 1.9-5 .3-10 .3-15 0-1.1-.1-1.8-.8-1.9-1.9-.2-3.3-.2-6.5 0-9.8Z", f: true },
  { d: "M6.4 9.6h.2M10 9.6h.2M13.8 9.6h.2M17.5 9.6h.2M6.4 12.6h.2M17.5 12.6h.2M8.3 15.5c2.5-.2 5-.2 7.4 0" },
]);
export const Zap = sketch("Zap", [{ d: "M13.4 2.6c-2.8 3.4-5.4 7-7.9 10.6 2.1.1 4.1.1 6.2 0-.5 2.8-1 5.6-1.2 8.3 2.8-3.5 5.4-7.1 7.8-10.8-2.1-.1-4.1-.1-6.2 0 .4-2.7.9-5.4 1.3-8.1Z", f: true }]);
export const Coffee = sketch("Coffee", [
  { d: "M4.3 9.1c4.3-.2 8.5-.2 12.8 0 .2 3 .1 6-.3 8.9-.2 1.3-1.2 2.2-2.5 2.3-2.4.2-4.8.2-7.2 0-1.3-.1-2.3-1-2.5-2.3-.4-2.9-.5-5.9-.3-8.9Z", f: true },
  { d: "M17.2 10.2c1.7-.2 3.4.6 3.5 2.2.1 1.7-1.6 2.8-3.7 2.7M8 2.9c-.6.9-.6 2.1 0 3M11.7 2.6c-.6 1-.6 2.2 0 3.2" },
]);
export const BedDouble = sketch("BedDouble", [
  { d: "M3.1 19.7c-.2-3.1-.2-6.1 0-9.2 6-.3 11.9-.3 17.9 0 .2 3.1.2 6.1 0 9.2" },
  { d: "M3.2 15.2c5.9-.3 11.8-.3 17.7 0", f: true },
  { d: "M5 10.3c-.1-1.6-.1-3.2.1-4.8 4.6-.3 9.2-.3 13.8 0 .2 1.6.2 3.2.1 4.8M7.4 10.3c0-.8.1-1.5.3-2.2 1.2-.2 2.4-.2 3.5 0 .1.7.2 1.4.2 2.2M12.7 10.3c0-.8.1-1.5.3-2.2 1.2-.2 2.4-.2 3.5 0 .1.7.2 1.4.2 2.2" },
]);
export const Repeat = sketch("Repeat", [{ d: "M16.6 2.7c1.3 1 2.5 2.1 3.6 3.3-1.1 1.2-2.3 2.3-3.6 3.3M4 11.1c-.1-1.4 0-2.8.2-4.1 5.2-.4 10.5-.4 15.7-.1M7.4 21.3c-1.3-1-2.5-2.1-3.6-3.3 1.1-1.2 2.3-2.3 3.6-3.3M20 12.9c.1 1.4 0 2.8-.2 4.1-5.2.4-10.5.4-15.7.1" }]);
export const Users = sketch("Users", [
  { d: "M9 3.9c2.1-.1 3.7 1.6 3.7 3.7 0 2.1-1.7 3.7-3.8 3.7-2 0-3.7-1.7-3.7-3.7.1-2.1 1.8-3.7 3.8-3.7Z", f: true },
  { d: "M2.6 20.5c-.2-3.4 2.6-6 6.4-6 3.8 0 6.6 2.6 6.4 6M16 4.2c1.8.4 3 2 2.9 3.8-.1 1.6-1.2 2.9-2.8 3.3M18.3 14.7c2 .7 3.3 2.9 3.1 5.8" },
]);
export const Flame = sketch("Flame", [{ d: "M12.3 2.6c.6 2.6 2.2 4 3.7 5.8 1.7 2 2.7 4.1 2.3 6.7-.5 3.3-3.3 5.8-6.6 5.7-3.4-.1-6.1-2.9-6.1-6.4 0-1.8.7-3.2 1.9-4.6.3 1.4 1 2.4 2.1 2.9-.6-3.6.6-7.4 2.7-10.1Z", f: true }]);
export const ListChecks = sketch("ListChecks", [
  { d: "M3.3 6.1c.6.5 1.2 1.1 1.7 1.8 1.1-1.4 2.2-2.7 3.5-3.9M3.3 13.6c.6.5 1.2 1.1 1.7 1.8 1.1-1.4 2.2-2.7 3.5-3.9" },
  { d: "M11.6 6.6c3.1-.2 6.2-.2 9.2 0M11.6 13.6c3.1-.2 6.2-.2 9.2 0M4 19.7c5.6-.2 11.2-.2 16.8 0" },
]);
export const Wallet = sketch("Wallet", [
  { d: "M3.2 7.5c.1-1.5 1.1-2.5 2.6-2.6 4.6-.3 9.2-.3 13.8 0 .1 1 .1 2 0 3" },
  { d: "M3.2 7.6c.1 1 1 1.6 2 1.6 4.8-.2 9.6-.2 14.4 0 .9 0 1.4.6 1.4 1.4.1 2.8.1 5.6-.1 8.4-.1.8-.7 1.3-1.5 1.4-4.9.2-9.7.2-14.6 0-1-.1-1.7-.8-1.8-1.8-.2-3.7-.2-7.3.2-11Z", f: true },
  { d: "M16.3 14.4h.3" },
]);
export const Pencil = sketch("Pencil", [
  { d: "M15.8 3.7c1.1-1 2.7-1 3.7 0l.8.8c1 1 1 2.6 0 3.7-3.8 3.9-7.7 7.6-11.7 11.2-1.6.4-3.3.7-5 .9.2-1.7.5-3.4.9-5 3.7-3.9 7.4-7.8 11.3-11.6Z", f: true },
  { d: "M14 5.6c1.6 1.2 3 2.7 4.3 4.3" },
]);
export const TrendingUp = sketch("TrendingUp", [{ d: "M2.7 17.6c2.2-2.4 4.5-4.7 6.9-6.9 1.5 1.3 2.9 2.7 4.3 4.2 2.4-2.6 4.8-5.1 7.4-7.5M15.3 7.2c1.9-.1 3.8-.1 5.8.1.2 1.9.2 3.8.1 5.7" }]);
export const Receipt = sketch("Receipt", [
  { d: "M4.9 2.7c.2 6.2.2 12.4 0 18.6 1-.6 2-1.2 3-1.7 1 .6 2 1.1 3 1.6 1-.5 2-1.1 3-1.6 1 .6 2 1.1 3 1.7.2-6.2.2-12.4 0-18.6-1 .6-2 1.1-3 1.7-1-.6-2-1.1-3-1.7-1 .6-2 1.1-3 1.7-1-.6-2-1.1-3-1.7Z", f: true },
  { d: "M8.4 8.6c2.4-.2 4.8-.2 7.2 0M8.4 12.3c2.4-.2 4.8-.2 7.2 0M8.4 16c1.4-.1 2.7-.1 4 0" },
]);
export const Camera = sketch("Camera", [
  { d: "M3.2 8.4c.1-1.2.9-2 2.1-2.1h2.2l1.4-2.1c2.2-.2 4.4-.2 6.6 0l1.4 2.1h2.2c1.2.1 2 .9 2.1 2.1.2 3.5.2 7 0 10.5-.1 1.2-.9 2-2.1 2.1-4.4.3-8.9.3-13.3 0-1.2-.1-2-.9-2.1-2.1-.2-3.5-.2-7-.1-10.5Z", f: true },
  { d: "M12 9.6c2 0 3.6 1.6 3.6 3.6 0 2-1.6 3.6-3.6 3.6-2 0-3.6-1.6-3.6-3.6 0-2 1.6-3.6 3.6-3.6Z" },
]);
export const FileText = sketch("FileText", [
  { d: "M5.2 3.3c3-.2 6-.2 9 0l4.6 4.7c.2 4.1.2 8.3 0 12.4-4.5.3-9 .3-13.5 0-.3-5.7-.3-11.4-.1-17.1Z", f: true },
  { d: "M14 3.4c0 1.6 0 3.1.2 4.7 1.5.1 3 .1 4.6 0M8.4 12.4c2.4-.2 4.8-.2 7.2 0M8.4 16c2.4-.2 4.8-.2 7.2 0" },
]);
export const Maximize = sketch("Maximize", [{ d: "M3.6 8.4c-.1-1.6-.1-3.2.1-4.8 1.6-.2 3.2-.2 4.8 0M15.6 3.6c1.6-.2 3.2-.2 4.8 0 .2 1.6.2 3.2.1 4.8M20.4 15.6c.1 1.6.1 3.2-.1 4.8-1.6.2-3.2.2-4.8 0M8.4 20.4c-1.6.2-3.2.2-4.8 0-.2-1.6-.2-3.2-.1-4.8" }]);
export const Volume = sketch("Volume", [
  { d: "M3.4 9.3c1.1-.2 2.3-.2 3.4 0 1.9-1.7 3.9-3.3 6-4.8.3 5 .3 10 0 15-2.1-1.5-4.1-3.1-6-4.8-1.1.2-2.3.2-3.4 0-.2-1.8-.2-3.6 0-5.4Z", f: true },
  { d: "M16.4 9c1.2 1.9 1.2 4.1 0 6M19 6.4c2.4 3.4 2.4 7.8 0 11.2" },
]);
export const Palette = sketch("Palette", [
  { d: "M12 3.1c5 0 9 3.6 9 8.1 0 2.6-2.1 3.9-4.2 3.6-1.5-.2-2.5.9-1.9 2.3.6 1.4-.3 3.7-2.9 3.7-5 0-8.9-4-8.9-8.9 0-4.9 4-8.8 8.9-8.8Z", f: true },
  { d: "M7.6 11.2h.2M10.2 7.4h.2M14.6 7.4h.2" },
]);
export const Bookmark = sketch("Bookmark", [{ d: "M6.2 3.4c3.9-.2 7.7-.2 11.6 0 .3 5.8.3 11.6 0 17.4-2-1.6-3.9-3.1-5.8-4.5-1.9 1.4-3.8 2.9-5.8 4.5-.3-5.8-.3-11.6 0-17.4Z", f: true }]);
export const Database = sketch("Database", [
  { d: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z", f: true },
  { d: "M4 6.1c-.1 4-.1 7.9.1 11.9.4 1.7 3.8 3 7.9 3s7.5-1.3 7.9-3c.2-4 .2-7.9.1-11.9M4.1 12c.4 1.6 3.8 2.9 7.9 2.9s7.5-1.3 7.9-2.9" },
]);
export const MoreVertical = sketch("MoreVertical", [{ d: "M12 3.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2ZM12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2ZM12 17.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2Z", f: true }]);
export const Sparkles = sketch("Sparkles", [
  { d: "M10.5 3.2c.6 3.2 2.3 5 5.5 5.8-3.2.7-4.9 2.6-5.5 5.8-.6-3.2-2.4-5.1-5.6-5.8 3.2-.8 5-2.6 5.6-5.8Z", f: true },
  { d: "M18.4 13.6c.3 1.5 1.1 2.3 2.6 2.7-1.5.3-2.3 1.2-2.6 2.7-.3-1.5-1.2-2.4-2.7-2.7 1.5-.4 2.4-1.2 2.7-2.7ZM5.6 16.4c.2 1 .8 1.6 1.8 1.8-1 .2-1.6.8-1.8 1.8-.2-1-.8-1.6-1.8-1.8 1-.2 1.6-.8 1.8-1.8Z" },
]);

// ---------------------------------------------------------------- Primitives UI
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: ID; text: string; tone: "ok" | "info" | "bad"; action?: ToastAction }
interface Ctx {
  state: AppState; dispatch: React.Dispatch<Action>; toast: (text: string, tone?: Toast["tone"], action?: ToastAction) => void;
  /** Exécute une action destructrice et propose « Annuler » pendant quelques secondes (restaure l'état précédent). */
  undoable: (a: Action, text: string) => void;
  go: (v: ViewKey) => void; openTask: (id: ID | null) => void; now: number;
  env: AppEnv;
}
const StoreCtx = createContext<Ctx | null>(null);
const useStore = () => { const c = useContext(StoreCtx); if (!c) throw new Error("StoreCtx manquant"); return c; };

export const Card: React.FC<{ title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, action, className, children }) => (
  <section className={cx("inked min-w-0 rounded-[20px] bg-panel", className)}>
    {(title || action) && (
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h3 className="font-display text-[15px] font-bold tracking-tight text-fg">{title}</h3>
        <div className="flex items-center gap-2">{action}</div>
      </header>
    )}
    <div className="p-5">{children}</div>
  </section>
);
export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "soft" | "danger"; size?: "sm" | "md" }> =
  ({ variant = "soft", size = "md", className, ...p }) => (
    <button {...p} className={cx(
      "press inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
      size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
      variant === "primary" && "btn-ink bg-accent text-onaccent",
      variant === "soft" && "border-2 border-fg/80 bg-panel text-fg hover:bg-hi/40",
      variant === "ghost" && "text-muted hover:bg-sunken hover:text-fg",
      variant === "danger" && "text-bad hover:bg-bad/10",
      className)} />
  );
export const inputCls = "h-9 w-full min-w-0 rounded-xl border-2 border-line bg-panel transition-colors hover:border-fg/50 px-3 text-[13px] text-fg placeholder:text-muted/70 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, "pr-7", p.className)} />;
export const Field: React.FC<{ label: string; htmlFor: string; children: React.ReactNode; className?: string }> = ({ label, htmlFor, children, className }) => (
  <label htmlFor={htmlFor} className={cx("flex min-w-0 flex-col gap-1", className)}>
    <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>{children}
  </label>
);
export const Pill: React.FC<{ tone?: "ok" | "warn" | "bad" | "info" | "muted"; children: React.ReactNode }> = ({ tone = "muted", children }) => (
  <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-current/30 px-2 py-0.5 text-[11px] font-semibold",
    tone === "ok" && "bg-ok/12 text-ok", tone === "warn" && "bg-warn/15 text-warn", tone === "bad" && "bg-bad/12 text-bad",
    tone === "info" && "bg-accent/12 text-accent", tone === "muted" && "bg-sunken text-muted")}>{children}</span>
);
export const Empty: React.FC<{ icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center">
    <div className="sticker grid h-12 w-12 place-items-center rounded-2xl border-2 border-fg bg-hi text-[rgb(24_22_46)]">{icon}</div>
    <p className="font-display text-base font-bold text-fg">{title}</p>
    <p className="max-w-xs text-xs text-muted">{hint}</p>{action}
  </div>
);
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="rounded border border-line bg-sunken px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>
);
export const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }> = ({ label, value, sub, tone }) => (
  <div className="inked lift h-full min-w-0 rounded-[20px] bg-panel p-4">
    <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">{label}</p>
    <p key={value} className={cx("bump mt-1 font-display text-[22px] leading-tight min-[400px]:text-[26px] lg:text-[28px] font-extrabold tabular-nums tracking-tight", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-fg")}>{value}</p>
    {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
  </div>
);
export const LoadMeter: React.FC<{ load: number; level: DayPlan["level"] }> = ({ load, level }) => {
  const tone = level === "surcharge" ? "bg-bad" : level === "chargé" ? "bg-warn" : "bg-ok";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className={cx("h-full rounded-full transition-all", tone)} style={{ width: `${Math.min(100, load * 100)}%` }} /></div>
      <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{Math.round(load * 100)}%</span>
    </div>
  );
};
const levelTone = (l: DayPlan["level"]) => (l === "surcharge" ? "bad" : l === "chargé" ? "warn" : l === "équilibré" ? "info" : "ok") as "bad" | "warn" | "info" | "ok";

/** Graphique en barres SVG à l'échelle, avec ligne d'objectif optionnelle. */
export const BarChart: React.FC<{ data: { label: string; value: number; missing?: boolean; tone?: "ok" | "warn" | "bad" | "accent" }[]; max?: number; goal?: number; unit?: (v: number) => string; height?: number }> =
  ({ data, max, goal, unit = (v) => String(Math.round(v)), height = 140 }) => {
    const W = 320, H = height, padL = 34, padB = 20, padT = 8;
    const top = Math.max(max ?? 0, goal ?? 0, ...data.map((d) => d.value), 1);
    const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
    const bw = (W - padL) / data.length;
    const ticks = [0, top / 2, top];
    const fill = { ok: "rgb(var(--ok))", warn: "rgb(var(--warn))", bad: "rgb(var(--bad))", accent: "rgb(var(--accent))" };
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto max-h-60 w-full" role="img">
        {ticks.map((t) => (
          <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="rgb(var(--muted))" className="font-mono">{unit(t)}</text></g>
        ))}
        {goal !== undefined && <line x1={padL} x2={W} y1={y(goal)} y2={y(goal)} stroke="rgb(var(--fg))" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />}
        {data.map((d, i) => (
          <g key={i}>
            {d.missing ? <line x1={padL + i * bw + bw * 0.3} x2={padL + i * bw + bw * 0.7} y1={H - padB - 3} y2={H - padB - 3} stroke="rgb(var(--muted))" strokeWidth={2} strokeLinecap="round"><title>{`${d.label} : non saisi`}</title></line> :
            <rect x={padL + i * bw + bw * 0.18} y={y(d.value)} width={bw * 0.64} height={Math.max(0, H - padB - y(d.value))} rx={3} fill={fill[d.tone ?? "accent"]} opacity={i === data.length - 1 ? 1 : 0.75}>
              <title>{`${d.label} : ${unit(d.value)}`}</title>
            </rect>}
            <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="rgb(var(--muted))">{d.label}</text>
          </g>
        ))}
      </svg>
    );
  };

// ---------------------------------------------------------------- Formulaire tâche (partagé)
/** Choix entre « durée » (placement automatique) et « horaire précis » (début / fin). */
const TimeMode: React.FC<{ value: "duration" | "slot"; onChange: (v: "duration" | "slot") => void; id: string; className?: string }> = ({ value, onChange, id, className }) => (
  <div className={cx("flex min-w-0 flex-col gap-1", className)}>
    <span id={id} className="text-[11px] font-medium uppercase tracking-wider text-muted">Temps</span>
    <div role="radiogroup" aria-labelledby={id} className="grid h-9 grid-cols-2 gap-1 rounded-xl border-2 border-line bg-sunken p-0.5 text-[12px] font-semibold">
      {([["duration", "Durée"], ["slot", "Horaire précis"]] as const).map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={cx("truncate rounded-lg px-2 transition", value === k ? "bg-panel text-fg shadow-[2px_2px_0_0_rgb(var(--ink))] ring-1 ring-fg/70" : "text-muted hover:text-fg")}>{l}</button>))}
    </div>
  </div>
);

/** Liste d'étapes cochables (checklist). */
export const StepsCheck: React.FC<{ steps: Step[]; done: (id: ID) => boolean; onToggle: (id: ID) => void; small?: boolean; label?: string }> = ({ steps, done, onToggle, small, label }) => (
  <ul className="flex flex-col gap-1" aria-label={label ?? "Checklist"}>
    {steps.map((x) => { const d = done(x.id); return (
      <li key={x.id}><button type="button" onClick={() => onToggle(x.id)} aria-pressed={d} className={cx("flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-sunken", small ? "text-[12px]" : "text-[13px]")}>
        <span className={cx("mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded border-2 transition", d ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40")}>{d && <Check size={10} strokeWidth={3} />}</span>
        <span className={cx("min-w-0 flex-1 break-words", d && "text-muted line-through")}>{x.text}</span>
      </button></li>); })}
  </ul>
);
/** Édition d'une checklist : ajout (Entrée), suppression, et cases à cocher si `checkable`. */
export const StepsEditor: React.FC<{ id: string; steps: Step[]; onChange: (s: Step[]) => void; checkable?: boolean; className?: string; placeholder?: string }> = ({ id, steps, onChange, checkable, className, placeholder }) => {
  const [txt, setTxt] = useState("");
  const add = () => { const t = txt.trim(); if (!t) return; if (steps.length >= 40) return; onChange([...steps, { id: uid(), text: t.slice(0, 120), ...(checkable ? { done: false } : {}) }]); setTxt(""); };
  const done = steps.filter((x) => x.done).length;
  return (
    <div className={className}>
      <p className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted"><label htmlFor={id}>Checklist</label>{checkable && steps.length > 0 && <span className="font-mono normal-case tabular-nums">{done}/{steps.length}</span>}</p>
      {steps.length > 0 && <ul className="mb-1.5 flex flex-col gap-1">{steps.map((x, i) => (
        <li key={x.id} className="flex items-center gap-2 text-[13px]">
          {checkable ? <button type="button" aria-label={x.done ? `Décocher ${x.text}` : `Cocher ${x.text}`} onClick={() => onChange(steps.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)))}
            className={cx("grid h-4 w-4 shrink-0 place-items-center rounded border-2", x.done ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40")}>{x.done && <Check size={10} strokeWidth={3} />}</button>
            : <span className="w-4 shrink-0 text-center font-mono text-[11px] text-muted">{i + 1}.</span>}
          <input aria-label={`Étape ${i + 1}`} value={x.text} onChange={(e) => onChange(steps.map((y) => (y.id === x.id ? { ...y, text: e.target.value } : y)))}
            className={cx("min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 outline-none focus:border-line", x.done && "text-muted line-through")} />
          <button type="button" className="p-1 text-muted hover:text-bad" aria-label={`Supprimer l'étape ${x.text}`} onClick={() => onChange(steps.filter((y) => y.id !== x.id))}><X size={12} /></button>
        </li>))}</ul>}
      <div className="flex gap-2">
        <Input id={id} value={txt} placeholder={placeholder ?? "Ajouter une étape…"} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Btn type="button" onClick={add} aria-label="Ajouter l'étape" disabled={!txt.trim()}><Plus size={14} /></Btn>
      </div>
    </div>
  );
};

const TaskForm: React.FC<{ onDone: () => void; task?: Task }> = ({ onDone, task }) => {
  const { state, dispatch, toast } = useStore();
  const [f, setF] = useState(task
    ? { title: task.title, courseId: task.courseId ?? "", kind: task.kind, deadline: task.deadline, estimate: task.estimate, priority: task.priority, spent: task.spent }
    : { title: "", courseId: state.courses[0]?.id ?? "", kind: "devoir" as TaskKind, deadline: iso(addDays(new Date(), 3)), estimate: 120, priority: 2 as Priority, spent: 0 });
  const [mode, setMode] = useState<"duration" | "slot">(task?.slot ? "slot" : "duration");
  const [slot, setSlot] = useState(task?.slot ?? { date: todayISO(), start: "14:00", end: "16:00" });
  const [steps, setSteps] = useState<Step[]>(task?.steps ?? []);
  const [doDates, setDoDates] = useState<string[]>(task?.doDates ?? []);
  const [doPick, setDoPick] = useState(todayISO());
  const [doMode, setDoMode] = useState<"auto" | "pick" | "none">(task?.noPlan ? "none" : task?.doDates?.length ? "pick" : "auto");
  const pickDays = doMode === "pick";
  const isExam = f.kind === "examen", isPerso = f.kind === "perso";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { toast("Donnez un titre à la tâche.", "bad"); return; }
    if (isPerso) {
      const data = { ...f, title: f.title.trim(), courseId: f.courseId || null, deadline: NO_DEADLINE, slot: undefined, ...(pickDays && doDates.length ? { doDates: [...doDates].sort(), noPlan: undefined } : { doDates: undefined, noPlan: true }), steps: steps.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text) };
      if (task) { dispatch({ type: "task/update", id: task.id, patch: data }); toast("Tâche mise à jour"); }
      else { dispatch({ type: "task/add", task: { id: uid(), status: "todo", createdAt: todayISO(), ...data } }); toast(pickDays && doDates.length ? "Devoir perso ajouté, placé sur vos jours choisis" : "Devoir perso ajouté (sans échéance)"); }
      onDone(); return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deadline) || isNaN(parseISO(f.deadline).getTime())) { toast("Choisissez une date d'échéance valide.", "bad"); return; }
    let estimate = f.estimate, chosen: Task["slot"] | undefined;
    if (mode === "slot") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) { toast("Choisissez le jour du créneau.", "bad"); return; }
      if (toMin(slot.end) <= toMin(slot.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
      chosen = slot; estimate = toMin(slot.end) - toMin(slot.start);
    } else if (!(f.estimate >= 5)) { toast("L'estimation doit être d'au moins 5 minutes.", "bad"); return; }
    if (!(f.spent >= 0)) { toast("Le temps passé ne peut pas être négatif.", "bad"); return; }
    if (!task && f.deadline < todayISO()) toast("Échéance déjà passée : la tâche apparaîtra en retard.", "info");
    const data = { ...f, estimate, title: f.title.trim(), courseId: f.courseId || null, slot: chosen, steps: steps.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text), doDates: mode === "duration" && pickDays && doDates.length ? [...doDates].sort() : undefined, noPlan: mode === "duration" && doMode === "none" ? true : undefined };
    if (data.doDates?.some((d) => d > f.deadline)) { toast(isExam ? "Les jours de révision doivent être avant l'examen." : "Les jours de travail doivent être avant l'échéance.", "bad"); return; }
    if (task) { dispatch({ type: "task/update", id: task.id, patch: data }); toast("Tâche mise à jour"); }
    else { const { slot: sl, ...rest } = data; dispatch({ type: "task/add", task: { id: uid(), ...rest, ...(sl ? { slot: sl } : {}), status: "todo", createdAt: todayISO() } }); toast(sl ? `Tâche ajoutée : ${fmtDate(sl.date)}, ${sl.start}–${sl.end}` : "Tâche ajoutée et planifiée"); }
    onDone();
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Titre" htmlFor="tf-title" className="col-span-2 sm:col-span-4"><Input id="tf-title" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex. Fiche de révision chapitre 4" /></Field>
      <Field label="Module" htmlFor="tf-course" className="col-span-2"><Select id="tf-course" value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })}>
        <option value="">Sans module</option>{state.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Type" htmlFor="tf-kind"><Select id="tf-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })}>
        <option value="devoir">Devoir</option><option value="examen">Examen</option><option value="projet">Projet</option><option value="perso">Devoir perso (sans échéance)</option></Select></Field>
      <Field label="Priorité" htmlFor="tf-prio"><Select id="tf-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) as Priority })}>
        <option value={1}>Basse</option><option value={2}>Normale</option><option value={3}>Haute</option></Select></Field>
      {isPerso ? <div className="col-span-2 flex flex-col gap-2 sm:col-span-4" data-testid="perso-do">
        <p className="rounded-lg bg-sunken p-2.5 text-[12px] text-muted">Devoir perso : pas d'échéance. Vous pouvez quand même choisir des jours pour y travailler (do date).</p>
        <div className="flex gap-1.5" role="group">{([["none", "🚫 Pas de do date"], ["pick", "📅 Choisir mes jours"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={(v === "pick") === pickDays} onClick={() => { setDoMode(v); if (v === "none") setDoDates([]); }}
          className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold", (v === "pick") === pickDays ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>)}</div>
        {pickDays && <>
          <div className="flex flex-wrap items-center gap-1.5">
            {[...doDates].sort().map((d) => <span key={d} className="inline-flex items-center gap-1 rounded-full border-2 border-fg bg-hi px-2.5 py-0.5 text-[12px] font-medium text-[rgb(24_22_46)]">{fmtDate(d)}<button type="button" aria-label={`Retirer le ${fmtDate(d)}`} onClick={() => setDoDates(doDates.filter((x) => x !== d))}><X size={11} /></button></span>)}
            <Input type="date" aria-label="Jour de travail" value={doPick} min={todayISO()} onChange={(e) => setDoPick(e.target.value)} className="h-8 w-auto py-0 text-[12px]" />
            <Btn type="button" size="sm" onClick={() => { if (doPick && !doDates.includes(doPick)) setDoDates([...doDates, doPick]); }}><Plus size={12} />Ajouter</Btn>
          </div>
          <Field label="Durée estimée (min)" htmlFor="tf-pest"><Input id="tf-pest" type="number" min={15} step={15} value={f.estimate} onChange={(e) => setF({ ...f, estimate: Math.max(15, Number(e.target.value)) })} /></Field>
        </>}
      </div> : <>
      <Field label={isExam ? "Date de l'examen" : "Échéance (à rendre)"} htmlFor="tf-dl" className="col-span-2"><Input id="tf-dl" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
      <TimeMode id="tf-mode" value={mode} onChange={setMode} className="col-span-2" />
      {mode === "duration" ? <>
        <Field label="Durée estimée (min)" htmlFor="tf-est" className="col-span-2"><Input id="tf-est" type="number" min={15} step={15} value={f.estimate} onChange={(e) => setF({ ...f, estimate: Math.max(15, Number(e.target.value)) })} /></Field>
        <p className="col-span-2 self-end pb-2 text-[11px] text-muted">{doMode === "none" ? "Non placée dans le planning." : doDates.length ? `Répartie sur ${doDates.length} jour${doDates.length > 1 ? "s" : ""} choisi${doDates.length > 1 ? "s" : ""}.` : "Répartie automatiquement dans vos créneaux libres avant l'échéance."}</p>
        <div className="col-span-2 sm:col-span-4" data-testid="do-dates">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{isExam ? "Jours de révision" : "Jours de travail (do date)"}</p>
          <div className="mb-2 flex gap-1.5" role="group">
            {([["auto", "⚡ Automatique"], ["pick", isExam ? "📅 Choisir mes jours de révision" : "📅 Choisir mes jours"], ["none", "🚫 Pas de do date"]] as ["auto" | "pick" | "none", string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={doMode === v} onClick={() => { setDoMode(v); if (v !== "pick") setDoDates([]); }}
                className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold transition", doMode === v ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>))}
          </div>
          {pickDays && <div className="flex flex-wrap items-center gap-1.5">
            {[...doDates].sort().map((d) => <span key={d} className="inline-flex items-center gap-1 rounded-full border-2 border-fg bg-hi px-2.5 py-0.5 text-[12px] font-medium text-[rgb(24_22_46)]">{fmtDate(d)}
              <button type="button" aria-label={`Retirer le ${fmtDate(d)}`} onClick={() => setDoDates(doDates.filter((x) => x !== d))}><X size={11} /></button></span>)}
            <Input type="date" aria-label={isExam ? "Jour de révision" : "Jour de travail"} value={doPick} min={todayISO()} max={f.deadline} onChange={(e) => setDoPick(e.target.value)} className="h-8 w-auto py-0 text-[12px]" />
            <Btn type="button" size="sm" onClick={() => { if (doPick && !doDates.includes(doPick)) setDoDates([...doDates, doPick]); }}><Plus size={12} />Ajouter</Btn>
          </div>}
          <p className="mt-1 text-[11px] text-muted">{doMode === "none" ? "Aucun temps de travail n'est placé dans le planning : la tâche reste juste dans votre liste jusqu'à l'échéance." : doMode === "auto" ? "Le travail est réparti automatiquement dans vos créneaux libres jusqu'à l'échéance." : isExam ? "Le temps de révision est réparti uniquement sur ces jours, avant l'examen." : "Le travail est placé uniquement ces jours-là, avant l'échéance."}</p>
        </div>
      </> : <>
        <Field label="Jour" htmlFor="tf-sday" className="col-span-2"><Input id="tf-sday" type="date" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} /></Field>
        <Field label="Début" htmlFor="tf-sstart"><Input id="tf-sstart" type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} /></Field>
        <Field label="Fin" htmlFor="tf-send"><Input id="tf-send" type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} /></Field>
      </>}
      </>}
      <StepsEditor id="tf-steps" steps={steps} onChange={setSteps} checkable className="col-span-2 sm:col-span-4" placeholder="Ex. Lire le chapitre, faire les exercices…" />
      {task && <Field label="Temps déjà passé (min)" htmlFor="tf-spent" className="col-span-2"><Input id="tf-spent" type="number" min={0} step={5} value={f.spent} onChange={(e) => setF({ ...f, spent: Math.max(0, Number(e.target.value)) })} /></Field>}
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-4"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary">{task ? <><Check size={14} />Enregistrer</> : <><Plus size={14} />Ajouter</>}</Btn></div>
    </form>
  );
};

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  // Affichée à la racine de la page (portail) : couvre aussi l'en-tête et le menu, quel que soit l'endroit d'où elle est ouverte.
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 backdrop-blur-[2px] animate-fade sm:items-start sm:px-4 sm:pt-[12vh]" onMouseDown={onClose}>
      <div className="inked sheet max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-panel animate-pop sm:max-h-[80vh] sm:rounded-[22px]" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-display text-lg font-bold">{title}</h2><Btn variant="ghost" size="sm" onClick={onClose} aria-label="Fermer"><X size={14} /></Btn></header>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
};

// ---------------------------------------------------------------- Chargement à la demande (PDF, OCR)
const scriptCache = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!scriptCache.has(src)) scriptCache.set(src, new Promise((ok, ko) => {
    const el = document.createElement("script"); el.src = src; el.async = true;
    el.onload = () => ok(); el.onerror = () => { scriptCache.delete(src); ko(new Error("Chargement impossible : " + src)); };
    document.head.appendChild(el);
  }));
  return scriptCache.get(src)!;
}
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const hexRgb = (h?: string): [number, number, number] | null => { const m = /^#?([0-9a-f]{6})$/i.exec(h ?? ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const KIND_RGB: Record<Block["kind"], [number, number, number]> = { class: [52, 72, 240], task: [52, 72, 240], chore: [217, 140, 20], meal: [160, 156, 180], sleep: [120, 120, 140], busy: [130, 126, 150], event: [233, 60, 130] };

/** Planning de la semaine en PDF (A4 paysage, grille horaire), généré dans le navigateur, sans connexion. */
async function exportWeekPdf(week: DayPlan[], name: string): Promise<"shared" | "downloaded"> {
  const W = 297, H = 210, M = 10, top = 27, left = M + 11;
  const doc = new MiniPdf(W, H);
  const ink: [number, number, number] = [24, 22, 46], muted: [number, number, number] = [110, 106, 140], grid: [number, number, number] = [215, 212, 228];
  const blocks = week.flatMap((d) => d.blocks.filter((b) => b.kind !== "sleep"));
  const minH = Math.max(0, Math.floor(Math.min(8 * 60, ...blocks.map((b) => b.start)) / 60));
  const maxH = Math.min(26, Math.ceil(Math.max(20 * 60, ...blocks.map((b) => b.end)) / 60));
  const colW = (W - left - M) / 7, rowH = (H - top - M) / (maxH - minH);
  const first = parseISO(week[0].date), last = parseISO(week[6].date);
  doc.text(M, 15, `Planning - semaine ${isoWeek(first)}`, 16, ink, { bold: true });
  doc.text(M, 21, `${first.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} au ${last.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}${name ? ` - ${name}` : ""}`, 9, muted);
  doc.text(W - M, 15, "Etudiant.OS", 10, muted, { bold: true, align: "right" });
  for (let h = minH; h <= maxH; h++) { const y = top + (h - minH) * rowH; doc.line(left, y, W - M, y, grid); if (h < maxH) doc.text(M, y + 3, `${pad(h % 24)}:00`, 7, muted); }
  week.forEach((d, i) => {
    const x = left + i * colW, date = parseISO(d.date);
    doc.line(x, top - 6, x, H - M, grid);
    doc.text(x + colW / 2, top - 2, `${DAYS[weekday(date)]} ${date.getDate()}`, 9, ink, { bold: true, align: "center" });
    const shown = d.blocks.filter((b) => b.kind !== "sleep"), ln = layoutLanes(shown);
    shown.forEach((b, bi) => {
      const lw = (colW - 1.2) / ln[bi].lanes, lx = x + 0.6 + ln[bi].lane * lw;
      const y = top + ((b.start - minH * 60) / 60) * rowH; if (y + 1 > H - M) return;
      const h = Math.min(Math.max(3.4, ((b.end - b.start) / 60) * rowH - 0.4), H - M - y);
      const rgb = (b.kind === "class" || b.kind === "task" ? hexRgb(b.color) : null) ?? KIND_RGB[b.kind];
      doc.rect(lx, y + 0.2, lw - 0.3, h, rgb.map((c) => Math.round(c + (255 - c) * 0.82)) as [number, number, number], rgb, 0.2);
      doc.rect(lx, y + 0.2, 1, h, rgb);
      const label = doc.wrap(b.label, lw - 3.5, 6.5);
      const lines = h >= 7 ? [`${toHHMM(b.start)}-${toHHMM(b.end)}`, ...label] : [`${toHHMM(b.start)} ${label[0] ?? ""}`];
      lines.slice(0, Math.max(1, Math.floor((h - 0.6) / 2.6))).forEach((l, k) => doc.text(lx + 1.8, y + 2.9 + k * 2.6, l, 6.5, k === 0 && h >= 7 ? muted : ink, { bold: k === 1 }));
    });
  });
  doc.line(W - M, top - 6, W - M, H - M, grid);
  const blob = new Blob([doc.bytes()], { type: "application/pdf" });
  const file = `planning-semaine-${isoWeek(first)}.pdf`;
  const f = new File([blob], file, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  // iPhone / iPad : la feuille de partage permet « Enregistrer dans Fichiers » ou d'imprimer (le téléchargement direct y est peu fiable).
  if (/iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document && nav.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: file }); return "shared"; } catch (e) { if ((e as Error).name === "AbortError") return "shared"; }
  }
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> } };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getTextContent: () => Promise<{ items: { str: string; transform: number[] }[] }>;
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};
async function pdfjs(): Promise<PdfJs> {
  await loadScript(PDFJS + "pdf.min.js");
  const lib = (window as unknown as { pdfjsLib: PdfJs }).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
  return lib;
}
// Petit stockage de fichiers (PDF de l'emploi du temps) dans IndexedDB : trop gros pour localStorage.
function idb<T>(mode: IDBTransactionMode, run: (st: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((ok, ko) => {
    const open = indexedDB.open("etudiant-os", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => ko(open.error);
    open.onsuccess = () => { const tx = open.result.transaction("files", mode); const rq = run(tx.objectStore("files")); rq.onsuccess = () => ok(rq.result as T); rq.onerror = () => ko(rq.error); };
  });
}
export const fileSave = (k: string, v: Blob) => idb<void>("readwrite", (st) => st.put(v, k));
export const fileLoad = (k: string) => idb<Blob | undefined>("readonly", (st) => st.get(k));
export const fileDelete = (k: string) => idb<void>("readwrite", (st) => st.delete(k));

// ---------------------------------------------------------------- Lecture de ticket de caisse
/** Ce que l'utilisateur a confirmé après relecture (rien n'est enregistré avant). */
export interface ReceiptConfirm {
  amount: number | null; date: string | null; store: string;
  items: { name: string; price: number; qty: number; kind: "item" | "discount" }[];
  /** Empreinte date|centimes du ticket (vide si date ou total inconnus). */
  fingerprint: string;
  /** L'utilisateur a accepté d'ajouter un ticket qui semble déjà enregistré. */
  allowDuplicate: boolean;
}
const FLAG_TEXT: Record<string, string> = {
  price_next_line: "Prix lu sur la ligne suivante", price_repaired: "Prix corrigé (caractère confondu avec un chiffre)", price_partial: "Prix à un seul chiffre après la virgule",
  price_ambiguous: "Prix illisible ou ambigu", price_high: "Prix très élevé", qty_computed: "Total de la ligne calculé", qty_incoherent: "Quantité × prix ne correspond pas au total de la ligne",
  name_unclear: "Nom peu lisible", name_missing: "Nom illisible", negative_price: "Montant négatif : traité comme une remise",
};
const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");
type Row = { id: string; name: string; qty: string; price: string; kind: "item" | "discount"; conf: "high" | "medium" | "low"; flags: string[] };

/** Fenêtre de relecture : tout est modifiable ; rien n'est enregistré avant « Utiliser ces données ». */
const ReceiptReview: React.FC<{ result: ReceiptResult; items: ReceiptItem[]; info: OcrOutput["info"]; meanConfidence: number | null; withDate: boolean; withItems: boolean; today: string; known: string[]; onConfirm: (c: ReceiptConfirm) => void; onCancel: () => void }> =
  ({ result, items, info, meanConfidence, withDate, withItems, today, known, onConfirm, onCancel }) => {
    const [amount, setAmount] = useState(result.amount !== null ? result.amount.toFixed(2).replace(".", ",") : "");
    const [date, setDate] = useState(result.dateStatus === "ok" && result.date && result.date <= today ? result.date : "");
    const [store, setStore] = useState(result.storeConfidence === "high" ? result.store : "");
    const [rows, setRows] = useState<Row[]>(() => items.map((it) => ({ id: uid(), name: it.name, qty: String(it.qty), price: it.price === null ? "" : it.price.toFixed(2).replace(".", ","), kind: it.kind, conf: it.confidence, flags: it.flags })));
    const [dup, setDup] = useState(false);
    useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onCancel]);
    const amt = amount.trim() ? parseAmount(amount) : NaN;
    const amtOk = amt > 0 && amt < 100000;
    // une ligne corrigée par l'utilisateur n'est plus « incertaine »
    const upd = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, ...(patch.name !== undefined || patch.price !== undefined ? { conf: "high" as const, flags: [] } : {}) } : r)));
    const cents = rows.reduce((n, r) => { const v = r.price.trim() ? parseAmount(r.price) : NaN; return isNaN(v) ? n : n + Math.round(v * 100); }, 0);
    const unknown = rows.filter((r) => !r.price.trim() || isNaN(parseAmount(r.price))).length;
    const gap = amtOk && rows.length ? cents - Math.round(amt * 100) : null;
    const diverge = gap !== null && (Math.abs(gap) >= 1 || unknown > 0);
    const fp = receiptFingerprint(date || null, amtOk ? amt : null);
    const isDup = !!fp && known.includes(fp);
    const missingDate = withDate && !date;
    const submit = () => {
      if (!amtOk || (isDup && !dup)) return;
      onConfirm({
        amount: amt, date: date || null, store: store.trim(), fingerprint: fp, allowDuplicate: isDup && dup,
        items: rows.map((r) => ({ name: r.name.trim(), price: r.price.trim() ? parseAmount(r.price) : NaN, qty: Math.max(1, parseInt(r.qty, 10) || 1), kind: r.kind })).filter((r) => !isNaN(r.price) && (r.kind === "discount" || r.name)),
      });
    };
    return createPortal(
      <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/40 backdrop-blur-[2px] animate-fade sm:items-start sm:px-4 sm:pt-[6vh]">
        <div className="inked sheet max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[22px] bg-panel animate-pop sm:max-h-[86vh] sm:rounded-[22px]" role="dialog" aria-modal="true" aria-label="Relire le ticket" data-testid="receipt-review">
          <header className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-display text-lg font-bold">Relire le ticket</h2><Btn variant="ghost" size="sm" onClick={onCancel} aria-label="Fermer"><X size={14} /></Btn></header>
          <div className="flex flex-col gap-3 p-5">
            <p className="text-xs text-muted">La lecture automatique peut se tromper. Vérifiez, corrigez, puis validez : rien n'est enregistré avant.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Total du ticket" htmlFor="rv-amount"><Input id="rv-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              {withDate && <Field label="Date" htmlFor="rv-date"><Input id="rv-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
              <Field label="Magasin" htmlFor="rv-store" className="col-span-2"><Input id="rv-store" placeholder="Non détecté" value={store} onChange={(e) => setStore(e.target.value)} /></Field>
            </div>
            {result.storeConfidence === "low" && !store && <p className="text-xs text-muted">{`Magasin incertain : « ${result.store} ».`} <button type="button" className="font-semibold underline" onClick={() => setStore(result.store)}>Utiliser</button></p>}
            <div className="flex flex-col gap-1.5" data-testid="receipt-warnings">
              {result.totalStatus === "conflict" && <p className="rounded-lg bg-warn/15 px-3 py-2 text-xs"><AlertTriangle size={12} className="mr-1 inline" />Plusieurs totaux différents lus sur le ticket. Choisissez le bon : {result.totalCandidates.map((c) => <button key={c} type="button" className="mx-0.5 rounded-full border-2 border-line px-2 font-mono font-semibold hover:border-fg/60" onClick={() => setAmount(c.toFixed(2).replace(".", ","))}>{money(c)}</button>)}</p>}
              {result.totalStatus === "absent" && <p className="rounded-lg bg-warn/15 px-3 py-2 text-xs"><AlertTriangle size={12} className="mr-1 inline" />Aucun total fiable détecté. Saisissez-le à la main.</p>}
              {result.totalStatus === "derived" && <p className="rounded-lg bg-sunken px-3 py-2 text-xs">Aucun total imprimé lu : le montant est calculé à partir de « espèces » moins « rendu ». Vérifiez-le.</p>}
              {missingDate && <p className="rounded-lg bg-sunken px-3 py-2 text-xs">{result.dateStatus === "ambiguous" ? "Plusieurs dates différentes lues : choisissez la bonne." : result.dateStatus === "invalid" ? "Une date a été lue mais elle n'est pas valide : saisissez-la." : "Date non détectée : saisissez-la (sinon la date du jour est conservée)."}</p>}
              {isDup && <label className="flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2 text-xs"><input type="checkbox" checked={dup} onChange={(e) => setDup(e.target.checked)} className="mt-0.5" /><span>Un ticket de même date et de même total est déjà enregistré. Cochez pour l'ajouter quand même.</span></label>}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{`Articles lus (${rows.length})`}</p>
                <Btn type="button" size="sm" variant="soft" onClick={() => setRows((rs) => [...rs, { id: uid(), name: "", qty: "1", price: "", kind: "item", conf: "high", flags: [] }])}><Plus size={12} />Ajouter une ligne</Btn></div>
              {!rows.length && <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted">Aucun article reconnu.{withItems ? " La liste de courses ne sera pas modifiée." : ""} Vous pouvez en ajouter à la main ou ne garder que le total.</p>}
              <ul className="flex flex-col gap-1.5">
                {rows.map((r) => (
                  <li key={r.id} data-testid="receipt-row" data-conf={r.conf}
                    className={cx("grid grid-cols-[minmax(0,1fr)_3rem_5rem_auto] items-center gap-1.5 rounded-lg border-2 px-1.5 py-1", r.conf === "low" ? "border-bad/60 bg-bad/5" : r.conf === "medium" ? "border-warn/60 bg-warn/5" : "border-transparent bg-sunken")}>
                    <Input aria-label="Nom de l'article" placeholder="Nom à compléter" value={r.name} onChange={(e) => upd(r.id, { name: e.target.value })} className="min-w-0" />
                    <Input aria-label="Quantité" inputMode="numeric" value={r.qty} onChange={(e) => upd(r.id, { qty: e.target.value })} className="px-1 text-center" />
                    <Input aria-label="Prix de la ligne" inputMode="decimal" placeholder="prix" value={r.price} onChange={(e) => upd(r.id, { price: e.target.value })} className="px-1 text-right font-mono" />
                    <button type="button" aria-label="Supprimer la ligne" className="p-1 text-muted hover:text-bad" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><Trash2 size={13} /></button>
                    {(r.flags.length > 0 || r.kind === "discount") && <p className="col-span-4 px-1 text-[10px] text-muted">{r.kind === "discount" && <span>Remise</span>}{r.flags.map((f, i) => <React.Fragment key={f}>{(i > 0 || r.kind === "discount") && " · "}<span>{FLAG_TEXT[f] ?? f}</span></React.Fragment>)}</p>}
                  </li>))}
              </ul>
              {rows.length > 0 && (
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs" data-testid="receipt-sum">
                  <span>Somme des lignes : <b className="font-mono">{eur(cents)} €</b>{unknown > 0 && <span className="text-muted">{` (+ ${unknown} sans prix)`}</span>}</span>
                  {amtOk && <span>Total du ticket : <b className="font-mono">{eur(Math.round(amt * 100))} €</b></span>}
                </div>)}
              {diverge && <p className="mt-1 rounded-lg bg-warn/15 px-3 py-2 text-xs" data-testid="receipt-gap"><AlertTriangle size={12} className="mr-1 inline" />{gap !== 0 ? `La somme des lignes diffère du total du ticket de ${eur(Math.abs(gap!))} €. Des articles sont peut-être manquants ou mal lus ; vérifiez, ou validez malgré l'écart.` : "La somme des lignes correspond, mais certaines lignes n'ont pas de prix ; vérifiez, ou validez malgré l'écart."}</p>}
            </div>
            <details className="rounded-lg border border-line px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold">Texte reconnu par le scanner</summary>
              <pre data-testid="receipt-ocr-text" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{result.text || "(aucun texte reconnu)"}</pre>
              <p className="mt-2 text-[10px] text-muted"><span>{`${info.width}×${info.height} px`}</span> · <span>{info.preprocessed ? "image préparée" : "image d'origine (préparation impossible)"}</span> · <span>{info.engine === "local" ? "moteur hébergé" : "moteur en ligne (CDN)"}</span>{meanConfidence !== null && <> · <span>{`confiance moyenne des mots (indicatif) : ${Math.round(meanConfidence)} %`}</span></>}</p>
            </details>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
              <Btn type="button" variant="ghost" onClick={onCancel}>Annuler</Btn>
              <Btn type="button" variant="primary" disabled={!amtOk || (isDup && !dup)} onClick={submit} data-testid="receipt-confirm">{diverge ? "Valider malgré l'écart" : "Utiliser ces données"}</Btn>
            </div>
            {!amtOk && <p className="text-right text-[11px] text-muted">Indiquez le total du ticket pour continuer.</p>}
          </div>
        </div>
      </div>,
      document.body
    );
  };

const OCR_PHASE: Record<OcrProgress["phase"], string> = { prepare: "Préparation de l'image…", engine: "Chargement du moteur de lecture…", lang: "Chargement du français…", read: "Lecture du ticket…" };
const ReceiptScanner: React.FC<{ onConfirm: (c: ReceiptConfirm) => void; label?: string; className?: string; withDate?: boolean; withItems?: boolean; known?: string[] }> =
  ({ onConfirm, label = "Scanner un ticket", className, withDate = false, withItems = false, known = [] }) => {
    const ref = useRef<HTMLInputElement>(null);
    const ctl = useRef<AbortController | null>(null);
    const [prog, setProg] = useState<OcrProgress | null>(null);
    const [err, setErr] = useState<OcrError | null>(null);
    const [review, setReview] = useState<{ result: ReceiptResult; items: ReceiptItem[]; out: OcrOutput } | null>(null);
    useEffect(() => () => ctl.current?.abort(), []);
    const run = async (file: File) => {
      if (ctl.current) return; // une seule lecture à la fois
      const c = new AbortController(); ctl.current = c; setErr(null); setProg({ phase: "prepare", pct: 0 });
      try {
        const out = await scanReceipt(file, { signal: c.signal, onProgress: setProg });
        setReview({ result: parseReceipt(out.text), items: parseReceiptItems(out.text), out });
      } catch (e) {
        if (!(e instanceof OcrError && e.kind === "cancelled")) setErr(e instanceof OcrError ? e : new OcrError("recognize", "La lecture de l'image a échoué.", String((e as Error)?.message ?? e).slice(0, 200)));
      } finally { ctl.current = null; setProg(null); }
    };
    const close = useCallback(() => setReview(null), []);
    return (
      <>
        <div className={cx("flex gap-2", className)}>
          <Btn type="button" className="flex-1" disabled={prog !== null} onClick={() => ref.current?.click()}>
            <Camera size={15} />{prog ? <>{OCR_PHASE[prog.phase]}{prog.phase !== "prepare" && prog.pct > 0 ? ` ${prog.pct} %` : ""}</> : label}
          </Btn>
          {prog && <Btn type="button" variant="ghost" onClick={() => ctl.current?.abort()}>Annuler</Btn>}
        </div>
        <input ref={ref} type="file" accept="image/*" capture="environment" hidden data-testid="receipt-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(f); e.target.value = ""; }} />
        {err && (
          <div role="alert" data-testid="receipt-error" className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-xs">
            <p className="font-semibold">{err.message}</p>
            {(err.kind === "engine" || err.kind === "lang") && <p className="mt-0.5">{err.offline ? "L'appareil indique être hors ligne et les fichiers de lecture ne sont pas encore disponibles ici : connectez-vous une première fois." : "Réessayez ; si cela persiste, rechargez la page. Vous pouvez aussi saisir le montant à la main."}</p>}
            {err.kind === "recognize" && <p className="mt-0.5">Réessayez avec une photo plus nette, ou saisissez le montant à la main.</p>}
            {err.detail && <details className="mt-1 text-muted"><summary className="cursor-pointer">Détails techniques</summary><p className="mt-1 break-all font-mono text-[10px]">{err.detail}</p></details>}
          </div>)}
        {review && <ReceiptReview result={review.result} items={review.items} info={review.out.info} meanConfidence={review.out.meanConfidence} withDate={withDate} withItems={withItems} today={todayISO()} known={known} onCancel={close} onConfirm={(c) => { setReview(null); onConfirm(c); }} />}
      </>
    );
  };

// ---------------------------------------------------------------- Module : Tableau de bord
type OnTime = ReturnType<typeof onTimeStats>;
type Count = OnTime["bed"];
/** Ligne de compteur : ✓ à l'heure / ✗ en retard, barre, et détail 30 jours. */
const CounterRow: React.FC<{ label: string; target?: string; a: Count; m: Count; lateWord?: string }> = ({ label, target, a, m, lateWord = "en retard" }) => {
  const n = a.ok + a.late, pct = n ? Math.round((a.ok / n) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]"><span className="font-medium">{label}{target && <span className="font-mono text-[11px] text-muted"> · {target}</span>}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{n ? `${pct} %` : "—"}</span></div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 font-mono text-xl font-semibold tabular-nums text-ok" title="À l'heure"><Check size={15} strokeWidth={3} />{a.ok}</span>
        <span className="flex items-center gap-1 font-mono text-xl font-semibold tabular-nums text-bad" title={lateWord}><X size={15} strokeWidth={3} />{a.late}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-sunken">{n > 0 && <><div className="h-full bg-ok" style={{ width: `${pct}%` }} /><div className="h-full bg-bad/70" style={{ width: `${100 - pct}%` }} /></>}</div>
      </div>
      <p className="mt-0.5 text-[10px] text-muted">30 derniers jours : {m.ok} à l'heure · {m.late} {lateWord}</p>
    </div>);
};
/** Compteur coucher / réveil à l'heure (tableau de bord et page Sommeil). */
export const OnTimeCounter: React.FC<{ all: OnTime; d30: OnTime; bedTarget: string; wakeTarget: string }> = ({ all, d30, bedTarget, wakeTarget }) => {
  return (
    <div className="flex flex-col gap-3" data-testid="ontime">
      <CounterRow label="Coucher" target={bedTarget} a={all.bed} m={d30.bed} />
      <CounterRow label="Réveil" target={wakeTarget} a={all.wake} m={d30.wake} />
      <p className="text-[11px] text-muted">{all.streak > 0 ? <><span key={all.streak} className="streak"><span className="flame">🔥</span></span> Série : <b className="text-fg">{all.streak} nuit{all.streak > 1 ? "s" : ""}</b> d'affilée à l'heure (coucher et réveil).</> : "Cochez chaque nuit si vous vous êtes couché·e et levé·e à l'heure."}</p>
    </div>
  );
};

interface DashBlock { id: string; label: string; span: string; show: boolean; el: React.ReactNode }
/** Ordre effectif : ordre enregistré, puis les nouvelles cartes à leur place par défaut. */
export function dashOrder(ids: string[], saved: string[] = []): string[] {
  const known = saved.filter((id) => ids.includes(id));
  const out = [...known];
  ids.forEach((id, i) => { if (!out.includes(id)) { const prev = ids.slice(0, i).reverse().find((x) => out.includes(x)); out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id); } });
  return out;
}
/** Grille du tableau de bord, réorganisable (bouton Personnaliser). */
/** Cours ou événements d'aujourd'hui, à partir de l'heure actuelle. */
const UpcomingCard: React.FC<{ days: DayPlan[]; kind: "class" | "event"; go: (v: ViewKey) => void }> = ({ days, kind, go }) => {
  const now = new Date(), today = todayISO(), nowMin = now.getHours() * 60 + now.getMinutes();
  const items = days.filter((d) => d.date === today).flatMap((d) => d.blocks.filter((b) => b.kind === kind && b.end > nowMin).map((b) => ({ b, date: d.date })))
    .sort((x, y) => x.b.start - y.b.start);
  const isClass = kind === "class";
  return (
    <Card title={<span className="flex items-center gap-2">{isClass ? <GraduationCap size={15} /> : <CalendarClock size={15} />}{isClass ? "Cours d'aujourd'hui" : "Événements d'aujourd'hui"}</span>} action={<Btn size="sm" variant="ghost" onClick={() => go("planning")}>Planning</Btn>}>
      {items.length ? <ul className="flex flex-col divide-y divide-line" data-testid={`upcoming-${kind}`}>{items.map(({ b, date }, i) => { const live = date === today && b.start <= nowMin && b.end > nowMin; return (
        <li key={i} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0 text-[13px]">
          <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: b.color ?? (isClass ? "rgb(var(--accent))" : "#d6457a") }} />
          <div className="min-w-0 flex-1"><p className="truncate font-medium">{b.label}</p><p className="text-[11px] text-muted"><span className="font-mono tabular-nums">{toHHMM(b.start)}–{toHHMM(b.end)}</span></p></div>
          {live && <Pill tone="ok">En cours</Pill>}
        </li>); })}</ul>
        : <p className="text-[13px] text-muted">{isClass ? "Plus de cours aujourd'hui." : "Plus d'événement aujourd'hui."}</p>}
    </Card>
  );
};
/** Carte « Série » façon appli de streak : flamme animée, semaine, niveau et points. */
const StreakHero: React.FC = () => {
  const { state, toast } = useStore();
  const today = todayISO();
  const days = useMemo(() => activeDays(state), [state.tasks, state.todos, state.chores, state.habits, state.settings.onTimeMode]);
  const st = globalStreak(days, today);
  const xp = useMemo(() => xpOf(state), [state.tasks, state.todos, state.chores, state.habits, state.settings.onTimeMode]);
  const lv = levelOf(xp);
  const [party, setParty] = useState(false);
  // Passage de niveau : petite fête (mémorisée sur l'appareil pour ne pas la rejouer).
  useEffect(() => {
    let prev = 0; try { prev = Number(localStorage.getItem("etudiant-os/level") ?? 0); } catch { /* facultatif */ }
    if (prev && lv.level > prev) { setParty(true); toast(`🎉 Niveau ${lv.level} : ${lv.name} !`); window.setTimeout(() => setParty(false), 1800); }
    try { localStorage.setItem("etudiant-os/level", String(lv.level)); } catch { /* facultatif */ }
  }, [lv.level]);
  const monday = addDays(parseISO(today), -weekday(parseISO(today)));
  const week = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));
  const big = st.current >= 7;
  return (
    <section className="relative overflow-hidden rounded-[22px] border-2 border-[rgb(24_22_46)] p-4 shadow-[3px_3px_0_0_rgb(24_22_46)] sm:p-5" data-testid="streak-hero"
      style={{ background: "linear-gradient(135deg, #ffe7a3, #ffc796 60%, #ffd9c2)", color: "#18162e" }}>
      {party && <div className="confetti pointer-events-none absolute inset-x-0 top-0 h-0" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, background: ["#3448f0", "#e0453a", "#0f9d76", "#f5b301", "#c2417a"][i % 5], animationDelay: `${(i % 6) * 0.08}s` }} />)}</div>}
      <div className="flex items-center gap-4">
        <div className="relative grid h-20 w-20 shrink-0 place-items-center">
          <span className="flame-glow absolute inset-1 rounded-full" style={{ background: st.current ? "radial-gradient(circle, rgb(255 170 60 / .8), transparent 70%)" : "radial-gradient(circle, rgb(150 150 170 / .4), transparent 70%)" }} />
          <span className={cx("relative text-[52px] leading-none", st.current ? "flame-bob" : "grayscale opacity-60")} aria-hidden>🔥</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#4a4668]">Série</p>
          <p key={st.current} className="pop-in font-display text-[34px] font-extrabold leading-none tracking-tight text-[#18162e]">{st.current} <span className="text-[16px] font-bold">jour{st.current > 1 ? "s" : ""}</span></p>
          <p className="mt-1 text-[12.5px] font-medium text-[#18162e]">{st.todayDone ? (big ? "Incroyable, continue comme ça ! 🌟" : "Série validée aujourd'hui ✓") : st.current ? "Fais une chose aujourd'hui pour garder ta série !" : "Coche une tâche, une corvée ou une routine pour lancer ta série."}</p>
        </div>
        <div className="hidden shrink-0 text-right sm:block"><p className="text-[11px] font-semibold text-[#4a4668]">Record</p><p className="font-display text-xl font-extrabold text-[#18162e]">{st.best} j</p></div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {week.map((d) => { const on = days.has(d), isT = d === today, future = d > today; return (
          <div key={d} className="flex flex-col items-center gap-1">
            <span className={cx("grid h-8 w-8 place-items-center rounded-full border-2 text-[13px] font-bold transition", on ? "border-[rgb(24_22_46)] bg-[#ff8a3d] text-white shadow-[2px_2px_0_0_rgb(24_22_46)]" : isT ? "border-dashed border-[rgb(24_22_46)] bg-white/60" : future ? "border-[rgb(24_22_46)]/20 bg-white/30" : "border-[rgb(24_22_46)]/30 bg-white/50")}>{on ? "🔥" : ""}</span>
            <span className={cx("text-[10px] font-semibold", isT ? "text-[#18162e]" : "text-[#4a4668]")}>{DAYS[weekday(parseISO(d))]}</span>
          </div>); })}
      </div>
      <div className="mt-3 rounded-xl border-2 border-[rgb(24_22_46)] bg-white/70 p-2.5">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-[#18162e]">
          <span className="rounded-full bg-[rgb(24_22_46)] px-2 py-0.5 text-[11px] font-bold text-white">Niv. {lv.level}</span>{lv.name}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-[#4a4668]">{xp} / {lv.to} pts</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full border-2 border-[rgb(24_22_46)] bg-white"><div key={lv.level} className="xp-fill h-full rounded-full" style={{ width: `${Math.max(3, lv.progress * 100)}%`, background: "linear-gradient(90deg, #f5b301, #ff6b3d)" }} /></div>
        <p className="mt-1 text-[10.5px] text-[#4a4668]">+10 pts par chose faite, +5 si c'est à l'heure. Prochain niveau : {LEVELS[Math.min(lv.level, LEVELS.length - 1)]}.</p>
      </div>
    </section>
  );
};

/** Pastille 🔥 dans l'en-tête : ouvre le détail de la série et du niveau. */
const StreakChip: React.FC = () => {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const days = useMemo(() => activeDays(state), [state.tasks, state.todos, state.chores, state.habits, state.settings.onTimeMode]);
  const st = globalStreak(days, todayISO());
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={`Série : ${st.current} jours`} title="Voir ma série" data-testid="streak-chip"
        className={cx("flex shrink-0 items-center gap-1 rounded-full border-2 px-2 py-1 text-[13px] font-extrabold transition active:scale-95", st.current ? "border-[#ff8a3d] bg-[#ff8a3d]/15 text-[#ff8a3d]" : "border-line bg-sunken text-muted")}>
        <span className={cx("text-[15px] leading-none", st.current ? "flame-bob" : "grayscale opacity-60")} aria-hidden>🔥</span>{st.current}
      </button>
      {open && <Modal title="Ma série" onClose={() => setOpen(false)}><StreakHero /></Modal>}
    </>
  );
};

const DashGrid: React.FC<{ blocks: DashBlock[] }> = ({ blocks }) => {
  const { state, dispatch, toast } = useStore();
  const [edit, setEdit] = useState(false);
  const layout = state.settings.dashLayout ?? { order: [], hidden: [] };
  const order = dashOrder(blocks.map((b) => b.id), layout.order);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const save = (patch: Partial<{ order: string[]; hidden: string[] }>) => dispatch({ type: "settings", patch: { dashLayout: { order, hidden: layout.hidden, ...patch } } });
  const move = (id: string, dir: -1 | 1) => {
    // On saute les cartes invisibles pour que chaque clic ait un effet visible.
    const vis = order.filter((x) => byId.get(x)?.show || edit && layout.hidden.includes(x));
    const i = vis.indexOf(id), j = i + dir; if (j < 0 || j >= vis.length) return;
    const next = [...order], a = next.indexOf(id), b = next.indexOf(vis[j]); [next[a], next[b]] = [next[b], next[a]]; save({ order: next });
  };
  const toggle = (id: string) => save({ hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] });
  const shown = order.map((id) => byId.get(id)!).filter((b) => b.show && (edit || !layout.hidden.includes(b.id)));
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {edit && <p className="mr-auto text-[12px] text-muted">Utilisez ↑ ↓ pour déplacer une carte et l'œil pour la masquer.</p>}
        {edit && <Btn size="sm" variant="ghost" onClick={() => { dispatch({ type: "settings", patch: { dashLayout: undefined } }); toast("Disposition par défaut rétablie", "info"); }}>Réinitialiser</Btn>}
        <Btn size="sm" variant={edit ? "primary" : "ghost"} onClick={() => setEdit(!edit)} aria-pressed={edit}>{edit ? <><Check size={13} />Terminé</> : <><Pencil size={13} />Personnaliser</>}</Btn>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="dash-grid">
        {shown.map((b, i) => { const hidden = layout.hidden.includes(b.id); return (
          <section key={b.id} data-dash={b.id} className={cx("relative min-w-0", b.span, edit && "rounded-[24px] outline-dashed outline-2 outline-offset-4 outline-accent/50", hidden && "opacity-40")}>
            {edit && <div className="absolute -top-3 right-3 z-10 flex items-center gap-1 rounded-full border-2 border-fg bg-panel px-1.5 py-0.5 shadow-[2px_2px_0_0_rgb(var(--ink))]">
              <span className="max-w-[140px] truncate px-1 text-[11px] font-semibold">{b.label}</span>
              <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => move(b.id, -1)} aria-label={`Monter ${b.label}`}>↑</button>
              <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-sunken disabled:opacity-30" disabled={i === shown.length - 1} onClick={() => move(b.id, 1)} aria-label={`Descendre ${b.label}`}>↓</button>
              <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-sunken" onClick={() => toggle(b.id)} aria-label={hidden ? `Afficher ${b.label}` : `Masquer ${b.label}`} title={hidden ? "Afficher" : "Masquer"}>{hidden ? "🙈" : "👁"}</button>
            </div>}
            <div className={cx("h-full [&>*]:h-full", edit && "pointer-events-none select-none")}>{b.el}</div>
          </section>); })}
      </div>
    </>
  );
};

const Dashboard: React.FC<{ go: (v: ViewKey) => void; openNewTask: () => void }> = ({ go, openNewTask }) => {
  const { state, dispatch, toast, openTask } = useStore();
  const today = todayISO();
  const cur = state.settings.currency;
  const choreStep = useChoreStep();
  const ot = useMemo(() => ({ all: onTimeStats(state.sleep, today), d30: onTimeStats(state.sleep, today, 30) }), [state.sleep, today]);
  const ht = useMemo(() => ({ all: habitStats(state.habits ?? [], today), d30: habitStats(state.habits ?? [], today, 30) }), [state.habits, today]);
  const habitsToday = (state.habits ?? []).filter((h) => habitOn(h, today));
  const tt = useMemo(() => ({ all: taskOnTimeStats(state.tasks, today), d30: taskOnTimeStats(state.tasks, today, 30), call: choreOnTimeStats(state.chores, today), c30: choreOnTimeStats(state.chores, today, 30) }), [state.tasks, state.chores, today, state.settings.onTimeMode]);
  // Toutes les valeurs viennent des mêmes fonctions que les modules (une seule source de vérité).
  const days7 = useMemo(() => planRange(state, today, 7, today), [state, today]);
  const plan = days7[0];
  const fs = useMemo(() => focusStats(state.focus, today), [state.focus, today]);
  const ss = useMemo(() => sleepStats(state.sleep, state.settings.sleepGoal, today), [state.sleep, state.settings.sleepGoal, today]);
  // Ménage du jour : toutes les corvées prévues aujourd'hui, pour chaque colocataire (rotation automatique).
  const todayDate = parseISO(today);
  const chores = state.chores.filter((c) => choreScheduledOn(c, todayDate)).map((c) => ({ c, who: choreAssignee(c, todayDate), done: c.done.includes(today), skipped: (c.skipped ?? []).includes(today) }))
    .sort((a, b) => Number(a.done || a.skipped) - Number(b.done || b.skipped) || Number(b.who === "Moi") - Number(a.who === "Moi"));
  const choresLeft = chores.filter((x) => !x.done && !x.skipped);
  const myLeft = choresLeft.filter((x) => x.who === "Moi").length;
  const solo = isSolo(state);
  const lateChores = state.chores.reduce((n, c) => n + [1, 2, 3].filter((i) => { const d = addDays(todayDate, -i), k = iso(d); return choreScheduledOn(c, d) && !c.done.includes(k) && !(c.skipped ?? []).includes(k); }).length, 0);
  const bs = budgetStats(state.budget, monthKey(today), today, catsOf(state));
  const open = state.tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => t.deadline < today).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const doneWeek = state.tasks.filter((t) => t.doneAt && daysBetween(t.doneAt, today) < 7).length;
  const upcoming = open.filter((t) => t.deadline >= today && t.deadline !== NO_DEADLINE).sort((a, b) => a.deadline.localeCompare(b.deadline) || b.priority - a.priority).slice(0, 5);
  // Tâches prioritaires du jour = blocs proposés par le planning aujourd'hui, regroupés par tâche.
  const todayTasks = useMemo(() => {
    const m = new Map<ID, number>();
    plan.blocks.filter((b) => b.kind === "task" && b.refId).forEach((b) => m.set(b.refId!, (m.get(b.refId!) ?? 0) + b.end - b.start));
    return [...m.entries()].map(([id, minutes]) => ({ t: state.tasks.find((x) => x.id === id)!, minutes })).filter((x) => x.t);
  }, [plan, state.tasks]);
  const delta = fs.prevWeek ? Math.round(((fs.week - fs.prevWeek) / fs.prevWeek) * 100) : null;
  const courseOf = (id: ID | null) => state.courses.find((c) => c.id === id);
  const startFocus = (t: Task) => { dispatch({ type: "timer/task", taskId: t.id }); if (!state.timer.running) dispatch({ type: "timer/start", now: Date.now() }); go("focus"); toast(`Focus lancé sur « ${t.title} »`); };
  const finish = (t: Task) => { dispatch({ type: "task/update", id: t.id, patch: { status: "done" } }); toast(`« ${t.title} » terminé`); };
  const postpone = (t: Task, n: number) => { const from = t.deadline < today ? today : t.deadline; dispatch({ type: "task/update", id: t.id, patch: { deadline: iso(addDays(parseISO(from), n)) } }); toast(`Échéance reportée au ${fmtDate(iso(addDays(parseISO(from), n)))}`, "info"); };

  const steps: { done: boolean; label: string; run: () => void }[] = [
    { done: state.courses.length > 0, label: "Ajouter vos modules", run: () => go("academic") },
    { done: state.classes.length > 0, label: "Saisir votre emploi du temps fixe", run: () => go("planning") },
    { done: state.tasks.length > 0, label: "Créer vos devoirs, examens et projets", run: openNewTask },
    { done: state.budget.expenses.length > 0 || state.budget.recurring.length > 0, label: "Noter une première dépense", run: () => go("budget") },
    { done: state.sleep.length > 0, label: "Enregistrer votre dernière nuit", run: () => go("sleep") },
    { done: state.focus.length > 0, label: "Faire une première session de focus", run: () => go("focus") },
  ];
  const stepsLeft = steps.filter((x) => !x.done).length;
  const debtTone = ss.nights7 === 0 ? undefined : ss.debt7 > 240 ? "bad" : ss.debt7 > 60 ? "warn" : "ok";
  const blocks: DashBlock[] = [
    { id: "todos", label: "Mes tâches perso", span: "md:col-span-2 xl:col-span-3", show: true, el: <TodoDashCard go={go} /> },
    { id: "start", label: "Pour bien démarrer", span: "md:col-span-2 xl:col-span-3", show: stepsLeft > 0, el: (<>
        <Card title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />Pour bien démarrer · {steps.length - stepsLeft}/{steps.length}</span>}>
          <div className="mb-3 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((steps.length - stepsLeft) / steps.length) * 100}%` }} /></div>
          <ul className="grid gap-2 sm:grid-cols-2">{steps.map((x) => (
            <li key={x.label}><button onClick={x.run} disabled={x.done} className={cx("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] transition", x.done ? "border-transparent text-muted line-through" : "border-line hover:border-accent hover:bg-accent/5")}>
              <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border", x.done ? "border-ok bg-ok text-onaccent" : "border-line")}>{x.done && <Check size={11} strokeWidth={3} />}</span>{x.label}{!x.done && <ChevronRight size={14} className="ml-auto text-muted" />}</button></li>))}</ul>
        </Card></>) },
    { id: "stats", label: "Chiffres clés", span: "md:col-span-2 xl:col-span-3", show: true, el: (<>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-6 md:[&>*]:col-span-2 md:[&>*:nth-child(n+4)]:col-span-3 xl:grid-cols-5 xl:[&>*]:col-span-1 xl:[&>*:nth-child(n+4)]:col-span-1">
        <button onClick={() => go("focus")} className="text-left"><Stat label="Focus · 7 jours" value={fmtDur(fs.week)} sub={delta === null ? (fs.week ? "pas de semaine précédente" : "aucune session") : `${delta >= 0 ? "+" : ""}${delta} % vs semaine précédente`} tone={delta === null ? undefined : delta >= 0 ? "ok" : "warn"} /></button>
        <button onClick={() => go("academic")} className="text-left"><Stat label="Terminées · 7 j" value={String(doneWeek)} sub={`${open.length} ouvertes · ${late.length} en retard`} tone={late.length ? "bad" : undefined} /></button>
        <button onClick={() => go("sleep")} className="text-left"><Stat label="Sommeil · 7 jours" value={ss.avg7 === null ? "—" : fmtDur(ss.avg7)} sub={ss.nights7 ? `moyenne sur ${ss.nights7} nuit${ss.nights7 > 1 ? "s" : ""} · dette ${ss.debt7 > 0 ? fmtDur(ss.debt7) : "0"}` : "aucune nuit saisie"} tone={debtTone} /></button>
        <button onClick={() => go("chores")} className="text-left"><Stat label="Ménage aujourd'hui" value={chores.length ? `${chores.length - choresLeft.length}/${chores.length}` : "—"} sub={!chores.length ? "aucune corvée prévue" : choresLeft.length ? (solo ? `${choresLeft.length} à faire` : `${myLeft ? `${myLeft} pour vous` : "rien pour vous"} · ${choresLeft.length} à faire`) : "tout est fait"} tone={!chores.length ? undefined : choresLeft.length ? (lateChores ? "warn" : undefined) : "ok"} /></button>
        <button onClick={() => go("budget")} className="text-left min-[360px]:col-span-2"><Stat label="Budget restant" value={money(bs.remaining, cur)} sub={`${money(bs.spent, cur)} dépensés ce mois${bs.overCats.length ? ` · ${bs.overCats.length} plafond${bs.overCats.length > 1 ? "s" : ""} dépassé${bs.overCats.length > 1 ? "s" : ""}` : ""}`} tone={bs.remaining < 0 || bs.overCats.length ? "bad" : bs.remaining < state.budget.monthly * 0.15 ? "warn" : "ok"} /></button>
      </div>
    </>) },
    { id: "today", label: "Aujourd'hui", span: "md:col-span-2", show: true, el: (<>
        <Card title="Aujourd'hui" className="md:col-span-2" action={<Btn size="sm" variant="ghost" onClick={() => go("planning")}>Planning</Btn>}>
          {late.length > 0 && (
            <div className="mb-3 rounded-xl border border-bad/30 bg-bad/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-bad"><AlertTriangle size={13} />En retard · {late.length}</p>
              <ul className="flex flex-col gap-1.5">{late.slice(0, 4).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                  <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => openTask(t.id)}>{t.title}</button>
                  <Pill tone="bad">{-daysBetween(today, t.deadline)} j</Pill>
                  <Btn size="sm" variant="ghost" onClick={() => postpone(t, 1)} title="Nouvelle échéance : demain">+1 j</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => postpone(t, 7)} title="Nouvelle échéance : dans une semaine">+7 j</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => finish(t)} aria-label="Marquer terminé"><Check size={13} /></Btn>
                </li>))}</ul>
              <p className="mt-2 text-[11px] text-muted">Le planning répartit le reste sur {OVERDUE_SPREAD} jours ; reportez l'échéance pour replanifier.</p>
            </div>)}
          {todayTasks.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {todayTasks.map(({ t, minutes }) => { const c = courseOf(t.courseId); return (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c?.color ?? "rgb(var(--muted))" }} />
                  <button className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent" onClick={() => openTask(t.id)}>{t.title}</button>
                  {!!t.steps?.length && <Pill tone="muted">☑ {t.steps.filter((x) => x.done).length}/{t.steps.length}</Pill>}
                  <span className="font-mono text-xs tabular-nums text-muted">{fmtDur(minutes)}<span className="hidden sm:inline"> prévus</span></span>
                  <Btn size="sm" onClick={() => startFocus(t)} aria-label={`Lancer le focus sur ${t.title}`}><Play size={12} /><span className="hidden sm:inline">Focus</span></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => finish(t)} aria-label="Marquer terminé"><Check size={13} /></Btn>
                </li>); })}
            </ul>
          ) : <Empty icon={<Check size={18} />} title={open.length ? "Rien de planifié aujourd'hui" : "Aucune tâche ouverte"} hint={open.length ? "Vos tâches sont réparties sur les jours suivants." : "Ajoutez un devoir, un projet ou un examen : il sera réparti dans vos créneaux libres."} action={!open.length ? <Btn variant="primary" onClick={openNewTask}><Plus size={14} />Nouvelle tâche</Btn> : undefined} />}
        </Card>
    </>) },
    { id: "progress", label: "Avancement des tâches", span: "", show: true, el: (<>
        <Card title="Avancement des tâches">
          {state.tasks.length ? <div className="flex flex-col gap-3">
            {(["todo", "doing", "review", "done"] as TaskStatus[]).map((st) => {
              const n = state.tasks.filter((t) => t.status === st).length, pct = (n / state.tasks.length) * 100;
              return (<div key={st}><div className="mb-1 flex justify-between text-xs"><span className="text-fg">{STATUS[st].label}</span><span className="font-mono tabular-nums text-muted">{n}</span></div>
                <div className="h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: STATUS[st].color }} /></div></div>);
            })}
            <p className="text-[11px] text-muted">Temps passé : {fmtDur(open.reduce((n, t) => n + t.spent, 0))} sur {fmtDur(open.reduce((n, t) => n + t.estimate, 0))} estimés (tâches ouvertes).</p>
          </div> : <Empty icon={<ListChecks size={18} />} title="Aucune tâche" hint="La progression apparaîtra avec vos premières tâches." />}
        </Card>
    </>) },
    { id: "focus", label: "Temps de focus", span: "", show: true, el: (<>
        <Card title="Temps de focus" action={<Pill tone="info">7 derniers jours</Pill>}>
          {fs.week ? <>
            <BarChart data={fs.byDay.map((d) => ({ label: DAYS[weekday(parseISO(d.date))], value: d.minutes / 60, tone: "accent" }))} goal={state.settings.focusGoal / 60} unit={(v) => `${v.toFixed(v < 10 && v % 1 ? 1 : 0)}h`} height={120} />
            <p className="mt-2 text-xs text-muted">Pointillés : objectif de {fmtDur(state.settings.focusGoal)} par jour (Réglages).</p></>
            : <Empty icon={<Timer size={18} />} title="Aucune session cette semaine" hint="Le graphique se remplit avec vos sessions du minuteur." action={<Btn onClick={() => go("focus")}><Play size={13} />Lancer le minuteur</Btn>} />}
        </Card>
    </>) },
    { id: "sleep", label: "Sommeil", span: "", show: true, el: (<>
        <Card title="Sommeil" action={<Btn size="sm" variant="ghost" onClick={() => go("sleep")}>Détails</Btn>}>
          {ss.nights7 ? <>
            <BarChart data={lastNDays(7).map((d) => { const l = state.sleep.find((x) => x.date === d); const h = l ? sleepMinutes(l.bed, l.wake) / 60 : 0;
              return { label: DAYS[weekday(parseISO(d))], value: h, missing: !l, tone: h >= state.settings.sleepGoal - 0.25 ? "ok" : h >= state.settings.sleepGoal - 1.25 ? "warn" : "bad" }; })} goal={state.settings.sleepGoal} max={10} unit={(v) => `${Math.round(v)}h`} height={120} />
            <p className="mt-2 text-xs text-muted">Tiret : nuit non saisie (non comptée).</p></>
            : <Empty icon={<Moon size={18} />} title="Aucune nuit cette semaine" hint="Enregistrez vos heures de coucher et de réveil pour suivre votre régularité." action={<Btn onClick={() => go("sleep")}>Enregistrer une nuit</Btn>} />}
        </Card>
    </>) },
    { id: "sleepOnTime", label: "Coucher & réveil à l'heure", span: "", show: true, el: (<>
        <Card title={<span className="flex items-center gap-2"><BedDouble size={15} />À l'heure ?</span>} action={<Btn size="sm" variant="ghost" onClick={() => go("sleep")}>Cocher</Btn>}>
          <OnTimeCounter all={ot.all} d30={ot.d30} bedTarget={state.settings.bedDefault} wakeTarget={state.settings.wakeDefault} />
        </Card>
    </>) },
    { id: "routines", label: "Routines du jour", span: "", show: habitsToday.length > 0, el: (<>
<Card title={<span className="flex items-center gap-2"><Sparkles size={15} />Routines du jour · {habitsToday.filter((h) => h.done.includes(today)).length}/{habitsToday.length}</span>} action={<Btn size="sm" variant="ghost" onClick={() => go("routines")}>Tout voir</Btn>}>
          <HabitToday date={today} compact />
        </Card>
    </>) },
    { id: "taskOnTime", label: "Tâches à l'heure", span: "", show: true, el: (<>
        <Card title={<span className="flex items-center gap-2"><ListChecks size={15} />Tâches à l'heure ?</span>} action={<Btn size="sm" variant="ghost" onClick={() => go("academic")}>Tâches</Btn>}>
          <div className="flex flex-col gap-3" data-testid="task-ontime">
            <CounterRow label="Tâches" target="avant l'échéance" a={tt.all} m={tt.d30} />
            {state.chores.length > 0 && <CounterRow label="Ménage" target={((state.settings.onTimeMode ?? "time") === "time") ? "à l'heure prévue" : "le jour prévu"} a={tt.call} m={tt.c30} lateWord="oubliées" />}
            {(state.todos ?? []).some((t) => t.due) && <CounterRow label="Tâches perso" target={((state.settings.onTimeMode ?? "time") === "time") ? "à l'heure prévue" : "le jour prévu"} a={todoOnTimeStats(state.todos ?? [], today)} m={todoOnTimeStats(state.todos ?? [], today, 30)} />}
            {(state.habits ?? []).length > 0 && <CounterRow label="Routines" target="le jour prévu" a={ht.all} m={ht.d30} lateWord="oubliées" />}
            <p className="text-[11px] text-muted">✓ terminée au plus tard le jour de l'échéance · ✗ terminée après, ou encore ouverte et en retard. Ménage : vos corvées faites le jour prévu ; les reportées ne comptent pas.</p>
          </div>
        </Card>
    </>) },
    { id: "classes", label: "Cours d'aujourd'hui", span: "", show: true, el: <UpcomingCard days={days7} kind="class" go={go} /> },
    { id: "events", label: "Événements d'aujourd'hui", span: "", show: true, el: <UpcomingCard days={days7} kind="event" go={go} /> },
    { id: "load", label: "Charge des 7 prochains jours", span: "", show: true, el: (<>
        <Card title="Charge des 7 prochains jours" action={<Btn size="sm" variant="ghost" onClick={() => go("planning")}>Planning</Btn>}>
          <div className="flex flex-col gap-2.5">
            {days7.map((p) => (<div key={p.date} className="grid grid-cols-[52px_1fr] items-center gap-2"><span className="text-xs text-muted">{DAYS[weekday(parseISO(p.date))]} {parseISO(p.date).getDate()}</span><LoadMeter load={p.load} level={p.level} /></div>))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Cours, indisponibilités, tâches et corvées ; le travail planifié un jour n'est pas recompté les jours suivants.</p>
        </Card>
    </>) },
    { id: "deadlines", label: "Prochaines échéances", span: "md:col-span-2", show: true, el: (<>
        <Card title="Prochaines échéances" className="md:col-span-2" action={<Btn size="sm" variant="ghost" onClick={() => go("academic")}>Tout voir</Btn>}>
          {upcoming.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {upcoming.map((t) => { const left = daysBetween(today, t.deadline); const c = courseOf(t.courseId); return (
                <li key={t.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c?.color ?? "rgb(var(--muted))" }} />
                  <button className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent" onClick={() => openTask(t.id)}>{t.title}</button>
                  <Pill tone={left <= 2 ? "warn" : "muted"}>{left === 0 ? "Aujourd'hui" : `J-${left}`}</Pill>
                </li>); })}
            </ul>
          ) : <Empty icon={<Check size={18} />} title={late.length ? "Rien d'autre à venir" : "Rien à rendre"} hint={late.length ? "Seules des tâches en retard restent ouvertes." : "Aucune échéance à venir."} />}
        </Card>
    </>) },
    { id: "chores", label: "Ménage du jour", span: "md:col-span-2 xl:col-span-1", show: true, el: (<>
        <Card title={<span className="flex items-center gap-2"><Home size={15} />Ménage du jour</span>} className="md:col-span-2 xl:col-span-1" action={<Btn size="sm" variant="ghost" onClick={() => go("chores")}>Tout voir</Btn>}>
          {chores.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {chores.map(({ c, who, done, skipped }) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0 text-[13px]">
                  <button onClick={() => { if (skipped) return; dispatch({ type: "chore/toggle", id: c.id, date: today, who }); if (!done) toast(solo ? `${c.name} : faite` : `${c.name} : fait par ${who}`); }} disabled={skipped}
                    aria-label={done ? `Annuler ${c.name}` : `Marquer ${c.name} comme faite`}
                    className={cx("grid h-5 w-5 shrink-0 place-items-center rounded border-2 transition", done ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40 hover:border-accent", skipped && "opacity-40")}>{done && <Check className="tick" size={11} strokeWidth={3} />}</button>
                  <span className={cx("min-w-0 flex-1 truncate", (done || skipped) && "text-muted line-through")}>{c.name}</span>
                  {c.time && <span className="font-mono text-[11px] text-muted">{c.time}</span>}
                  {!solo && <Pill tone={who === "Moi" ? "info" : "muted"}>{who}</Pill>}
                  {!done && !skipped && <Btn size="sm" variant="ghost" title="Reporter" aria-label={`Reporter ${c.name}`} onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: today }); toast(`${c.name} reportée`, "info"); }}>↷</Btn>}
                  {skipped && <span className="text-[11px] text-muted">reportée</span>}
                  {!!c.steps?.length && !skipped && <div className="basis-full pl-7"><StepsCheck small steps={c.steps} done={(id) => choreStepsDone(c, today).includes(id)} onToggle={(id) => choreStep(c, today, id, who)} label={`Checklist de ${c.name}`} /></div>}
                </li>))}
            </ul>
          ) : <Empty icon={<Home size={18} />} title={state.chores.length ? "Rien aujourd'hui" : "Aucune corvée"} hint={state.chores.length ? "Aucune corvée n'est prévue aujourd'hui dans la rotation." : solo ? "Créez vos corvées dans Ménage." : "Créez vos corvées et la rotation entre colocataires dans Ménage."} action={!state.chores.length ? <Btn onClick={() => go("chores")}><Plus size={13} />Créer une corvée</Btn> : undefined} />}
          {lateChores > 0 && <p className="mt-2 text-[11px] text-warn">{lateChores} corvée{lateChores > 1 ? "s" : ""} non faite{lateChores > 1 ? "s" : ""} ces 3 derniers jours.</p>}
        </Card>
    </>) },
  ];
  return (
    <div className="flex flex-col gap-4">
      {plan.level === "surcharge" && (
        <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/8 p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" />
          <div className="min-w-0"><p className="font-semibold text-bad">Risque de surcharge aujourd'hui ({Math.round(plan.load * 100)} %)</p>
            <p className="text-muted">{plan.overflow.length ? `${fmtDur(plan.overflow.reduce((n, o) => n + o.minutes, 0))} de travail ne tient pas dans la journée. ` : ""}Repoussez une échéance ou découpez une tâche.</p></div>
          <Btn size="sm" className="ml-auto shrink-0" onClick={() => go("planning")}>Voir le planning</Btn>
        </div>
      )}
      <DashGrid blocks={blocks} />
    </div>
  );
};

// ---------------------------------------------------------------- Module : Planning / Time-blocking
const BLOCK_STYLE: Record<Block["kind"], string> = {
  class: "border-l-[3px] bg-sunken", task: "border-l-[3px] bg-accent/8", chore: "border-l-[3px] border-l-warn bg-warn/10", meal: "border-l-[3px] border-l-line bg-transparent text-muted", sleep: "", event: "border-l-[3px] border-l-pink bg-pink/10", busy: "border-l-[3px] border-l-muted bg-sunken/60 text-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(var(--line)/.6)_6px_8px)]",
};
// ---------------------------------------------------------------- Import d'emploi du temps PDF
/** « 9 sept. → 30 sept., 21 oct. → 18 nov., 2 déc. » */
const shortDate = (d: string) => parseISO(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const periodsText = (r: [string, string][]) => r.map(([x, y]) => (x === y ? shortDate(x) : `${shortDate(x)} → ${shortDate(y)}`)).join(", ");
interface Detected { key: string; day: number; start: string; end: string; title: string; room: string; on: boolean; note?: string; dates?: [string, string][] }
const TIME_RE = /(\d{1,2})\s*[h:]\s*(\d{2})?\s*(?:-|–|—|à|a|>)\s*(\d{1,2})\s*[h:]\s*(\d{2})?/gi;
const ROOM_RE = /\b((?:salle|amphi(?:théâtre)?|room|labo|bât\.?|bat\.?|td|tp)\s*[\w.-]{1,8}|[a-z]\d{3})\b/i;
async function extractTimetable(buf: ArrayBuffer): Promise<Detected[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: buf }).promise;
  const out: Detected[] = [];
  const today = todayISO();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    // Grille avec cases dessinées (Cronos, Hyperplanning, ADE…) : lecture par position, la plus fiable.
    const geo = await pageGeometry(lib as unknown as Parameters<typeof pageGeometry>[0], page as unknown as Parameters<typeof pageGeometry>[1]);
    const grid = parseGrid(geo.items, geo.rects, today);
    if (grid.length) {
      for (const g of grid) {
        const key = `${g.day}-${g.start}-${g.end}-${norm(g.title)}-${norm(g.room)}`;
        if (out.some((o) => o.key === key)) continue;
        const over = !!g.lastDate && g.lastDate < today;
        const r = g.ranges ?? [];
        const span = r.length ? periodsText(r) : "";
        out.push({ key, day: g.day, start: g.start, end: g.end, title: g.title, room: g.room, on: !over, ...(r.length ? { dates: r, note: over ? `terminé · ${span}` : `semaines : ${span}` } : {}) });
      }
      continue;
    }
    const items = (await page.getTextContent()).items.filter((i) => i.str.trim()).map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    // En-têtes de colonnes (emplois du temps en grille : un jour par colonne)
    const headers = items.map((i) => ({ day: i.s.length < 14 ? dayOf(i.s) : -1, x: i.x })).filter((h) => h.day >= 0);
    const scan = (lines: (typeof items)[], fixedDay: number) => {
      let current = fixedDay;
      lines.forEach((line, li) => {
        const text = line.map((i) => i.s).join(" ");
        const d = fixedDay >= 0 ? fixedDay : dayOf(text); if (d >= 0) current = d;
        const day = current; if (day < 0) return;
        for (const m of text.matchAll(TIME_RE)) {
          const start = `${pad(Number(m[1]))}:${m[2] ?? "00"}`, end = `${pad(Number(m[3]))}:${m[4] ?? "00"}`;
          if (toMin(end) <= toMin(start) || Number(m[1]) > 23 || Number(m[3]) > 23) continue;
          const next = [1, 2, 3].map((k) => (lines[li + k] ?? []).map((i) => i.s).join(" ")).filter((t) => !t.match(TIME_RE));
          let title = text.replace(TIME_RE, " ").replace(DAY_WORDS[day], " ").replace(/\s+/g, " ").trim();
          if (title.length < 3) title = next[0] ?? "";
          const room = (title.match(ROOM_RE) ?? next.slice(0, 2).join(" ").match(ROOM_RE))?.[0] ?? "";
          title = title.replace(room, "").replace(/^[\s|•·,;:—–-]+|[\s|•·,;:—–-]+$/g, "").trim().slice(0, 60) || "Cours";
          const key = `${day}-${start}-${end}-${norm(title)}`;
          if (!out.some((o) => o.key === key)) out.push({ key, day, start, end, title, room, on: true });
        }
      });
    };
    const toLines = (its: typeof items) => {
      const ls: (typeof items)[] = [];
      for (const it of [...its].sort((a, b) => b.y - a.y || a.x - b.x)) { const l = ls[ls.length - 1]; if (l && Math.abs(l[0].y - it.y) < 3) l.push(it); else ls.push([it]); }
      return ls;
    };
    const cols = headers.filter((h, i) => headers.findIndex((o) => o.day === h.day) === i).sort((a, b) => a.x - b.x);
    const ys = headers.map((h) => items.find((i) => i.x === h.x && dayOf(i.s) === h.day)?.y ?? 0);
    const isGrid = cols.length >= 2 && Math.max(...ys) - Math.min(...ys) < 20 && cols[cols.length - 1].x - cols[0].x > 80;
    if (isGrid) {
      // Grille : chaque fragment appartient à la colonne du jour la plus proche (hors marge gauche des créneaux).
      const gap = (cols[cols.length - 1].x - cols[0].x) / (cols.length - 1);
      const top = Math.max(...headers.map((h) => items.find((i) => i.x === h.x && dayOf(i.s) === h.day)?.y ?? 0));
      cols.forEach((c) => scan(toLines(items.filter((i) => {
        if (i.y > top + 2) return false;
        const near = cols.reduce((b, h) => (Math.abs(h.x - i.x) < Math.abs(b.x - i.x) ? h : b));
        return near === c && Math.abs(i.x - c.x) < gap * 0.75 && i.x > cols[0].x - gap * 0.35;
      })), c.day));
    } else scan(toLines(items), -1);
  }
  return out.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
}
async function renderPdf(blob: Blob, el: HTMLElement) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  el.innerHTML = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    c.style.width = "100%"; c.style.height = "auto"; c.style.borderRadius = "12px"; c.style.marginBottom = "12px"; c.style.background = "#fff";
    el.appendChild(c);
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
  }
}
const TimetableImport: React.FC = () => {
  const { state, dispatch, toast, undoable, env } = useStore();
  const { files } = env;
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Detected[] | null>(null);
  const [replaceOld, setReplaceOld] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasPdf, setHasPdf] = useState(false);
  const [viewing, setViewing] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => { files.load("timetable.pdf").then((b) => setHasPdf(!!b)).catch(() => {}); }, []);
  useEffect(() => {
    if (!viewing) return;
    files.load("timetable.pdf").then((b) => b && viewer.current && renderPdf(b, viewer.current)).catch(() => toast("Affichage du PDF impossible ici.", "bad"));
  }, [viewing]);
  const onFile = async (f: File) => {
    setBusy(true);
    try {
      await files.save("timetable.pdf", f).then(() => setHasPdf(true)).catch(() => {});
      const found = await extractTimetable(await f.arrayBuffer());
      setRows(found);
      toast(found.length ? `${found.length} créneaux détectés : vérifiez-les avant d'importer.` : "Aucun horaire reconnu. Le PDF est gardé pour consultation ; ajoutez les cours à la main.", found.length ? "ok" : "info");
    } catch { toast("Lecture du PDF impossible ici. Elle fonctionne sur le site en ligne.", "bad"); }
    finally { setBusy(false); }
  };
  const upd = (k: string, patch: Partial<Detected>) => setRows((r) => r && r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const importRows = () => {
    const sel = (rows ?? []).filter((r) => r.on); if (!sel.length) return;
    // Remplacement : l'ancien emploi du temps est retiré ; ses modules sans tâche ni note aussi (sinon conservés).
    const base = replaceOld ? (() => {
      const used = new Set([...state.tasks.map((t) => t.courseId), ...state.courses.filter((c) => c.grades?.length).map((c) => c.id)]);
      const oldIds = new Set(state.classes.map((c) => c.courseId));
      return { ...state, classes: [], courses: state.courses.filter((c) => !oldIds.has(c.id) || used.has(c.id)) };
    })() : state;
    const palette = ["#2f6fed", "#0f9d76", "#d9822b", "#c2417a", "#7a5af5", "#1d9bb5", "#b5651d"];
    const newCourses: Course[] = [];
    const courseFor = (title: string) => {
      const k = norm(title);
      // Même module seulement si le nom correspond (pas le code : « Introducción al Álgebra » ≠ « Introducción al Cálculo »).
      const all = [...base.courses, ...newCourses];
      const hit = all.find((c) => norm(c.name) === k) ?? all.find((c) => norm(c.name).length > 6 && (k.startsWith(norm(c.name)) || norm(c.name).startsWith(k)) && Math.abs(norm(c.name).length - k.length) < 4);
      if (hit) return hit.id;
      const words = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^A-Za-z0-9]+/).filter((w) => w.length > 2);
      let code = (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? title).slice(0, 5)).toUpperCase().slice(0, 6);
      for (let n = 2; all.some((c) => c.code === code); n++) code = code.replace(/\d+$/, "") + n;
      const c: Course = { id: uid(), name: title, code, coef: 1, color: palette[(base.courses.length + newCourses.length) % palette.length], grades: [] };
      newCourses.push(c); return c.id;
    };
    // Le module est le même pour la théorie, les TP et les labos (« Cours (TP) » → « Cours »).
    const sessions = sel.map((r) => ({ id: uid(), courseId: courseFor(r.title.replace(/\s*\((?:TP|TD|Labo|Séminaire|Tutorat|Examen)\)$/, "")), day: r.day, start: r.start, end: r.end, room: r.room, ...(r.dates?.length ? { dates: r.dates } : {}) }));
    if (replaceOld) undoable({ type: "replace", state: { ...base, classes: sessions, courses: [...base.courses, ...newCourses] } }, `Emploi du temps remplacé : ${sessions.length} cours`);
    else dispatch({ type: "class/addMany", sessions, courses: newCourses });
    if (!replaceOld) toast(`${sessions.length} cours ajoutés${newCourses.length ? ` · ${newCourses.length} nouveaux modules` : ""}. Retrouvez-les dans Académique.`);
    setRows(null);
  };
  return (
    <Card title={<span className="flex items-center gap-2"><FileText size={15} />Emploi du temps PDF</span>}>
      <p className="text-xs text-muted">Importez le PDF de votre école : les horaires sont détectés et ajoutés au planning après vérification. Le PDF reste consultable ici.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="primary" disabled={busy} onClick={() => ref.current?.click()}><Upload size={14} />{busy ? "Lecture…" : "Importer un PDF"}</Btn>
        {hasPdf && <Btn onClick={() => setViewing(true)}><FileText size={14} />Voir mon PDF</Btn>}
        {hasPdf && <Btn variant="danger" onClick={() => files.remove("timetable.pdf").then(() => { setHasPdf(false); toast("PDF retiré", "info"); })} aria-label="Retirer le PDF"><Trash2 size={13} /></Btn>}
        <input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      {rows && rows.length > 0 && (
        <div className="mt-3">
          <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
            {rows.map((r) => (
              <li key={r.key} className={cx("grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded-xl border-2 p-2 text-xs transition", r.on ? "border-fg/60" : "border-line opacity-50")}>
                <input type="checkbox" aria-label="Importer ce créneau" checked={r.on} onChange={(e) => upd(r.key, { on: e.target.checked })} className="mt-1.5 h-4 w-4 accent-[rgb(var(--accent))]" />
                <div className="min-w-0"><Input aria-label="Intitulé" className="h-7 text-xs" value={r.title} onChange={(e) => upd(r.key, { title: e.target.value })} />
                  {r.note && <p className={cx("mt-0.5 text-[10.5px]", r.note.startsWith("terminé") ? "text-warn" : "text-muted")}>{r.note}</p>}</div>
                <span />
                <div className="flex min-w-0 flex-wrap gap-1">
                  <Select aria-label="Jour" className="h-7 w-auto text-xs" value={r.day} onChange={(e) => upd(r.key, { day: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
                  <Input aria-label="Début" type="time" className="h-7 w-[92px] text-xs" value={r.start} onChange={(e) => upd(r.key, { start: e.target.value })} />
                  <Input aria-label="Fin" type="time" className="h-7 w-[92px] text-xs" value={r.end} onChange={(e) => upd(r.key, { end: e.target.value })} />
                  <Input aria-label="Salle" placeholder="Salle" className="h-7 w-20 text-xs" value={r.room} onChange={(e) => upd(r.key, { room: e.target.value })} />
                </div>
              </li>))}
          </ul>
          {state.classes.length > 0 && <label className="mt-2 flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={replaceOld} onChange={(e) => setReplaceOld(e.target.checked)} data-testid="replace-old" />
            <span>Remplacer mon emploi du temps actuel ({state.classes.length} créneau{state.classes.length > 1 ? "x" : ""}). Les modules qui ont des tâches ou des notes sont conservés. Annulable juste après.</span></label>}
          <div className="mt-2 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setRows(null)}>Annuler</Btn><Btn variant="primary" onClick={importRows}><Check size={14} />{replaceOld && state.classes.length ? "Remplacer par" : "Ajouter"} {rows.filter((r) => r.on).length} cours</Btn></div>
        </div>)}
      {viewing && <Modal title="Mon emploi du temps" onClose={() => setViewing(false)}><div ref={viewer} className="text-sm text-muted">Chargement du PDF…</div></Modal>}
    </Card>
  );
};

// ---------------------------------------------------------------- Calendriers abonnés (.ics : Celcat, iPhone/iCloud, Google…)
export const FEED_REFRESH_MS = 3 * 3600_000; // actualisation automatique toutes les 3 h
const FEED_COLORS = ["#2f6fed", "#0f9d76", "#c2417a", "#d9822b", "#7a5af5", "#1d9bb5"];
/** Télécharge et lit un flux, puis remplace ses événements (fenêtre : 2 semaines passées → 5 mois à venir). */
async function syncFeed(f: CalFeed, fetchCalendar: (u: string) => Promise<string>, dispatch: (a: Action) => void): Promise<number> {
  try {
    const text = await fetchCalendar(f.url);
    const today = todayISO();
    const occ = parseIcs(text, iso(addDays(parseISO(today), -14)), iso(addDays(parseISO(today), 150)));
    const events: FeedEvent[] = occ.slice(0, 3000).map((o) => ({ feedId: f.id, uid: o.uid, title: o.title.slice(0, 120), room: o.room.slice(0, 80), date: o.date, start: o.start, end: o.end, allDay: o.allDay }));
    dispatch({ type: "feed/synced", id: f.id, events, at: new Date().toISOString() });
    return events.length;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).replace(/^\w+Error:\s*/, "");
    dispatch({ type: "feed/update", id: f.id, patch: { lastError: /fetch|network|Load failed/i.test(msg) ? "connexion impossible" : msg.slice(0, 160) } });
    throw new Error(msg);
  }
}
/** Actualisation automatique : au démarrage, au retour sur l'onglet, puis régulièrement (si le dernier essai a plus de 3 h). */
function useFeedAutoSync(state: AppState, dispatch: (a: Action) => void, fetchCalendar?: (u: string) => Promise<string>) {
  const ref = useRef(state); ref.current = state;
  const busy = useRef(false);
  useEffect(() => {
    if (!fetchCalendar) return;
    const run = async () => {
      if (busy.current || document.visibilityState !== "visible" || !navigator.onLine) return;
      busy.current = true;
      try {
        for (const f of ref.current.settings.feeds ?? []) {
          const last = f.lastSync ? Date.parse(f.lastSync) : 0;
          if (Date.now() - last < FEED_REFRESH_MS) continue;
          await syncFeed(f, fetchCalendar, dispatch).catch(() => {});
        }
      } finally { busy.current = false; }
    };
    const t0 = window.setTimeout(run, 2500);
    const iv = window.setInterval(run, 10 * 60_000);
    document.addEventListener("visibilitychange", run);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); document.removeEventListener("visibilitychange", run); };
  }, [fetchCalendar, dispatch]);
}
const sinceText = (iso?: string | null) => { if (!iso) return "jamais"; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }); };

const CalendarFeeds: React.FC = () => {
  const { state, dispatch, toast, undoable, env } = useStore();
  const feeds = state.settings.feeds ?? [];
  const [f, setF] = useState({ name: "Emploi du temps", url: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const fetchCal = env.fetchCalendar;
  const refresh = async (feed: CalFeed) => {
    if (!fetchCal) return;
    setBusy(feed.id);
    try { const n = await syncFeed(feed, fetchCal, dispatch); toast(`${feed.name} : ${n} événement${n > 1 ? "s" : ""} synchronisé${n > 1 ? "s" : ""}`); }
    catch (e) { toast(`${feed.name} : ${(e as Error).message}`, "bad"); }
    finally { setBusy(null); }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeFeedUrl(f.url);
    if (!isFeedUrl(url)) { toast("Collez un lien de calendrier complet (https://… ou webcal://…).", "bad"); return; }
    if (feeds.some((x) => x.url === url)) { toast("Ce calendrier est déjà abonné.", "info"); return; }
    const feed: CalFeed = { id: uid(), name: f.name.trim().slice(0, 40) || "Calendrier", url, color: FEED_COLORS[feeds.length % FEED_COLORS.length], lastSync: null, lastError: null };
    dispatch({ type: "feed/add", feed });
    setF({ name: "Emploi du temps", url: "" });
    await refresh(feed);
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Repeat size={15} />Calendriers synchronisés</span>} action={<Btn size="sm" variant="ghost" onClick={() => setHelp(true)}>Où trouver le lien ?</Btn>}>
      {feeds.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2" data-testid="feeds-list">{feeds.map((x) => (
          <li key={x.id} className="rounded-xl border-2 border-line p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
              <Btn size="sm" variant="ghost" disabled={busy === x.id || !fetchCal} onClick={() => void refresh(x)} aria-label={`Actualiser ${x.name}`}><RotateCcw size={12} />{busy === x.id ? "…" : ""}</Btn>
              <button className="text-muted hover:text-bad" aria-label={`Retirer ${x.name}`} onClick={() => undoable({ type: "feed/remove", id: x.id }, `Calendrier « ${x.name} » retiré`)}><Trash2 size={12} /></button>
            </div>
            <p className={cx("mt-1", x.lastError ? "text-bad" : "text-muted")} data-testid="feed-status">
              {x.lastError ? `Échec : ${x.lastError}` : `${x.count ?? 0} événement${(x.count ?? 0) > 1 ? "s" : ""} · actualisé ${sinceText(x.lastSync)}`}
            </p>
          </li>))}</ul>)}
      <form onSubmit={(e) => void add(e)} className="grid grid-cols-2 gap-2">
        <Field label="Nom" htmlFor="fd-name" className="col-span-2"><Input id="fd-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Celcat, iPhone…" /></Field>
        <Field label="Lien du calendrier (.ics / webcal)" htmlFor="fd-url" className="col-span-2"><Input id="fd-url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…/ical… ou webcal://…" /></Field>
        <Btn type="submit" variant="primary" className="col-span-2" disabled={!!busy}><Plus size={14} />S'abonner</Btn>
      </form>
      <p className="mt-2 text-[11px] text-muted">Les cours apparaissent dans le planning et sont mis à jour automatiquement toutes les 3 h quand l'application est ouverte (bouton ↻ pour forcer). Le lien est personnel : il est enregistré seulement dans votre compte.</p>
      {help && (
        <Modal title="Trouver le lien de son calendrier" onClose={() => setHelp(false)}>
          <div className="flex flex-col gap-4 text-[13px] leading-relaxed">
            <section><h3 className="font-display text-[15px] font-bold">Celcat (emploi du temps de l'université)</h3>
              <ol className="ml-4 mt-1 list-decimal space-y-1">
                <li>Connectez-vous à Celcat (« Celcat Calendar » ou « Timetable ») depuis un navigateur, sur ordinateur de préférence.</li>
                <li>Affichez votre emploi du temps (votre groupe ou « Mon emploi du temps »).</li>
                <li>Cherchez le bouton <b>« Abonnement »</b>, <b>« S'abonner »</b>, <b>« Exporter »</b>, <b>« iCal »</b> ou une icône de calendrier / partage (souvent en haut à droite ou dans le menu ⋮).</li>
                <li>Copiez le lien proposé (il finit souvent par <code>.ics</code> ou contient <code>ical</code> / <code>ics</code> ; il peut commencer par <code>webcal://</code>).</li>
                <li>Collez-le ici. Pas de bouton ? Le lien est parfois dans le mail de rentrée ou sur l'ENT ; la scolarité ou le service informatique peut aussi le fournir.</li>
              </ol></section>
            <section><h3 className="font-display text-[15px] font-bold">Calendrier de l'iPhone (iCloud)</h3>
              <ol className="ml-4 mt-1 list-decimal space-y-1">
                <li>App <b>Calendrier</b> → <b>Calendriers</b> (en bas) → touchez <b>ⓘ</b> à côté du calendrier.</li>
                <li>Activez <b>« Calendrier public »</b>, puis <b>« Partager le lien »</b> → Copier.</li>
                <li>Collez-le ici (<code>webcal://…icloud.com/…</code> est accepté).</li>
              </ol>
              <p className="mt-1 text-muted">Si votre emploi du temps est déjà un « calendrier abonné » sur l'iPhone : Réglages → Calendrier → Comptes → Calendriers abonnés → touchez-le pour voir et copier son adresse.</p></section>
            <section><h3 className="font-display text-[15px] font-bold">Google Agenda</h3>
              <p>Paramètres de l'agenda → « Intégrer l'agenda » → <b>Adresse secrète au format iCal</b>.</p></section>
            <p className="rounded-xl bg-sunken p-3 text-[12px] text-muted">Pourquoi pas un accès direct au calendrier de l'iPhone ? Étudiant.OS est une application web : iOS réserve l'accès au calendrier (EventKit) aux applications installées depuis l'App Store. Le lien d'abonnement donne le même résultat et se met à jour tout seul.</p>
          </div>
        </Modal>)}
    </Card>
  );
};

// ---------------------------------------------------------------- Détail d'un créneau + couleurs + vue semaine
const BLOCK_COLORS: { k: string; label: string; hex: string }[] = [
  { k: "rouge", label: "Rouge", hex: "#e5484d" }, { k: "orange", label: "Orange", hex: "#f08c2e" }, { k: "jaune", label: "Jaune", hex: "#d4a017" },
  { k: "vert", label: "Vert", hex: "#2f9e44" }, { k: "bleu", label: "Bleu", hex: "#2f6fed" }, { k: "violet", label: "Violet", hex: "#7a5af5" },
  { k: "rose", label: "Rose", hex: "#d6457a" }, { k: "turquoise", label: "Turquoise", hex: "#1d9bb5" }, { k: "gris", label: "Gris", hex: "#6b7280" },
];
const KIND_NAME: Record<Block["kind"], string> = { class: "Cours", task: "Travail planifié", chore: "Ménage", meal: "Repas", sleep: "Sommeil", busy: "Indisponibilité", event: "Événement" };
const durText = (min: number) => fmtDur(min);
/** Fiche détaillée d'un créneau (toucher un bloc du planning) : tout le texte, la salle, les dates, et sa couleur. */
/** Déplacer une occurrence de corvée (autre jour et/ou autre heure) depuis le planning. */
const ChoreMove: React.FC<{ chore: Chore; date: string; start: number; onDone: () => void }> = ({ chore, date, start, onDone }) => {
  const { dispatch, toast } = useStore();
  const [d, setD] = useState(date); const [t, setT] = useState(toHHMM(start)); const [auto, setAuto] = useState(false);
  const apply = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (!auto && !/^\d{2}:\d{2}$/.test(t))) { toast("Choisissez un jour et une heure.", "bad"); return; }
    if (d < todayISO()) { toast("Choisissez aujourd'hui ou un jour à venir.", "bad"); return; }
    const pin = auto ? {} : { [d]: t };
    if (d === date) dispatch({ type: "chore/pin", id: chore.id, date, time: auto ? "" : t });
    else if (chore.recurrence === "once") dispatch({ type: "chore/update", id: chore.id, patch: { date: d, day: weekday(parseISO(d)), pinned: pin } });
    else {
      // Occurrence d'une corvée récurrente : reportée ce jour-là, et recréée une seule fois au nouveau jour.
      dispatch({ type: "chore/skip", id: chore.id, date });
      dispatch({ type: "chore/add", chore: { id: uid(), name: chore.name, recurrence: "once", date: d, day: weekday(parseISO(d)), minutes: chore.minutes, assignees: [chore.assignees[0] ?? "Moi"], done: [], pinned: pin, ...(chore.steps?.length ? { steps: chore.steps, stepsDone: {} } : {}) } });
    }
    toast(auto ? `${chore.name} : déplacée au ${fmtDate(d)} (heure automatique)` : `${chore.name} : déplacée au ${fmtDate(d)} à ${t}`); onDone();
  };
  return (
    <div className="rounded-xl border-2 border-line p-3" data-testid="chore-move">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Déplacer cette corvée</p>
      <div className="mb-2 flex gap-1.5" role="group">
        {([[false, "🕒 Heure précise"], [true, "⚡ Juste le jour (heure auto)"]] as [boolean, string][]).map(([v, l]) => <button key={l} type="button" aria-pressed={auto === v} onClick={() => setAuto(v)}
          className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold", auto === v ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>)}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Jour" htmlFor="cm-d"><Input id="cm-d" type="date" min={todayISO()} value={d} onChange={(e) => setD(e.target.value)} /></Field>
        {!auto && <Field label="Heure" htmlFor="cm-t"><Input id="cm-t" type="time" value={t} onChange={(e) => setT(e.target.value)} /></Field>}
        <Btn variant="primary" onClick={apply}><Check size={14} />Déplacer</Btn>
      </div>
      {chore.recurrence !== "once" && <p className="mt-1.5 text-[11px] text-muted">Seulement cette fois : les autres jours de la corvée ne changent pas.</p>}
    </div>
  );
};

/** Bloc « jour + heure précise / juste le jour » réutilisé pour déplacer tâches et événements. */
const MoveBox: React.FC<{ title: string; date: string; start: number; allowAuto: boolean; note?: string; onApply: (d: string, t: string | null) => void; testId: string }> = ({ title, date, start, allowAuto, note, onApply, testId }) => {
  const { toast } = useStore();
  const [d, setD] = useState(date); const [t, setT] = useState(toHHMM(start)); const [auto, setAuto] = useState(false);
  const go = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (!auto && !/^\d{2}:\d{2}$/.test(t))) { toast("Choisissez un jour et une heure.", "bad"); return; }
    if (d < todayISO()) { toast("Choisissez aujourd'hui ou un jour à venir.", "bad"); return; }
    onApply(d, auto ? null : t);
  };
  return (
    <div className="rounded-xl border-2 border-line p-3" data-testid={testId}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</p>
      {allowAuto && <div className="mb-2 flex gap-1.5" role="group">
        {([[false, "🕒 Heure précise"], [true, "⚡ Juste le jour (heure auto)"]] as [boolean, string][]).map(([v, l]) => <button key={l} type="button" aria-pressed={auto === v} onClick={() => setAuto(v)}
          className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold", auto === v ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>)}
      </div>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Jour" htmlFor={`${testId}-d`}><Input id={`${testId}-d`} type="date" min={todayISO()} value={d} onChange={(e) => setD(e.target.value)} /></Field>
        {!auto && <Field label="Heure" htmlFor={`${testId}-t`}><Input id={`${testId}-t`} type="time" value={t} onChange={(e) => setT(e.target.value)} /></Field>}
        <Btn variant="primary" onClick={go}><Check size={14} />Déplacer</Btn>
      </div>
      {note && <p className="mt-1.5 text-[11px] text-muted">{note}</p>}
    </div>
  );
};

const TaskMove: React.FC<{ task: Task; date: string; b: Block; onDone: () => void }> = ({ task, date, b, onDone }) => {
  const { dispatch, toast } = useStore();
  const left = Math.max(15, task.estimate - task.spent);
  return <MoveBox testId="task-move" title="Déplacer ce travail" date={date} start={b.start} allowAuto
    note={task.slot ? "Créneau précis de la tâche." : "Heure précise : tout le travail restant est placé à ce créneau. Juste le jour : le travail est réparti sur ce jour."}
    onApply={(d, t) => {
      if (d > task.deadline) { toast(task.kind === "examen" ? "Ce jour est après l'examen." : "Ce jour est après l'échéance.", "bad"); return; }
      if (t) { const len = task.slot ? toMin(task.slot.end) - toMin(task.slot.start) : left; dispatch({ type: "task/update", id: task.id, patch: { slot: { date: d, start: t, end: toHHMM(Math.min(23 * 60 + 59, toMin(t) + len)) }, doDates: undefined, noPlan: undefined } }); }
      else dispatch({ type: "task/update", id: task.id, patch: { slot: undefined, doDates: [d], noPlan: undefined } });
      toast(`« ${task.title} » : ${t ? `${fmtDate(d)} à ${t}` : `${fmtDate(d)} (heure auto)`}`); onDone();
    }} />;
};

const EventMove: React.FC<{ ev: PlanEvent; date: string; onDone: () => void }> = ({ ev, date, onDone }) => {
  const { dispatch, toast } = useStore();
  const [d, setD] = useState(date), [start, setStart] = useState(ev.start), [end, setEnd] = useState(ev.end);
  const [byDur, setByDur] = useState(false), [dur, setDur] = useState(toMin(ev.end) - toMin(ev.start));
  const apply = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(start)) { toast("Choisissez un jour et une heure.", "bad"); return; }
    if (d < todayISO()) { toast("Choisissez aujourd'hui ou un jour à venir.", "bad"); return; }
    const e = byDur ? toHHMM(Math.min(23 * 60 + 59, toMin(start) + Math.max(5, dur || 0))) : end;
    if (toMin(e) <= toMin(start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
    if (ev.recurrence === "none") dispatch({ type: "event/update", id: ev.id, patch: { date: d, start, end: e } });
    else { dispatch({ type: "event/skip", id: ev.id, date }); dispatch({ type: "event/add", event: { id: uid(), title: ev.title, date: d, start, end: e, recurrence: "none", until: null, ...(ev.color ? { color: ev.color } : {}) } }); }
    toast(`« ${ev.title} » : ${fmtDate(d)} · ${start}–${e}`); onDone();
  };
  return (
    <div className="rounded-xl border-2 border-line p-3" data-testid="event-move">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Modifier le jour et l'horaire</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Jour" htmlFor="event-move-d"><Input id="event-move-d" type="date" min={todayISO()} value={d} onChange={(e) => setD(e.target.value)} /></Field>
        <Field label="Début" htmlFor="event-move-t"><Input id="event-move-t" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <div className="col-span-2 flex gap-1.5" role="group">
          {([[false, "Heure de fin"], [true, "Durée"]] as [boolean, string][]).map(([v, l]) => <button key={l} type="button" aria-pressed={byDur === v} onClick={() => setByDur(v)}
            className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold", byDur === v ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>)}
        </div>
        {byDur ? <Field label="Durée (min)" htmlFor="event-move-dur" className="col-span-2"><Input id="event-move-dur" type="number" min={5} step={5} value={dur} onChange={(e) => setDur(Number(e.target.value))} /></Field>
          : <Field label="Fin" htmlFor="event-move-end" className="col-span-2"><Input id="event-move-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">{ev.recurrence !== "none" ? "Seulement cette fois : les autres occurrences ne changent pas." : ""}</p>
        <Btn variant="primary" onClick={apply}><Check size={14} />Enregistrer</Btn>
      </div>
    </div>
  );
};

const BlockDetail: React.FC<{ b: Block; date: string; onClose: () => void }> = ({ b, date, onClose }) => {
  const { state, dispatch, toast, openTask, undoable } = useStore();
  const cls = b.kind === "class" && !b.feedId ? state.classes.find((c) => c.id === b.refId) : undefined;
  const course = cls ? state.courses.find((c) => c.id === cls.courseId) : undefined;
  const fe = b.feedId ? (state.feedEvents ?? []).find((e) => e.uid === b.refId && e.date === date) : undefined;
  const feed = b.feedId ? (state.settings.feeds ?? []).find((f) => f.id === b.feedId) : undefined;
  const ev = b.kind === "event" ? state.events.find((e) => e.id === b.refId) : undefined;
  const task = b.kind === "task" ? state.tasks.find((t) => t.id === b.refId) : undefined;
  const chore = b.kind === "chore" ? state.chores.find((c) => c.id === b.refId) : undefined;
  const title = course?.name ?? fe?.title ?? ev?.title ?? task?.title ?? chore?.name ?? b.label;
  const room = cls?.room ?? fe?.room ?? "";
  const color = b.color ?? (b.kind === "chore" ? "#d4a017" : b.kind === "event" ? "#d6457a" : "#6b7280");
  const canColor = !!course || !!fe || !!ev;
  const setColor = (hex: string) => {
    if (course) dispatch({ type: "course/update", id: course.id, patch: { color: hex } });
    else if (fe) dispatch({ type: "settings", patch: { feedColors: { ...(state.settings.feedColors ?? {}), [norm(fe.title)]: hex } } });
    else if (ev) dispatch({ type: "event/update", id: ev.id, patch: { color: hex } });
    toast(course ? `Couleur de « ${course.name} » mise à jour (tous ses créneaux)` : fe ? `Couleur de « ${fe.title} » mise à jour` : "Couleur mise à jour");
  };
  const rows: [string, React.ReactNode][] = [
    ["Quand", <>{fmtDate(date)} · <b className="font-mono">{toHHMM(b.start)} – {toHHMM(b.end)}</b> <span className="text-muted">({durText(b.end - b.start)})</span></>],
    ["Type", KIND_NAME[b.kind] + (/\((TP|TD|Labo)\)/.exec(b.label)?.[0] ? ` ${/\((TP|TD|Labo)\)/.exec(b.label)![0]}` : "")],
  ];
  if (room) rows.push(["Salle", room]);
  if (course) rows.push(["Matière", <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: course.color }} />{course.name}{course.code ? <span className="text-muted">({course.code})</span> : null}</span>]);
  if (cls?.dates?.length) rows.push(["Semaines", periodsText(cls.dates)]);
  if (feed) rows.push(["Source", `Calendrier « ${feed.name} » · actualisé ${sinceText(feed.lastSync)}`]);
  if (ev) rows.push(["Répétition", EVENT_REC_LABEL[ev.recurrence] + (ev.until ? ` jusqu'au ${fmtDate(ev.until)}` : "")]);
  if (task) rows.push(["Échéance", `${task.deadline === NO_DEADLINE ? "Sans échéance" : fmtDate(task.deadline)} · reste ${durText(Math.max(0, task.estimate - task.spent))}`]);
  if (chore) rows.push(["Récurrence", REC_LABEL[chore.recurrence]]);
  return (
    <Modal title={KIND_NAME[b.kind]} onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="block-detail">
        <div className="flex items-start gap-3">
          <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <h3 className="break-words font-display text-xl font-extrabold leading-snug">{title}</h3>
        </div>
        {b.label !== title && b.label.length > title.length && <p className="break-words rounded-xl bg-sunken p-3 text-[13px]">{b.label}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
          {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>)}
        </dl>
        {chore && <ChoreMove chore={chore} date={date} start={b.start} onDone={onClose} />}
        {task && <TaskMove task={task} date={date} b={b} onDone={onClose} />}
        {ev && <EventMove ev={ev} date={date} onDone={onClose} />}
        {canColor && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Couleur{course ? " de la matière" : ""}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Couleur">
              {BLOCK_COLORS.map((c) => (
                <button key={c.k} role="radio" aria-checked={color.toLowerCase() === c.hex} aria-label={c.label} title={c.label} onClick={() => setColor(c.hex)}
                  className={cx("h-9 w-9 rounded-full border-2 transition", color.toLowerCase() === c.hex ? "scale-110 border-fg shadow-[2px_2px_0_0_rgb(var(--ink))]" : "border-transparent hover:scale-105")} style={{ background: c.hex }} />))}
            </div>
          </div>)}
        <div className="flex flex-wrap justify-end gap-2">
          {task && <Btn onClick={() => { onClose(); openTask(task.id); }}><Pencil size={13} />Modifier la tâche</Btn>}
          {ev && <Btn variant="danger" onClick={() => { onClose(); if (ev.recurrence === "none") undoable({ type: "event/remove", id: ev.id }, `« ${ev.title} » supprimé`); else undoable({ type: "event/skip", id: ev.id, date }, `« ${ev.title} » retiré ce jour-là`); }}>{ev.recurrence === "none" ? "Supprimer" : "Retirer ce jour-là"}</Btn>}
          <Btn variant="primary" onClick={onClose}>Fermer</Btn>
        </div>
      </div>
    </Modal>
  );
};

/** Emploi du temps de toute la semaine : 7 colonnes, créneaux simultanés côte à côte, toucher = fiche détaillée. */
/** Échéances du jour (devoirs à rendre, examens) : bandeau d'alerte à la couleur de la matière. */
const DueBadges: React.FC<{ date: string; compact?: boolean }> = ({ date, compact }) => {
  const { state, openTask } = useStore();
  const due = state.tasks.filter((t) => t.status !== "done" && t.deadline === date);
  if (!due.length) return null;
  return (
    <div className={cx("flex flex-col", compact ? "gap-0.5" : "gap-1.5")} data-testid="due-badges">
      {due.map((t) => { const c = state.courses.find((x) => x.id === t.courseId); const col = c?.color ?? "#e0453a"; const exam = t.kind === "examen"; return (
        <button key={t.id} onClick={() => openTask(t.id)} title={`${exam ? "Examen" : "À rendre"} : ${t.title}`}
          className={cx("flex w-full items-center gap-1.5 overflow-hidden rounded-md border-2 text-left font-semibold text-fg", compact ? "px-1 py-0.5 text-[10px]" : "px-2.5 py-1.5 text-[12.5px]")}
          style={{ borderColor: col, background: `repeating-linear-gradient(-45deg, ${col}26 0 8px, ${col}0d 8px 16px)` }}>
          <span className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: col, width: compact ? 14 : 20, height: compact ? 14 : 20, fontSize: compact ? 9 : 12 }}>!</span>
          {!compact && <span className="shrink-0 rounded px-1 text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: col }}>{exam ? "Examen" : "À rendre"}</span>}
          <span className="min-w-0 flex-1 truncate">{t.title}</span>
          {!compact && c && <span className="shrink-0 text-[11px] font-medium text-muted">{c.code || c.name}</span>}
        </button>); })}
    </div>
  );
};

/** Routines du jour, en bandeau au-dessus de la journée (pas placées dans les créneaux). */
const RoutineStrip: React.FC<{ date: string }> = ({ date }) => {
  const { state, dispatch, toast } = useStore();
  const list = (state.habits ?? []).filter((h) => habitOn(h, date)).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  if (!list.length) return null;
  const canTick = date <= todayISO();
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="routine-strip">
      <span className="self-center text-[11px] font-semibold uppercase tracking-wider text-muted">Routines</span>
      {list.map((h) => { const done = h.done.includes(date); return (
        <button key={h.id} disabled={!canTick} onClick={() => { dispatch({ type: "habit/toggle", id: h.id, date }); if (!done) toast(`${h.emoji} ${h.name} : fait ✓`); }}
          className={cx("inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[12px] font-medium transition", done ? "border-ok/60 bg-ok/12 text-ok line-through" : "border-line bg-sunken hover:border-fg/60", !canTick && "opacity-70")}>
          <span aria-hidden>{done ? "✓" : h.emoji}</span>{h.name}{h.time && <span className="font-mono text-[10px] text-muted">{h.time}</span>}
        </button>); })}
    </div>
  );
};

const WeekGrid: React.FC<{ week: DayPlan[]; today: string; onPick: (b: Block, date: string) => void; onDay: (date: string) => void }> = ({ week, today, onPick, onDay }) => {
  const shown = week.map((d) => d.blocks.filter((b) => b.kind !== "sleep" && b.kind !== "meal"));
  const all = shown.flat();
  const startH = Math.min(8, ...all.map((b) => Math.floor(b.start / 60))), endH = Math.max(19, ...all.map((b) => Math.ceil(b.end / 60)));
  const PX = 44;
  const box = useRef<HTMLDivElement>(null);
  // Sur téléphone, la grille défile horizontalement : on centre le jour actuel.
  useEffect(() => { const i = week.findIndex((d) => d.date === today); const el = box.current; if (el && i > 0) el.scrollLeft = Math.max(0, (el.scrollWidth / 7.4) * i - 40); }, [week[0]?.date]);
  return (
    <div ref={box} className="-mx-1 overflow-x-auto px-1" data-testid="week-grid">
      <div className="grid min-w-[760px] grid-cols-[40px_repeat(7,minmax(0,1fr))] gap-x-1">
        <div />
        {week.map((d) => { const dt = parseISO(d.date); return (
          <div key={d.date} className="flex min-w-0 flex-col gap-0.5"><button onClick={() => onDay(d.date)} className={cx("rounded-lg py-1 text-center text-[11px] font-semibold", d.date === today ? "bg-accent/12 text-accent" : "text-muted hover:bg-sunken")}>{DAYS[weekday(dt)]} {dt.getDate()}</button><DueBadges date={d.date} compact /></div>); })}
        <div className="relative" style={{ height: (endH - startH) * PX }}>
          {Array.from({ length: endH - startH }, (_, i) => <span key={i} className="absolute left-0 font-mono text-[9.5px] text-muted" style={{ top: i * PX }}>{pad(startH + i)}:00</span>)}
        </div>
        {week.map((d, di) => { const ln = layoutLanes(shown[di]); return (
          <div key={d.date} className="relative rounded-md border border-line/70" style={{ height: (endH - startH) * PX, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${PX - 1}px, rgb(var(--line) / .5) ${PX - 1}px ${PX}px)` }}>
            {shown[di].map((b, i) => (
              <button key={i} onClick={() => onPick(b, d.date)} title={`${toHHMM(b.start)}–${toHHMM(b.end)} · ${b.label}`}
                className={cx("absolute overflow-hidden rounded px-1 py-0.5 text-left text-[10px] leading-tight transition hover:brightness-95", BLOCK_STYLE[b.kind])}
                style={{ top: ((b.start - startH * 60) / 60) * PX + 1, height: Math.max(14, ((b.end - b.start) / 60) * PX - 2), borderLeftColor: b.color, left: `${(ln[i].lane / ln[i].lanes) * 100}%`, width: `calc(${100 / ln[i].lanes}% - 2px)` }}>
                <span className="block font-mono text-[9px] text-muted">{toHHMM(b.start)}</span>
                <span className="block break-words font-medium text-fg [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">{b.label}</span>
              </button>))}
          </div>); })}
      </div>
    </div>
  );
};

const Planning: React.FC = () => {
  const { state, dispatch, toast, openTask, undoable } = useStore();
  const [offset, setOffset] = useState(0);
  const today = todayISO();
  const date = iso(addDays(parseISO(today), offset));
  const plan = useMemo(() => planFor(state, date, today), [state, date, today]);
  // Blocs simultanés (plusieurs matières au même moment) : la case est partagée verticalement en colonnes.
  const lanes = useMemo(() => layoutLanes(plan.blocks), [plan.blocks]);
  // Semaine affichée : jours passés tels quels, jours à venir simulés depuis aujourd'hui (charge cohérente avec le tableau de bord).
  const week = useMemo(() => { const mon = iso(addDays(parseISO(date), -weekday(parseISO(date)))); return Array.from({ length: 7 }, (_, i) => planFor(state, iso(addDays(parseISO(mon), i)), today)); }, [state, date, today]);
  const [unav, setUnav] = useState({ day: 0, start: "18:00", end: "21:00", label: "" });
  const [ev, setEv] = useState({ title: "", date: today, start: "18:00", end: "19:00", recurrence: "none" as EventRecurrence, until: "" });
  const upcomingEvents = [...(state.events ?? [])].filter((e) => e.recurrence !== "none" ? !e.until || e.until >= today : e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
  const startH = Math.floor(plan.wake / 60), endH = Math.ceil(Math.min(plan.bed, 1440 + 120) / 60);
  const PX = 84; // pixels par heure (assez haut pour lire les blocs courts)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const [exporting, setExporting] = useState(false);
  const [sel, setSel] = useState<{ b: Block; date: string } | null>(null);
  // Glisser un bloc verticalement pour changer son heure (corvées, tâches, événements).
  const [dragI, setDragI] = useState<{ i: number; dy: number } | null>(null);
  const dragRef = useRef<number | null>(null);
  const snap = (dy: number) => Math.round(((dy / PX) * 60) / 5) * 5;
  const blockDrag = useDrag({
    onMove: (_dx, dy) => { if (dragRef.current !== null) setDragI({ i: dragRef.current, dy }); },
    onCancel: () => { setDragI(null); dragRef.current = null; },
    onDrop: (_dx, dy) => {
      const i = dragRef.current; setDragI(null); dragRef.current = null; if (i === null) return;
      const b = plan.blocks[i]; const delta = snap(dy); if (!delta) return;
      const len = b.end - b.start, wanted = Math.max(0, Math.min(23 * 60 + 55 - len, b.start + delta));
      // Chorés et tâches : jamais par-dessus un autre bloc (on glisse au plus proche créneau libre). Les événements restent libres.
      const start = b.kind === "event" ? wanted : freeStart(wanted, len, plan.blocks.filter((x, j) => j !== i && x.kind !== "meal" && x.kind !== "sleep")), t = toHHMM(start);
      if (start !== wanted) toast("Créneau occupé : placé juste à côté.", "info");
      if (b.kind === "chore" && b.refId) { const c = state.chores.find((x) => x.id === b.refId); if (c) moveChoreTo(dispatch, c, date, date, t); }
      else if (b.kind === "task" && b.refId) { const tk = state.tasks.find((x) => x.id === b.refId); if (tk) { const l = tk.slot ? toMin(tk.slot.end) - toMin(tk.slot.start) : Math.max(len, 15); dispatch({ type: "task/update", id: tk.id, patch: { slot: { date, start: t, end: toHHMM(Math.min(23 * 60 + 59, start + l)) }, doDates: undefined, noPlan: undefined } }); } }
      else if (b.kind === "event" && b.refId) { const ev = state.events.find((x) => x.id === b.refId); if (ev) { const e = toHHMM(start + len);
        if (ev.recurrence === "none") dispatch({ type: "event/update", id: ev.id, patch: { start: t, end: e } });
        else { dispatch({ type: "event/skip", id: ev.id, date }); dispatch({ type: "event/add", event: { id: uid(), title: ev.title, date, start: t, end: e, recurrence: "none", until: null, ...(ev.color ? { color: ev.color } : {}) } }); } } }
      else return;
      toast(`« ${b.label.replace(/^✓ /, "")} » : ${t}`);
    },
  });
  const movable = (b: Block) => !!b.refId && (b.kind === "chore" || b.kind === "task" || (b.kind === "event" && state.events.some((e) => e.id === b.refId)));
  const [mode, setMode] = useState<"day" | "week">(() => { try { return localStorage.getItem("etudiant-os/planning-view") === "week" ? "week" : "day"; } catch { return "day"; } });
  useEffect(() => { try { localStorage.setItem("etudiant-os/planning-view", mode); } catch { /* préférence facultative */ } }, [mode]);
  const exportPdf = async () => {
    setExporting(true);
    try { const r = await exportWeekPdf(week, state.settings.name); if (r === "downloaded") toast("PDF du planning téléchargé"); }
    catch { toast("Export PDF impossible : vérifiez votre connexion internet (le générateur PDF se charge à la première utilisation).", "bad"); }
    finally { setExporting(false); }
  };
  const [newClass, setNewClass] = useState({ courseId: state.courses[0]?.id ?? "", day: 0, start: "10:00", end: "12:00", room: "" });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {sel && <BlockDetail b={sel.b} date={sel.date} onClose={() => setSel(null)} />}
      <Card title={<span className="flex items-center gap-2"><CalendarClock size={15} />{mode === "week" ? `Semaine du ${parseISO(week[0].date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : `${DAYS_LONG[weekday(parseISO(date))]} ${parseISO(date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`}</span>}
        action={<>
          <div role="tablist" aria-label="Affichage" className="mr-1 flex gap-0.5 rounded-xl bg-sunken p-0.5 text-[12px] font-semibold">
            {([["day", "Jour"], ["week", "Semaine"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cx("rounded-lg px-2.5 py-1", mode === k ? "bg-panel text-fg shadow-sm" : "text-muted")}>{l}</button>)}
          </div>
          <Btn size="sm" variant="ghost" onClick={() => setOffset(offset - (mode === "week" ? 7 : 1))} aria-label={mode === "week" ? "Semaine précédente" : "Jour précédent"}><ChevronLeft size={14} /></Btn><Btn size="sm" onClick={() => setOffset(0)}>Aujourd'hui</Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(offset + (mode === "week" ? 7 : 1))} aria-label={mode === "week" ? "Semaine suivante" : "Jour suivant"}><ChevronRight size={14} /></Btn></>}>
        {mode === "day" && <>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Saturation</p><div className="mt-1 flex items-center gap-2"><Pill tone={levelTone(plan.level)}>{plan.level}</Pill></div></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Cours{plan.busyMin ? " + indispo." : ""}</p><p className="font-mono text-sm tabular-nums">{fmtDur(plan.classMin + plan.busyMin)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Travail planifié</p><p className="font-mono text-sm tabular-nums">{fmtDur(plan.taskMin)}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Éveil</p><p className="font-mono text-sm tabular-nums">{toHHMM(plan.wake)} → {toHHMM(plan.bed)}</p></div>
        </div>
        <LoadMeter load={plan.load} level={plan.level} />
        {plan.conflicts.length > 0 && (
          <div className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-warn"><AlertTriangle size={13} />Chevauchement{plan.conflicts.length > 1 ? "s" : ""} détecté{plan.conflicts.length > 1 ? "s" : ""}</p>
            {plan.conflicts.map((c, i) => <p key={i} className="text-muted"><span className="font-mono">{toHHMM(c.start)}–{toHHMM(c.end)}</span> · {c.a} / {c.b}</p>)}
            <p className="mt-1 text-muted">Un cours tombe sur une indisponibilité ou un événement personnel. Rien n'est déplacé automatiquement.</p>
          </div>)}
        </>}
        {plan.past && <p className="mt-3 text-xs text-muted">Journée passée : seuls les cours et indisponibilités sont affichés.</p>}
        {mode === "week" ? <div><p className="mb-2 text-[11px] text-muted md:hidden">Glissez horizontalement pour voir toute la semaine · touchez un créneau pour le détail.</p><WeekGrid week={week} today={today} onPick={(bb, d) => setSel({ b: bb, date: d })} onDay={(d) => { setOffset(daysBetween(today, d)); setMode("day"); }} /></div> : <>
        <div className="mt-4 flex flex-col gap-2"><DueBadges date={date} /><RoutineStrip date={date} /></div>
        <div className="relative mt-4 overflow-hidden rounded-lg border border-line" style={{ height: (endH - startH) * PX }}>
          {Array.from({ length: endH - startH }, (_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * PX }}><span className="absolute left-2 top-0.5 font-mono text-[10px] text-muted">{pad((startH + i) % 24)}:00</span></div>
          ))}
          {offset === 0 && nowMin > startH * 60 && nowMin < endH * 60 && (
            <div className="absolute inset-x-0 z-10 h-px bg-bad" style={{ top: ((nowMin - startH * 60) / 60) * PX }}><span className="absolute -left-0.5 -top-[3px] h-[7px] w-[7px] rounded-full bg-bad" /></div>
          )}
          {plan.blocks.map((b, i) => { const ln = lanes[i]; const h = Math.max(22, ((b.end - b.start) / 60) * PX - 3), compact = h < 44; return (
            <div key={i} role="button" tabIndex={0} onPointerDown={movable(b) ? (e) => { dragRef.current = i; blockDrag.onPointerDown(e); } : undefined} onClick={() => { if (blockDrag.wasDrag()) return; setSel({ b, date }); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel({ b, date }); } }} title={`${toHHMM(b.start)}–${toHHMM(b.end)} · ${b.label}`}
              className={cx("absolute cursor-pointer overflow-hidden rounded-md px-2 text-xs shadow-sm hover:brightness-95", dragI?.i !== i && "transition", compact ? "flex items-center gap-1.5 py-0" : "py-1.5", BLOCK_STYLE[b.kind], ln.lanes > 1 && "ring-1 ring-bg", dragI?.i === i && "z-30 scale-[1.02] shadow-lg ring-2 ring-accent")}
              style={{ top: ((b.start - startH * 60) / 60) * PX + 1.5 + (dragI?.i === i ? (snap(dragI.dy) / 60) * PX : 0), height: h, borderLeftColor: b.color,
                left: `calc(3.5rem + (100% - 4rem) * ${ln.lane} / ${ln.lanes})`, width: `calc((100% - 4rem) / ${ln.lanes} - 3px)` }}>
              <div className={cx("flex items-center gap-1.5", compact && "shrink-0")}>
                <span className="font-mono text-[10px] tabular-nums text-muted">{dragI?.i === i ? <b className="text-accent">{toHHMM(b.start + snap(dragI.dy))}</b> : toHHMM(b.start)}{compact ? "" : `–${toHHMM(b.end + (dragI?.i === i ? snap(dragI.dy) : 0))}`}</span>
                {b.kind === "task" && <Zap size={10} className="text-accent" />}{b.kind === "chore" && <Home size={10} className="text-warn" />}{b.kind === "meal" && <Coffee size={10} />}{b.kind === "event" && <CalendarClock size={10} className="text-pink" />}
                {b.kind === "event" && b.refId && <button className="ml-auto rounded px-1 text-[10px] text-muted hover:bg-sunken hover:text-bad" aria-label={`Retirer ${b.label} ce jour-là`} title="Retirer cette occurrence"
                  onClick={(e) => { e.stopPropagation(); const evt = state.events.find((x) => x.id === b.refId); if (!evt) return;
                    if (evt.recurrence === "none") undoable({ type: "event/remove", id: evt.id }, `« ${evt.title} » supprimé`); else undoable({ type: "event/skip", id: evt.id, date }, `« ${evt.title} » retiré ce jour-là`); }}>✕</button>}
              </div>
              <p className={cx("font-medium text-fg", compact ? "min-w-0 flex-1 truncate text-[12px]" : ln.lanes > 1 ? "break-words leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] overflow-hidden" : "truncate")}>{b.label}</p>
            </div>
          ); })}
        </div>
        </>}
        <p className="mt-2 text-xs text-muted">Les blocs <Zap size={10} className="inline text-accent" /> sont générés automatiquement : reste à faire ÷ jours avant l'échéance, ajusté par la priorité, placé dans les créneaux libres (blocs de {state.settings.maxBlock} min max, 10 min de pause entre deux).</p>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        {plan.overflow.length > 0 && (
          <Card title={<span className="flex items-center gap-2 text-bad"><AlertTriangle size={14} />Ne tient pas {offset === 0 ? "aujourd'hui" : "ce jour-là"}</span>}>
            <ul className="flex flex-col gap-2 text-[13px]">
              {plan.overflow.map((o) => (<li key={o.task.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{o.task.title}</span><span className="font-mono text-xs text-muted">{fmtDur(o.minutes)}</span>
                <Btn size="sm" variant="ghost" title="Repousser l'échéance d'un jour" onClick={() => { dispatch({ type: "task/update", id: o.task.id, patch: { deadline: iso(addDays(parseISO(o.task.deadline), 1)) } }); toast("Échéance repoussée d'un jour", "info"); }}>+1 j</Btn></li>))}
            </ul>
          </Card>
        )}
        <Card title="Semaine" action={<Btn size="sm" onClick={() => void exportPdf()} disabled={exporting} data-testid="export-pdf"><Download size={13} />{exporting ? "Export…" : "PDF"}</Btn>}>
          <div className="grid grid-cols-7 gap-1.5">
            {week.map((p) => { const h = Math.min(1.2, p.load); const tone = p.level === "surcharge" ? "bg-bad" : p.level === "chargé" ? "bg-warn" : "bg-ok";
              return (<button key={p.date} onClick={() => setOffset(daysBetween(today, p.date))} className={cx("flex flex-col items-center gap-1 rounded-md p-1 hover:bg-sunken", p.date === date && "bg-sunken ring-1 ring-accent")}>
                <div className="flex h-20 w-full items-end justify-center rounded bg-sunken/60"><div className={cx("w-3 rounded-sm", tone)} style={{ height: `${(h / 1.2) * 100}%` }} /></div>
                <span className="text-[10px] text-muted">{DAYS[weekday(parseISO(p.date))]}</span><span className="font-mono text-[10px] tabular-nums">{Math.round(p.load * 100)}%</span></button>); })}
          </div>
        </Card>
        <CalendarFeeds />
        <Card title={<span className="flex items-center gap-2"><CalendarClock size={15} />Événements</span>} action={<span className="text-[11px] text-muted">rendez-vous, sport, sorties…</span>}>
          {upcomingEvents.length ? (
            <ul className="mb-3 flex flex-col gap-1 text-xs" data-testid="events-list">{upcomingEvents.map((e) => (
              <li key={e.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-sunken">
                <span className="w-16 shrink-0 text-muted">{e.recurrence === "none" ? fmtDate(e.date) : EVENT_REC_LABEL[e.recurrence]}</span>
                <span className="font-mono tabular-nums">{e.start}–{e.end}</span><span className="min-w-0 flex-1 truncate">{e.title}</span>
                <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label={`Supprimer l'événement ${e.title}`} onClick={() => undoable({ type: "event/remove", id: e.id }, `« ${e.title} » supprimé${e.recurrence !== "none" ? " (toutes les occurrences)" : ""}`)}><Trash2 size={12} /></button></li>))}</ul>
          ) : <p className="mb-3 text-xs text-muted">Aucun événement à venir. Ils apparaissent dans le planning à l'heure choisie ; aucun travail n'y est placé.</p>}
          <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault();
            if (!ev.title.trim()) { toast("Donne un nom à l'événement.", "bad"); return; }
            if (!ev.date) { toast("Choisis une date.", "bad"); return; }
            if (toMin(ev.end) <= toMin(ev.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
            if (ev.recurrence !== "none" && ev.until && ev.until < ev.date) { toast("La fin de la répétition doit suivre la première date.", "bad"); return; }
            dispatch({ type: "event/add", event: { id: uid(), title: ev.title.trim(), date: ev.date, start: ev.start, end: ev.end, recurrence: ev.recurrence, until: ev.recurrence !== "none" && ev.until ? ev.until : null } });
            toast(ev.recurrence === "none" ? "Événement ajouté au planning" : `Événement ajouté (${EVENT_REC_LABEL[ev.recurrence].toLowerCase()})`); setEv({ ...ev, title: "" }); }}>
            <Input id="ev-title" aria-label="Événement" placeholder="Ex. Dentiste, Foot, Anniversaire" className="col-span-2" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
            <Field label="Date" htmlFor="ev-date" className="col-span-2"><Input id="ev-date" type="date" value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} /></Field>
            <Field label="Début" htmlFor="ev-start"><Input id="ev-start" type="time" value={ev.start} onChange={(e) => setEv({ ...ev, start: e.target.value })} /></Field>
            <Field label="Fin" htmlFor="ev-end"><Input id="ev-end" type="time" value={ev.end} onChange={(e) => setEv({ ...ev, end: e.target.value })} /></Field>
            <Field label="Répétition" htmlFor="ev-rec" className={ev.recurrence === "none" ? "col-span-2" : ""}><Select id="ev-rec" value={ev.recurrence} onChange={(e) => setEv({ ...ev, recurrence: e.target.value as EventRecurrence })}>{(Object.keys(EVENT_REC_LABEL) as EventRecurrence[]).map((r) => <option key={r} value={r}>{EVENT_REC_LABEL[r]}</option>)}</Select></Field>
            {ev.recurrence !== "none" && <Field label="Jusqu'au (facultatif)" htmlFor="ev-until"><Input id="ev-until" type="date" min={ev.date} value={ev.until} onChange={(e) => setEv({ ...ev, until: e.target.value })} /></Field>}
            <Btn type="submit" className="col-span-2"><Plus size={14} />Ajouter l'événement</Btn>
          </form>
        </Card>
        <Card title="Indisponibilités" action={<span className="text-[11px] text-muted">job, sport, trajets…</span>}>
          {state.settings.unavailable.length ? (
            <ul className="mb-3 flex flex-col gap-1 text-xs">{[...state.settings.unavailable].sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start)).map((u) => (
              <li key={u.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-sunken"><span className="w-8 text-muted">{DAYS[u.day]}</span><span className="font-mono tabular-nums">{u.start}–{u.end}</span><span className="min-w-0 flex-1 truncate">{u.label || "Indisponible"}</span>
                <button className="text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer l'indisponibilité" onClick={() => undoable({ type: "settings", patch: { unavailable: state.settings.unavailable.filter((x) => x.id !== u.id) } }, "Indisponibilité supprimée")}><Trash2 size={12} /></button></li>))}</ul>
          ) : <p className="mb-3 text-xs text-muted">Aucune. Le planning ne place jamais de travail sur ces créneaux.</p>}
          <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault();
            if (toMin(unav.end) <= toMin(unav.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
            dispatch({ type: "settings", patch: { unavailable: [...state.settings.unavailable, { id: uid(), ...unav, label: unav.label.trim() }] } }); toast("Indisponibilité ajoutée au planning"); setUnav({ ...unav, label: "" }); }}>
            <Input id="un-label" aria-label="Libellé" placeholder="Ex. Job étudiant" className="col-span-2" value={unav.label} onChange={(e) => setUnav({ ...unav, label: e.target.value })} />
            <Select id="un-day" aria-label="Jour" className="col-span-2" value={unav.day} onChange={(e) => setUnav({ ...unav, day: Number(e.target.value) })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
            <Input id="un-start" aria-label="Début" type="time" value={unav.start} onChange={(e) => setUnav({ ...unav, start: e.target.value })} />
            <Input id="un-end" aria-label="Fin" type="time" value={unav.end} onChange={(e) => setUnav({ ...unav, end: e.target.value })} />
            <Btn type="submit" className="col-span-2"><Plus size={14} />Ajouter</Btn>
          </form>
        </Card>
        <TimetableImport />
        <Card title="Emploi du temps fixe">
          <ul className="mb-3 flex max-h-56 flex-col gap-1 overflow-auto pr-1 text-xs">
            {[...state.classes].sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start)).map((c) => { const co = state.courses.find((x) => x.id === c.courseId); return (
              <li key={c.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-sunken"><span className="w-8 text-muted">{DAYS[c.day]}</span><span className="font-mono tabular-nums">{c.start}–{c.end}</span>
                <span className="h-2 w-2 rounded-full" style={{ background: co?.color }} /><span className="min-w-0 flex-1 truncate">{co?.code}{c.dates?.length ? <span className="block whitespace-normal text-[10.5px] text-muted">{c.room ? `${c.room} · ` : ""}{periodsText(c.dates)}</span> : null}</span>
                <button className="text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer le créneau" onClick={() => undoable({ type: "class/remove", id: c.id }, "Créneau supprimé")}><Trash2 size={12} /></button></li>); })}
          </ul>
          <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); if (toMin(newClass.end) <= toMin(newClass.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; } const clash = state.classes.find((c) => c.day === newClass.day && toMin(c.start) < toMin(newClass.end) && toMin(newClass.start) < toMin(c.end));
            dispatch({ type: "class/add", session: { id: uid(), ...newClass } });
            toast(clash ? `Cours ajouté, mais il chevauche un autre créneau (${clash.start}–${clash.end}).` : "Cours ajouté à l'emploi du temps", clash ? "info" : "ok"); }}>
            <Select id="nc-course" aria-label="Module" className="col-span-2" value={newClass.courseId} onChange={(e) => setNewClass({ ...newClass, courseId: e.target.value })}>{state.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select id="nc-day" aria-label="Jour" value={newClass.day} onChange={(e) => setNewClass({ ...newClass, day: Number(e.target.value) })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select>
            <Input id="nc-room" aria-label="Salle" placeholder="Salle" value={newClass.room} onChange={(e) => setNewClass({ ...newClass, room: e.target.value })} />
            <Input id="nc-start" aria-label="Début" type="time" value={newClass.start} onChange={(e) => setNewClass({ ...newClass, start: e.target.value })} />
            <Input id="nc-end" aria-label="Fin" type="time" value={newClass.end} onChange={(e) => setNewClass({ ...newClass, end: e.target.value })} />
            <Btn type="submit" className="col-span-2" disabled={!state.courses.length}><Plus size={14} />Ajouter le créneau</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Académique
export const STATUS: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "À faire", color: "rgb(var(--muted))" }, doing: { label: "En cours", color: "rgb(var(--accent))" },
  review: { label: "En révision", color: "rgb(var(--warn))" }, done: { label: "Terminé", color: "rgb(var(--ok))" },
};
const ORDER: TaskStatus[] = ["todo", "doing", "review", "done"];
const KIND_LABEL: Record<TaskKind, string> = { devoir: "Devoir", examen: "Examen", projet: "Projet", perso: "Devoir perso" };

// ---------------------------------------------------------------- Bloc-notes (clavier ou Apple Pencil)
const INK_W = 1200, INK_H = 900;
const InkPad: React.FC<{ ink?: string; onSave: (dataUrl: string | undefined) => void }> = ({ ink, onSave }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<"pen" | "hl" | "eraser">("pen");
  const [color, setColor] = useState("ink");
  const history = useRef<ImageData[]>([]);
  const penSeen = useRef(false); // dès qu'un stylet est détecté, le doigt / la paume n'écrit plus
  const last = useRef<{ x: number; y: number; p: number } | null>(null);
  const saveT = useRef<number>();
  const colors: Record<string, string> = { ink: "#18162e", blue: "#3448f0", red: "#e0453a", green: "#0f9d76" };
  useEffect(() => {
    const c = ref.current; if (!c) return; const g = c.getContext("2d")!;
    g.clearRect(0, 0, INK_W, INK_H);
    if (ink) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0); img.src = ink; }
  }, []); // dessin initial seulement
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * INK_W, y: ((e.clientY - r.top) / r.height) * INK_H, p: e.pressure > 0 ? e.pressure : 0.5 }; };
  const save = () => { window.clearTimeout(saveT.current); saveT.current = window.setTimeout(() => onSave(ref.current!.toDataURL("image/png")), 400); };
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") penSeen.current = true; else if (penSeen.current && e.pointerType === "touch") return;
    const g = ref.current!.getContext("2d")!; history.current = [...history.current.slice(-14), g.getImageData(0, 0, INK_W, INK_H)];
    ref.current!.setPointerCapture(e.pointerId); last.current = pos(e);
  };
  const moveTo = (e: React.PointerEvent) => {
    if (!last.current || (penSeen.current && e.pointerType === "touch")) return;
    const g = ref.current!.getContext("2d")!; const pts = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of pts) {
      const r = ref.current!.getBoundingClientRect(); const p = { x: ((ev.clientX - r.left) / r.width) * INK_W, y: ((ev.clientY - r.top) / r.height) * INK_H, p: ev.pressure > 0 ? ev.pressure : 0.5 };
      g.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      g.globalAlpha = tool === "hl" ? 0.3 : 1;
      g.strokeStyle = tool === "hl" ? "#f5d90a" : colors[color]; g.lineCap = "round"; g.lineJoin = "round";
      g.lineWidth = tool === "eraser" ? 28 : tool === "hl" ? 22 : 1.6 + p.p * 4;
      g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
      last.current = p;
    }
  };
  const up = () => { if (last.current) { last.current = null; save(); } };
  const undo = () => { const g = ref.current!.getContext("2d")!; const prev = history.current.pop(); if (prev) { g.putImageData(prev, 0, 0); save(); } };
  const clear = () => { const g = ref.current!.getContext("2d")!; history.current.push(g.getImageData(0, 0, INK_W, INK_H)); g.clearRect(0, 0, INK_W, INK_H); onSave(undefined); };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {([["pen", "✏️ Stylo"], ["hl", "🖍 Surligneur"], ["eraser", "🧽 Gomme"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={tool === k} onClick={() => setTool(k)}
          className={cx("rounded-full border px-2.5 py-1 text-[12px]", tool === k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken")}>{l}</button>)}
        <span className="mx-1 h-5 w-px bg-line" />
        {Object.entries(colors).map(([k, v]) => <button key={k} type="button" aria-label={`Couleur ${k}`} aria-pressed={color === k} onClick={() => { setColor(k); setTool("pen"); }}
          className={cx("h-6 w-6 rounded-full border-2", color === k ? "border-fg ring-2 ring-accent/40" : "border-line")} style={{ background: v }} />)}
        <span className="ml-auto flex gap-1"><Btn size="sm" variant="ghost" onClick={undo}>↶ Annuler</Btn><Btn size="sm" variant="ghost" onClick={clear}>Effacer</Btn></span>
      </div>
      <canvas ref={ref} width={INK_W} height={INK_H} onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} data-no-ptr
        className="block w-full touch-none rounded-xl border-2 border-line" aria-label="Zone de dessin (Apple Pencil ou doigt)"
        style={{ aspectRatio: `${INK_W} / ${INK_H}`, backgroundColor: "#fbfaf5", backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 31px, rgba(80,90,140,.18) 31px 32px)" }} />
      <p className="mt-1 text-[11px] text-muted">Écrivez avec l'Apple Pencil (pression prise en compte) ou le doigt. Dès que le stylet est utilisé, la paume est ignorée. Enregistré automatiquement.</p>
    </div>
  );
};

const AcademicNotes: React.FC = () => {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<"text" | "ink">(state.notes?.ink && !state.notes?.text ? "ink" : "text");
  const [text, setText] = useState(state.notes?.text ?? "");
  const t = useRef<number>();
  useEffect(() => { window.clearTimeout(t.current); t.current = window.setTimeout(() => { if (text !== (state.notes?.text ?? "")) dispatch({ type: "notes/set", patch: { text } }); }, 500); return () => window.clearTimeout(t.current); }, [text]);
  return (
    <Card title={<span className="flex items-center gap-2"><Pencil size={15} />Bloc-notes</span>} action={<div className="flex gap-1" role="group">
      {([["text", "⌨️ Clavier"], ["ink", "✍️ Apple Pencil"]] as const).map(([k, l]) => <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k}
        className={cx("rounded-full border px-2.5 py-1 text-[12px]", mode === k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken")}>{l}</button>)}</div>}>
      {mode === "text"
        ? <textarea aria-label="Notes" value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={"Listez vos devoirs, idées, questions pour le prof…\n- Lire le chapitre 3\n- Exos 4 à 7"}
            className="w-full resize-y rounded-xl border-2 border-line bg-panel p-3 font-[inherit] text-[14px] leading-8 outline-none focus:border-accent"
            style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 31px, rgb(var(--line) / .7) 31px 32px)", backgroundAttachment: "local" }} />
        : <InkPad ink={state.notes?.ink} onSave={(ink) => dispatch({ type: "notes/set", patch: { ink } })} />}
      <p className="mt-1 text-[11px] text-muted">Juste pour noter : ces notes ne créent pas de tâches et n'apparaissent pas dans le planning.</p>
    </Card>
  );
};

const Academic: React.FC<{ openNewTask: () => void }> = ({ openNewTask }) => {
  const { state, dispatch, toast, undoable, openTask } = useStore();
  const [filter, setFilter] = useState<string>("");
  const [dragId, setDragId] = useState<ID | null>(null);
  const [courseForm, setCourseForm] = useState({ name: "", code: "", coef: 1 });
  const today = todayISO();
  const [when, setWhen] = useState<"" | "today" | "tomorrow" | "week">("");
  // Jours concernés par chaque tâche : échéance, do dates, créneau précis et travail planifié (7 jours).
  const touched = useMemo(() => {
    const m = new Map<ID, Set<string>>(); const add = (id: ID, d: string) => { if (!m.has(id)) m.set(id, new Set()); m.get(id)!.add(d); };
    for (const t of state.tasks) { add(t.id, t.deadline); t.doDates?.forEach((d) => add(t.id, d)); if (t.slot) add(t.id, t.slot.date); }
    for (const p of planRange(state, today, 7, today)) for (const b of p.blocks) if (b.kind === "task" && b.refId) add(b.refId, p.date);
    return m;
  }, [state, today]);
  const range = when === "today" ? [today] : when === "tomorrow" ? [iso(addDays(parseISO(today), 1))] : when === "week" ? Array.from({ length: 7 }, (_, i) => iso(addDays(parseISO(today), i))) : null;
  const tasks = state.tasks.filter((t) => (!filter || t.courseId === filter) && (!range || range.some((d) => touched.get(t.id)?.has(d)) || (range && t.status !== "done" && t.deadline < today && when !== "tomorrow")));
  const move = (t: Task, dir: 1 | -1) => { const i = ORDER.indexOf(t.status) + dir; if (i < 0 || i >= ORDER.length) return; dispatch({ type: "task/update", id: t.id, patch: { status: ORDER[i] } }); if (ORDER[i] === "done") toast(`« ${t.title} » terminé`); };
  const palette = ["#2f6fed", "#0f9d76", "#d9822b", "#c2417a", "#7a5af5", "#1d9bb5", "#b5651d"];

  return (
    <div className="flex flex-col gap-4">
      <AcademicNotes />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Période">{([["", "Tout"], ["today", "Aujourd'hui"], ["tomorrow", "Demain"], ["week", "Cette semaine"]] as const).map(([k, l]) => <button key={k} onClick={() => setWhen(k)} aria-pressed={when === k}
          className={cx("rounded-full border px-2.5 py-1 text-[12px] font-medium", when === k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken")}>{l}</button>)}</div>
        <Select id="ac-filter" aria-label="Filtrer par module" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tous les modules</option>{state.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <span className="text-xs text-muted">Glissez une carte d'une colonne à l'autre, ou utilisez les flèches.</span>
        <Btn variant="primary" className="ml-auto" onClick={openNewTask}><Plus size={14} />Nouvelle tâche <Kbd>N</Kbd></Btn>
      </div>
      <div className="grid gap-3 md:grid-cols-2 min-[1100px]:grid-cols-4">
        {ORDER.map((s) => { const col = tasks.filter((t) => t.status === s).sort((a, b) => a.deadline.localeCompare(b.deadline)); return (
          <div key={s} className={cx("flex min-w-0 flex-col rounded-2xl border-2 border-dashed border-line bg-sunken/40 p-2 transition-colors duration-300", dragId && "border-accent bg-accent/5")}
            onDragOver={(e) => e.preventDefault()} onDrop={() => { const t = state.tasks.find((x) => x.id === dragId); if (t && t.status !== s) { dispatch({ type: "task/update", id: t.id, patch: { status: s } }); toast(`Déplacé vers « ${STATUS[s].label} »`, s === "done" ? "ok" : "info"); } setDragId(null); }}>
            <div className="flex items-center gap-2 px-2 py-1.5"><span className="h-2 w-2 rounded-full" style={{ background: STATUS[s].color }} /><span className="text-xs font-semibold">{STATUS[s].label}</span><span className="font-mono text-xs text-muted">{col.length}</span></div>
            <div className="flex flex-col gap-2">
              {col.map((t) => { const c = state.courses.find((x) => x.id === t.courseId); const left = daysBetween(today, t.deadline); const pct = Math.min(100, (t.spent / t.estimate) * 100); return (
                <article key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                  className={cx("group cursor-grab rounded-xl border-2 border-fg/80 bg-panel p-3 shadow-[3px_3px_0_0_rgb(var(--ink))] transition-all duration-300 [transition-timing-function:var(--spring)] hover:-translate-y-0.5 hover:rotate-[-.6deg] active:cursor-grabbing", dragId === t.id && "rotate-2 opacity-60")}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: c?.color }}>{c?.code ?? "Libre"}</span>
                    <Pill>{KIND_LABEL[t.kind]}</Pill>{t.priority === 3 && <Flame size={12} className="text-bad" aria-label="Priorité haute" />}
                    <span className="ml-auto flex shrink-0 items-center gap-1"><button className="text-muted opacity-60 transition hover:text-accent group-hover:opacity-100" aria-label="Modifier la tâche" onClick={() => openTask(t.id)}><Pencil size={12} /></button>
                    <button className="text-muted opacity-60 transition hover:text-bad group-hover:opacity-100" aria-label="Supprimer la tâche" onClick={() => undoable({ type: "task/remove", id: t.id }, `Tâche « ${t.title} » supprimée`)}><Trash2 size={12} /></button></span>
                  </div>
                  <p className={cx("text-[13px] font-medium leading-snug", s === "done" && "text-muted line-through")}>{t.title}</p>
                  {taskDoneLate(t) && <p className="mt-1 text-[11px] font-semibold text-warn">⏰ Terminé en retard</p>}
                  {t.noPlan && s !== "done" && <p className="mt-1 text-[11px] text-muted">🚫 Pas de do date · hors planning</p>}
                  {!!t.doDates?.length && s !== "done" && <p className="mt-1 text-[11px] text-muted">{t.kind === "examen" ? "📖 Révision" : "🛠 Travail"} : {t.doDates.map((d) => fmtDate(d)).join(" · ")}</p>}
                  {!!t.steps?.length && <div className="mt-1.5" onPointerDown={(e) => e.stopPropagation()}><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Checklist · {t.steps.filter((x) => x.done).length}/{t.steps.length}</p>
                    <StepsCheck small steps={t.steps} done={(id) => !!t.steps?.find((x) => x.id === id)?.done} onToggle={(stepId) => dispatch({ type: "task/step", id: t.id, stepId })} label={`Checklist de ${t.title}`} /></div>}
                  <div className="mt-2 h-1 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                    <span className="font-mono tabular-nums">{fmtDur(t.spent)} / {fmtDur(t.estimate)}</span>
                    <span className={cx("ml-auto", s !== "done" && left < 0 && "font-semibold text-bad", s !== "done" && left >= 0 && left <= 2 && "text-warn")}>{t.deadline === NO_DEADLINE ? "Sans échéance" : fmtDate(t.deadline)}</span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <Btn size="sm" variant="ghost" disabled={s === "todo"} onClick={() => move(t, -1)} aria-label="Statut précédent"><ChevronLeft size={13} /></Btn>
                    <Btn size="sm" variant="ghost" disabled={s === "done"} onClick={() => move(t, 1)} aria-label="Statut suivant"><ChevronRight size={13} /></Btn>
                  </div>
                </article>); })}
              {!col.length && <p className="px-2 py-6 text-center text-xs text-muted">Aucune tâche</p>}
            </div>
          </div>); })}
      </div>


      {!state.tasks.length && <Empty icon={<GraduationCap size={18} />} title="Aucune tâche pour l'instant" hint="Ajoutez vos devoirs, examens et projets : ils seront répartis automatiquement dans votre planning." action={<Btn variant="primary" onClick={openNewTask}><Plus size={14} />Première tâche</Btn>} />}
      <Card title="Modules" action={<span className="font-mono text-xs text-muted">{state.courses.length}</span>}>
        {state.courses.length ? (
          <ul className="flex flex-col divide-y divide-line text-[13px]">
            {state.courses.map((c) => { const open = state.tasks.filter((t) => t.courseId === c.id && t.status !== "done").length; const slots = state.classes.filter((x) => x.courseId === c.id).length; return (
              <li key={c.id} className="group flex flex-wrap items-center gap-2 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="font-mono text-[11px] text-muted">{c.code}</span>
                <span className="text-[11px] text-muted">{open} tâche{open > 1 ? "s" : ""} · {slots} créneau{slots > 1 ? "x" : ""}</span>
                <Btn size="sm" variant="danger" aria-label={`Supprimer ${c.name}`} onClick={() => undoable({ type: "course/remove", id: c.id }, `Module « ${c.name} » supprimé (créneaux inclus)`)}><Trash2 size={12} /></Btn>
              </li>); })}
          </ul>
        ) : <p className="py-4 text-center text-xs text-muted">Ajoutez vos modules pour les relier à vos tâches et à votre emploi du temps.</p>}
        <form className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!courseForm.name.trim()) { toast("Nommez le module.", "bad"); return; }
          dispatch({ type: "course/add", course: { id: uid(), name: courseForm.name.trim(), code: courseForm.code.trim().toUpperCase() || courseForm.name.slice(0, 4).toUpperCase(), coef: 1, color: palette[state.courses.length % palette.length], grades: [] } });
          setCourseForm({ name: "", code: "", coef: 1 }); toast("Module ajouté"); }}>
          <Input id="cf-name" aria-label="Nom du module" placeholder="Nouveau module" className="min-w-[10rem] flex-1" value={courseForm.name} onChange={(e) => setCourseForm({ ...courseForm, name: e.target.value })} />
          <Input id="cf-code" aria-label="Code" placeholder="Code" className="w-28" value={courseForm.code} onChange={(e) => setCourseForm({ ...courseForm, code: e.target.value })} />
          <Btn type="submit"><Plus size={14} />Module</Btn>
        </form>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Pomodoro

const PHASE_LABEL: Record<Phase, string> = { work: "Focus", short: "Pause courte", long: "Pause longue" };
function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    o.start(); o.stop(ctx.currentTime + 0.8);
  } catch { /* audio indisponible */ }
}
type Ambient = "off" | "brun" | "pluie" | "vagues";
const AMBIENTS: { k: Ambient; label: string }[] = [{ k: "off", label: "Silence" }, { k: "brun", label: "Bruit brun" }, { k: "pluie", label: "Pluie douce" }, { k: "vagues", label: "Vagues" }];
/** Sons d'ambiance générés en direct (aucun fichier audio). */
function useAmbient(): [Ambient, (k: Ambient) => void] {
  const ref = useRef<AudioContext | null>(null);
  const [kind, setKind] = useState<Ambient>("off");
  const play = useCallback((k: Ambient) => {
    ref.current?.close().catch(() => {}); ref.current = null; setKind(k);
    if (k === "off") return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC(); ref.current = ctx;
      const len = ctx.sampleRate * 6, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (k === "pluie") { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.09; }
        else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0.35;
      src.connect(gain); gain.connect(ctx.destination);
      if (k === "vagues") { const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 0.09; depth.gain.value = 0.3; lfo.connect(depth); depth.connect(gain.gain); lfo.start(); }
      src.start();
    } catch { setKind("off"); }
  }, []);
  useEffect(() => () => { ref.current?.close().catch(() => {}); }, []);
  return [kind, play];
}

const Focus: React.FC = () => {
  const { state, dispatch, toast, now } = useStore();
  const cfg = state.settings.pomodoro;
  const t = state.timer;
  const phase = t.phase, running = t.running, cycles = t.cycles;
  const remaining = timerLeft(t, now);
  const [zen, setZen] = useState(false);
  const [ambient, playAmbient] = useAmbient();
  useEffect(() => {
    if (!zen) return;
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    document.documentElement.requestFullscreen?.().catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setZen(false); };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); lock?.release().catch(() => {}); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, [zen]);
  const total = (p: Phase) => phaseSeconds(cfg, p);
  const done = total(phase) - remaining;
  const toggle = () => dispatch({ type: running ? "timer/pause" : "timer/start", now: Date.now() });
  /** Arrêt : en focus, les minutes faites sont enregistrées comme session interrompue ; sinon simple remise à zéro. */
  const stopAndLog = () => {
    if (phase === "work" && done >= 60) { dispatch({ type: "timer/finish", now: Date.now(), date: todayISO(), secondsDone: done }); toast(`${Math.floor(done / 60)} min de focus enregistrées (session interrompue)`, "info"); }
    else dispatch({ type: "timer/reset" });
  };
  /** Passer : termine la phase en cours ; en focus, seules les minutes réellement faites comptent. */
  const skip = () => {
    if (phase === "work" && done < 60) { dispatch({ type: "timer/phase", phase: (cycles + 1) % cfg.longEvery === 0 ? "long" : "short" }); return; }
    dispatch({ type: "timer/finish", now: Date.now(), date: todayISO(), secondsDone: phase === "work" ? done : undefined });
    if (phase === "work") toast(`${Math.floor(done / 60)} min de focus enregistrées`);
  };
  const switchTo = (p: Phase) => {
    if (p === phase) return;
    if (phase === "work" && done >= 60) dispatch({ type: "timer/finish", now: Date.now(), date: todayISO(), secondsDone: done });
    dispatch({ type: "timer/phase", phase: p });
  };
  const progress = Math.min(1, Math.max(0, 1 - remaining / total(phase)));
  const R = 92, C = 2 * Math.PI * R;
  const today = todayISO();
  const fs = useMemo(() => focusStats(state.focus, today), [state.focus, today]);
  const liveMin = fs.today + (phase === "work" ? Math.floor(done / 60) : 0);
  const setCfg = (patch: Partial<PomodoroCfg>) => dispatch({ type: "settings", patch: { pomodoro: { ...cfg, ...patch } } });
  const zenTask = state.tasks.find((x) => x.id === t.taskId);
  const courseOf = (id: ID | null) => state.courses.find((c) => c.id === id);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {zen && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-bg px-6 py-10 animate-fade" role="dialog" aria-label="Mode focus">
          <p className="text-xs font-semibold uppercase tracking-[.25em] text-muted">{PHASE_LABEL[phase]} · cycle {(cycles % cfg.longEvery) + 1}/{cfg.longEvery}</p>
          <p className="font-display text-[clamp(72px,24vw,240px)] font-extrabold leading-none tabular-nums tracking-tighter">{pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}</p>
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full border-2 border-fg bg-panel"><div className="h-full bg-hi transition-all duration-500" style={{ width: `${progress * 100}%` }} /></div>
          <p className="max-w-md text-center font-display text-xl font-bold"><span className="marker">{zenTask?.title ?? "Focus libre"}<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></p>
          <div className="flex items-center gap-3">
            <Btn variant="primary" className="h-14 w-40 text-base" onClick={toggle}>{running ? <><Pause size={20} />Pause</> : <><Play size={20} />Démarrer</>}</Btn>
            <Btn variant="ghost" onClick={skip} aria-label="Phase suivante"><SkipForward size={20} /></Btn>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Volume size={16} className="mt-1.5 text-muted" />
            {AMBIENTS.map((a) => (<button key={a.k} onClick={() => playAmbient(a.k)} className={cx("rounded-full border-2 px-3 py-1 text-xs font-semibold transition", ambient === a.k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line text-muted hover:border-fg/60")}>{a.label}</button>))}
          </div>
          <p className="max-w-sm text-center text-xs text-muted">Activez « Ne pas déranger » sur votre téléphone. L'écran reste allumé tant que le mode focus est ouvert.</p>
          <Btn variant="ghost" onClick={() => { setZen(false); playAmbient("off"); }}><X size={15} />Quitter le mode focus <Kbd>Échap</Kbd></Btn>
        </div>)}
      <Card>
        <div className="flex flex-col items-center gap-5 py-4">
          <div className="flex gap-1 rounded-lg bg-sunken p-1">
            {(["work", "short", "long"] as Phase[]).map((p) => (<button key={p} onClick={() => switchTo(p)} className={cx("rounded-md px-3 py-1.5 text-xs font-medium transition", phase === p ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg")}>{PHASE_LABEL[p]}</button>))}
          </div>
          <div className="relative grid place-items-center">
            <svg width={220} height={220} viewBox="0 0 220 220" className="max-w-full -rotate-90">
              <circle cx={110} cy={110} r={R} fill="none" stroke="rgb(var(--sunken))" strokeWidth={10} />
              <circle cx={110} cy={110} r={R} fill="none" stroke={phase === "work" ? "rgb(var(--accent))" : "rgb(var(--ok))"} strokeWidth={10} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} style={{ transition: "stroke-dashoffset .3s linear" }} />
            </svg>
            <div className="absolute text-center">
              <p className="font-display text-6xl font-extrabold tabular-nums tracking-tighter">{pad(Math.floor(remaining / 60))}:{pad(remaining % 60)}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted">{PHASE_LABEL[phase]} · cycle {(cycles % cfg.longEvery) + 1}/{cfg.longEvery}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" onClick={stopAndLog} aria-label="Réinitialiser"><RotateCcw size={16} /></Btn>
            <Btn variant="primary" data-pomo-toggle className="h-11 w-32 text-sm" onClick={toggle}>{running ? <><Pause size={16} />Pause</> : <><Play size={16} />Démarrer</>}</Btn>
            <Btn variant="ghost" onClick={skip} aria-label="Passer à la phase suivante"><SkipForward size={16} /></Btn>
          </div>
          <Btn onClick={() => setZen(true)}><Maximize size={15} />Mode focus plein écran</Btn>
          <p className="text-xs text-muted"><Kbd>Espace</Kbd> démarrer / pause</p>
          <Field label="Tâche en cours" htmlFor="pomo-task" className="w-full max-w-sm">
            <Select id="pomo-task" value={t.taskId ?? ""} onChange={(e) => dispatch({ type: "timer/task", taskId: e.target.value || null })}>
              <option value="">Sans tâche</option>{state.tasks.filter((x) => x.status !== "done").map((x) => <option key={x.id} value={x.id}>{x.title}{courseOf(x.courseId) ? ` · ${courseOf(x.courseId)!.code || courseOf(x.courseId)!.name}` : ""}</option>)}</Select>
          </Field>
          {!t.taskId && state.courses.length > 0 && (
            <Field label="Matière (focus libre)" htmlFor="pomo-course" className="w-full max-w-sm">
              <Select id="pomo-course" value={t.courseId ?? ""} onChange={(e) => dispatch({ type: "timer/course", courseId: e.target.value || null })}>
                <option value="">Aucune</option>{state.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>)}
          {running && <p className="text-[11px] text-muted">Le minuteur continue si vous changez de page ou actualisez.</p>}
        </div>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3"><Stat label="Focus aujourd'hui" value={fmtDur(liveMin)} sub={`objectif ${fmtDur(state.settings.focusGoal)}`} tone={liveMin >= state.settings.focusGoal ? "ok" : undefined} /><Stat label="Cette semaine" value={fmtDur(fs.week)} sub={`${fs.sessionsToday} session${fs.sessionsToday > 1 ? "s" : ""} aujourd'hui · série ${fs.streak} j`} /></div>
        <Card title="Réglages des sessions">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Focus (min)" htmlFor="pc-w"><Input id="pc-w" type="number" min={5} max={120} value={cfg.work} onChange={(e) => setCfg({ work: Math.max(5, Number(e.target.value)) })} /></Field>
            <Field label="Pause courte" htmlFor="pc-s"><Input id="pc-s" type="number" min={1} max={30} value={cfg.short} onChange={(e) => setCfg({ short: Math.max(1, Number(e.target.value)) })} /></Field>
            <Field label="Pause longue" htmlFor="pc-l"><Input id="pc-l" type="number" min={5} max={60} value={cfg.long} onChange={(e) => setCfg({ long: Math.max(5, Number(e.target.value)) })} /></Field>
            <Field label="Longue tous les" htmlFor="pc-e"><Input id="pc-e" type="number" min={2} max={8} value={cfg.longEvery} onChange={(e) => setCfg({ longEvery: Math.max(2, Number(e.target.value)) })} /></Field>
          </div>
        </Card>
        <Card title="Par matière · 7 jours">
          {fs.week ? <ul className="flex flex-col gap-2.5 text-[13px]">{fs.byCourse.map(({ courseId, minutes }) => { const c = courseOf(courseId); return (
            <li key={courseId ?? "none"}><div className="mb-1 flex gap-2"><span className="h-2 w-2 shrink-0 translate-y-1.5 rounded-full" style={{ background: c?.color ?? "rgb(var(--muted))" }} /><span className="min-w-0 flex-1 truncate">{c?.name ?? "Sans matière"}</span><span className="font-mono text-xs tabular-nums text-muted">{fmtDur(minutes)}</span></div>
              <div className="h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(minutes / fs.week) * 100}%`, background: c?.color ?? "rgb(var(--muted))" }} /></div></li>); })}</ul>
            : <Empty icon={<Timer size={18} />} title="Aucune session cette semaine" hint="Lancez le minuteur : chaque session terminée ou interrompue est enregistrée ici et sur le tableau de bord." />}
        </Card>
        <Card title="Temps par tâche · 7 jours">
          {fs.byTask.length ? <ul className="flex flex-col gap-2 text-[13px]">{fs.byTask.slice(0, 6).map(({ taskId, minutes }) => { const x = state.tasks.find((y) => y.id === taskId); return (
            <li key={taskId} className="flex gap-2"><span className="min-w-0 flex-1 truncate">{x?.title ?? "Tâche supprimée"}</span>{x && <span className="font-mono text-[11px] text-muted">{Math.min(100, Math.round((x.spent / x.estimate) * 100))} %</span>}<span className="font-mono text-xs tabular-nums text-muted">{fmtDur(minutes)}</span></li>); })}</ul>
            : <Empty icon={<Timer size={18} />} title="Pas encore de session liée" hint="Choisissez une tâche avant de lancer le minuteur pour suivre le temps passé dessus." />}
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Courses
const AISLES: Aisle[] = ["Fruits & légumes", "Frais", "Épicerie", "Boissons", "Surgelés", "Hygiène", "Entretien"];
const GUESS: [RegExp, Aisle][] = [
  [/lait|yaourt|fromage|beurre|œuf|oeuf|crème|jambon|poulet|viande|poisson|emmental|tofu/i, "Frais"],
  [/pomme|banane|salade|tomate|carotte|oignon|ail|courgette|épinard|fruit|légume|citron|avocat/i, "Fruits & légumes"],
  [/eau|jus|soda|bière|vin|thé|sirop/i, "Boissons"], [/surgel|glace|frite/i, "Surgelés"],
  [/savon|shampo|dentifrice|déo|gel douche|coton|rasoir|papier toilette/i, "Hygiène"],
  [/lessive|éponge|vaisselle|javel|sac poubelle|sacs poubelle|nettoy|essuie/i, "Entretien"],
];
const guessAisle = (name: string): Aisle => GUESS.find(([re]) => re.test(name))?.[1] ?? "Épicerie";

// Base de produits courante (prix moyens indicatifs en France) : complétée par vos propres achats.
const CATALOG: TemplateItem[] = ([
  ["Lait demi-écrémé", "Frais", "1 L", 1.05], ["Œufs", "Frais", "x12", 3.4], ["Yaourts nature", "Frais", "x8", 2.1], ["Beurre doux", "Frais", "250 g", 2.6],
  ["Emmental râpé", "Frais", "200 g", 2.3], ["Jambon blanc", "Frais", "4 tranches", 2.9], ["Blancs de poulet", "Frais", "500 g", 6.5], ["Crème fraîche", "Frais", "20 cl", 1.3],
  ["Tofu nature", "Frais", "400 g", 2.8], ["Mozzarella", "Frais", "125 g", 1.1], ["Saumon fumé", "Frais", "4 tranches", 4.9], ["Steaks hachés", "Frais", "x2", 3.6],
  ["Bananes", "Fruits & légumes", "1 kg", 1.9], ["Pommes", "Fruits & légumes", "1 kg", 2.4], ["Tomates", "Fruits & légumes", "1 kg", 2.9], ["Carottes", "Fruits & légumes", "1 kg", 1.3],
  ["Oignons", "Fruits & légumes", "1 kg", 1.6], ["Pommes de terre", "Fruits & légumes", "2,5 kg", 3.2], ["Salade", "Fruits & légumes", "x1", 1.1], ["Citrons", "Fruits & légumes", "x4", 1.8],
  ["Avocats", "Fruits & légumes", "x2", 2.2], ["Courgettes", "Fruits & légumes", "1 kg", 2.5], ["Épinards", "Fruits & légumes", "500 g", 2.5], ["Ail", "Fruits & légumes", "x3", 1.2],
  ["Pâtes", "Épicerie", "500 g", 0.95], ["Riz basmati", "Épicerie", "1 kg", 3.2], ["Pain de mie", "Épicerie", "x1", 1.6], ["Baguette", "Épicerie", "x1", 1.1],
  ["Céréales", "Épicerie", "500 g", 2.9], ["Café moulu", "Épicerie", "250 g", 4.5], ["Thé", "Épicerie", "x25", 2.2], ["Sucre", "Épicerie", "1 kg", 1.2],
  ["Farine", "Épicerie", "1 kg", 0.9], ["Huile d'olive", "Épicerie", "50 cl", 5.2], ["Sauce tomate", "Épicerie", "500 g", 1.4], ["Thon en boîte", "Épicerie", "x3", 3.9],
  ["Lentilles", "Épicerie", "500 g", 1.7], ["Pois chiches", "Épicerie", "400 g", 0.9], ["Confiture", "Épicerie", "370 g", 2.3], ["Chocolat", "Épicerie", "200 g", 1.9],
  ["Biscuits", "Épicerie", "x1", 1.8], ["Sel", "Épicerie", "1 kg", 0.6], ["Épices", "Épicerie", "x1", 1.5], ["Avoine", "Épicerie", "500 g", 1.4],
  ["Eau minérale", "Boissons", "6 x 1,5 L", 2.4], ["Jus d'orange", "Boissons", "1 L", 1.9], ["Eau pétillante", "Boissons", "6 x 1 L", 2.9], ["Lait d'avoine", "Boissons", "1 L", 1.8],
  ["Légumes surgelés", "Surgelés", "1 kg", 2.2], ["Pizza surgelée", "Surgelés", "x1", 3.1], ["Frites surgelées", "Surgelés", "1 kg", 2.0], ["Glace", "Surgelés", "500 ml", 3.5],
  ["Dentifrice", "Hygiène", "x1", 2.4], ["Gel douche", "Hygiène", "250 ml", 2.6], ["Shampoing", "Hygiène", "250 ml", 3.1], ["Déodorant", "Hygiène", "x1", 3.0],
  ["Papier toilette", "Hygiène", "x6", 3.4], ["Mouchoirs", "Hygiène", "x1", 1.6], ["Coton", "Hygiène", "x1", 1.5],
  ["Liquide vaisselle", "Entretien", "x1", 1.7], ["Lessive", "Entretien", "1,5 L", 6.9], ["Éponges", "Entretien", "x3", 1.5], ["Sacs poubelle 30 L", "Entretien", "x20", 2.2],
  ["Essuie-tout", "Entretien", "x2", 2.3], ["Nettoyant multi-usage", "Entretien", "750 ml", 2.5], ["Javel", "Entretien", "1 L", 1.4],
] as [string, Aisle, string, number][]).map(([name, aisle, qty, price]) => ({ name, aisle, qty, price }));

const pick = (...names: string[]) => names.map((n) => CATALOG.find((c) => c.name === n)!).filter(Boolean);
const BUILTIN_TEMPLATES: GroceryTemplate[] = [
  { id: "tpl-week", name: "Essentiels de la semaine", items: pick("Lait demi-écrémé", "Œufs", "Pâtes", "Riz basmati", "Bananes", "Tomates", "Oignons", "Pain de mie", "Yaourts nature", "Légumes surgelés") },
  { id: "tpl-breakfast", name: "Petit-déjeuner", items: pick("Céréales", "Lait demi-écrémé", "Café moulu", "Confiture", "Beurre doux", "Jus d'orange", "Avoine") },
  { id: "tpl-clean", name: "Produits ménagers", items: pick("Liquide vaisselle", "Lessive", "Éponges", "Sacs poubelle 30 L", "Essuie-tout", "Nettoyant multi-usage") },
  { id: "tpl-hygiene", name: "Salle de bain", items: pick("Dentifrice", "Gel douche", "Shampoing", "Papier toilette", "Déodorant") },
  { id: "tpl-pasta", name: "Soirée pâtes", items: pick("Pâtes", "Sauce tomate", "Emmental râpé", "Oignons", "Ail") },
  { id: "tpl-budget", name: "Petit budget (< 20 €)", items: pick("Lentilles", "Pois chiches", "Riz basmati", "Carottes", "Oignons", "Œufs", "Thon en boîte", "Bananes") },
];

const Groceries: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const [name, setName] = useState(""); const [qty, setQty] = useState(""); const [aisle, setAisle] = useState<Aisle | "auto">("auto");
  const [quick, setQuick] = useState(false); const [bulk, setBulk] = useState(""); const [hideChecked, setHideChecked] = useState(false);
  const [price, setPrice] = useState(""); const [paid, setPaid] = useState("");
  const [tplName, setTplName] = useState(""); const [dbQuery, setDbQuery] = useState("");
  // Base produits = vos produits appris (prioritaires) + catalogue courant.
  const db = useMemo(() => {
    const mine = state.products.map((x) => ({ name: x.name, aisle: x.aisle, qty: "", price: x.price, mine: true, count: x.count }));
    const keys = new Set(mine.map((x) => norm(x.name)));
    return [...mine, ...CATALOG.filter((c) => !keys.has(norm(c.name))).map((c) => ({ ...c, mine: false, count: 0 }))];
  }, [state.products]);
  const findProduct = (n: string) => db.find((x) => norm(x.name) === norm(n));
  const onName = (v: string) => {
    setName(v); const hit = findProduct(v);
    if (hit) { if (!price) setPrice(hit.price ? String(hit.price).replace(".", ",") : ""); if (!qty && hit.qty) setQty(hit.qty); setAisle(hit.aisle); }
  };
  const applyTemplate = (t: GroceryTemplate) => {
    const have = new Set(state.groceries.map((g) => norm(g.name)));
    const items = t.items.filter((i) => !have.has(norm(i.name))).map((i) => ({ id: uid(), name: i.name, aisle: i.aisle, qty: i.qty, checked: false, price: findProduct(i.name)?.price ?? i.price }));
    if (!items.length) { toast("Tout est déjà dans votre liste.", "info"); return; }
    dispatch({ type: "grocery/addMany", items }); toast(`${items.length} articles ajoutés depuis « ${t.name} »`);
  };
  const saveTemplate = () => {
    if (!tplName.trim() || !state.groceries.length) { toast("Donnez un nom, avec au moins un article dans la liste.", "bad"); return; }
    dispatch({ type: "template/save", template: { id: uid(), name: tplName.trim(), items: state.groceries.map((g) => ({ name: g.name, aisle: g.aisle, qty: g.qty, price: g.price })) } });
    toast(`Liste « ${tplName.trim()} » enregistrée`); setTplName("");
  };
  const inList = new Set(state.groceries.map((g) => norm(g.name)));
  const frequent = state.products.filter((x) => x.count > 0 && !inList.has(norm(x.name))).sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, 10);
  const dbList = db.filter((x) => !dbQuery || norm(x.name).includes(norm(dbQuery))).slice(0, dbQuery ? 30 : 8);
  const cur = state.settings.currency;
  const left = state.groceries.filter((g) => !g.checked).length;
  const estTotal = state.groceries.reduce((n, g) => n + g.price, 0);
  const cartTotal = state.groceries.filter((g) => g.checked).reduce((n, g) => n + g.price, 0);
  const mk = monthKey(todayISO());
  const monthExp = state.budget.expenses.filter((e) => monthKey(e.date) === mk);
  const groceryLimit = state.budget.limits.Courses;
  const grocerySpent = monthExp.filter((e) => e.category === "Courses").reduce((n, e) => n + e.amount, 0);
  const remainingAll = state.budget.monthly - monthExp.reduce((n, e) => n + e.amount, 0);
  const [ticketFp, setTicketFp] = useState("");
  const home = pantryItems(state, todayISO()).map((x) => {
    const a = state.products.find((p) => norm(p.name) === norm(x.name))?.aisle ?? guessAisle(x.name);
    return { ...x, place: a === "Frais" || a === "Surgelés" || a === "Fruits & légumes" ? "Frigo et congélateur" as const : a === "Hygiène" || a === "Entretien" ? "Salle de bain et entretien" as const : "Placards" as const };
  });
  const knownTickets = state.budget.expenses.flatMap((e) => (e.ticket ? [e.ticket] : []));
  /** Ticket relu et confirmé : coche/ajoute les articles (sans doublon), pré-remplit le montant payé. Rien n'est enregistré avant « Valider les achats ». */
  const onTicket = (c: ReceiptConfirm) => {
    const lines = c.items.filter((i) => i.kind === "item" && i.name && i.price >= 0).map((i) => ({ name: i.name, price: i.price, qty: i.qty, aisle: guessAisle(i.name) }));
    if (lines.length) dispatch({ type: "grocery/fromReceipt", lines });
    if (c.amount) setPaid(c.amount.toFixed(2).replace(".", ","));
    setTicketFp(c.allowDuplicate ? "" : c.fingerprint);
    toast(lines.length ? `Ticket lu : ${lines.length} ligne(s) cochée(s) ou ajoutée(s). Vérifiez le montant puis validez les achats.` : "Montant du ticket repris. La liste n'a pas été modifiée.", "ok");
  };
  const checkout = () => {
    const amount = paid.trim() ? parseAmount(paid) : cartTotal;
    if (!(amount > 0)) { toast("Indiquez le montant payé (ou des prix sur les articles cochés).", "bad"); return; }
    if (ticketFp && knownTickets.includes(ticketFp)) { toast("Ce ticket est déjà enregistré dans le budget.", "bad"); return; }
    dispatch({ type: "grocery/checkout", amount, date: todayISO(), ...(ticketFp ? { ticket: ticketFp } : {}) }); setPaid(""); setTicketFp("");
    toast(`Dépense de ${money(amount, cur)} ajoutée au budget Courses`);
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault(); if (!name.trim()) return;
    const a = aisle === "auto" ? guessAisle(name) : aisle;
    const pr = price.trim() ? parseAmount(price) : 0;
    dispatch({ type: "grocery/add", item: { id: uid(), name: name.trim(), qty: qty.trim(), aisle: a, checked: false, price: isNaN(pr) ? 0 : pr } });
    toast(`Ajouté au rayon ${a}`); setName(""); setQty(""); setPrice("");
  };
  const addBulk = () => {
    const lines = bulk.split(/[\n,;]/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((l) => { const m = l.match(/^(.*?)(?:\s+(x?\d+.*))?$/); dispatch({ type: "grocery/add", item: { id: uid(), name: m?.[1] ?? l, qty: m?.[2] ?? "", aisle: findProduct(m?.[1] ?? l)?.aisle ?? guessAisle(l), checked: false, price: findProduct(m?.[1] ?? l)?.price ?? 0 } }); });
    if (lines.length) toast(`${lines.length} articles ajoutés et triés par rayon`); setBulk("");
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title={<span className="flex items-center gap-2"><ShoppingCart size={15} />Liste de courses <Pill tone={left ? "info" : "ok"}>{left} restants</Pill></span>}
        action={<><Btn size="sm" variant={quick ? "primary" : "soft"} onClick={() => setQuick(!quick)}><Zap size={12} />Mode rapide</Btn><Btn size="sm" variant="ghost" onClick={() => setHideChecked(!hideChecked)}>{hideChecked ? "Afficher" : "Masquer"} cochés</Btn></>}>
        {!state.groceries.length ? <Empty icon={<ShoppingCart size={18} />} title="Liste vide" hint="Ajoutez un article à droite ; le rayon est deviné automatiquement." /> : (
          <div className={cx("grid gap-4", !quick && "sm:grid-cols-2")}>
            {AISLES.map((a) => { const items = state.groceries.filter((g) => g.aisle === a && !(hideChecked && g.checked)); if (!items.length) return null; return (
              <div key={a} className="min-w-0">
                <p className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted"><span>{a}</span><span className="font-mono">{items.filter((i) => !i.checked).length}/{items.length}</span></p>
                <ul className="flex flex-col">
                  {items.map((g) => (
                    <li key={g.id} className={cx("group flex items-center gap-3 rounded-lg px-2 transition-all duration-300 hover:translate-x-0.5 hover:bg-sunken", quick ? "py-3 text-base" : "py-1.5 text-[13px]")}>
                      <button onClick={() => dispatch({ type: "grocery/toggle", id: g.id })} aria-label={g.checked ? "Décocher" : "Cocher"} className={cx("grid shrink-0 place-items-center rounded border transition", quick ? "h-6 w-6" : "h-4 w-4", g.checked ? "scale-110 border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40 hover:border-accent")}>{g.checked && <Check className="tick" size={quick ? 14 : 11} strokeWidth={3} />}</button>
                      <span className={cx("min-w-0 flex-1 truncate", g.checked && "text-muted line-through")}>{g.name}</span>
                      {g.qty && <span className="font-mono text-xs text-muted">{g.qty}</span>}
                      {quick ? (g.price > 0 && <span className="font-mono text-xs tabular-nums text-muted">{money(g.price, cur)}</span>) : (
                        <input id={`gp-${g.id}`} aria-label={`Prix ${g.name}`} inputMode="decimal" defaultValue={g.price ? String(g.price).replace(".", ",") : ""} placeholder="prix"
                          onBlur={(e) => { const v = e.target.value.trim() ? parseAmount(e.target.value) : 0; if (!isNaN(v) && v !== g.price) dispatch({ type: "grocery/update", id: g.id, patch: { price: v } }); }}
                          className="w-14 rounded-md border border-transparent bg-transparent px-1 text-right font-mono text-xs tabular-nums text-muted outline-none hover:border-line focus:border-accent focus:text-fg" />)}
                      {!quick && <button className="text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer" onClick={() => undoable({ type: "grocery/remove", id: g.id }, `${g.name} retiré de la liste`)}><Trash2 size={12} /></button>}
                    </li>))}
                </ul>
              </div>); })}
          </div>)}
        {state.groceries.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <div className="mr-auto"><p className="text-[11px] uppercase tracking-wider text-muted">Panier coché · liste estimée</p>
              <p className="font-mono text-lg font-semibold tabular-nums">{money(cartTotal, cur)} <span className="text-sm font-normal text-muted">/ {money(estTotal, cur)}</span></p></div>
            {state.groceries.some((g) => g.checked) && <>
              <Field label="Montant payé" htmlFor="gr-paid"><Input id="gr-paid" inputMode="decimal" className="w-28" placeholder={cartTotal ? cartTotal.toFixed(2).replace(".", ",") : "0,00"} value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
              <ReceiptScanner label="Scanner le ticket" withItems known={knownTickets} onConfirm={onTicket} />
              <Btn variant="primary" onClick={checkout}><Receipt size={14} />Valider les achats</Btn>
              <Btn variant="ghost" onClick={() => undoable({ type: "grocery/clearChecked" }, "Articles cochés retirés sans dépense")}><Trash2 size={13} />Retirer sans dépense</Btn></>}
          </div>)}
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <Card title={<span className="flex items-center gap-2"><Wallet size={15} />Budget courses du mois</span>}>
          {groceryLimit ? (<>
            <div className="flex items-baseline justify-between"><span className="font-mono text-xl font-semibold tabular-nums">{money(grocerySpent, cur)}</span><span className="text-xs text-muted">sur {money(groceryLimit, cur)}</span></div>
            <div className="mt-2 h-2 rounded-full bg-sunken"><div className={cx("h-full rounded-full transition-all", grocerySpent > groceryLimit ? "bg-bad" : grocerySpent + estTotal > groceryLimit ? "bg-warn" : "bg-ok")} style={{ width: `${Math.min(100, (grocerySpent / groceryLimit) * 100)}%` }} /></div>
            <p className="mt-2 text-xs text-muted">{grocerySpent + estTotal > groceryLimit ? `Attention : cette liste (${money(estTotal, cur)}) dépasserait le budget de ${money(grocerySpent + estTotal - groceryLimit, cur)}.` : `Après cette liste, il resterait ${money(groceryLimit - grocerySpent - estTotal, cur)}.`}</p>
          </>) : <p className="text-xs text-muted">Pas de plafond « Courses » défini. Reste global du mois : <b className="font-mono text-fg">{money(remainingAll, cur)}</b>. Fixez un plafond dans l'onglet Budget.</p>}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Home size={15} />À la maison</span>}>
          {home.length ? (<>
            <p className="mb-2 text-[11px] text-muted">Estimation d'après vos achats des 3 dernières semaines. Touchez « Fini » quand quelque chose est consommé.</p>
            {(["Frigo et congélateur", "Placards", "Salle de bain et entretien"] as const).map((place) => { const xs = home.filter((x) => x.place === place); if (!xs.length) return null; return (
              <div key={place} className="mb-2"><p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{place}</p>
                <ul className="flex flex-col">{xs.map((x) => (
                  <li key={x.key} className="flex items-center gap-2 py-0.5 text-[13px]"><span className="min-w-0 flex-1 truncate">{x.name}</span><span className="font-mono text-[10px] text-muted">{fmtDate(x.date)}</span>
                    <button className="rounded-full border-2 border-line px-2 text-[11px] font-semibold hover:border-fg/60" onClick={() => dispatch({ type: "pantry/use", key: x.key })}>Fini</button></li>))}</ul></div>); })}
          </>) : <p className="text-xs text-muted">Rien à afficher : validez des achats (ou scannez un ticket) et ils apparaîtront ici.</p>}
        </Card>
        {frequent.length > 0 && (
          <Card title="Articles fréquents">
            <div className="flex flex-wrap gap-1.5">{frequent.map((x) => (
              <button key={x.name} onClick={() => { dispatch({ type: "grocery/add", item: { id: uid(), name: x.name, aisle: x.aisle, qty: "", checked: false, price: x.price } }); toast(`${x.name} ajouté`); }}
                className="rounded-full border-2 border-line px-2.5 py-1 text-xs font-semibold transition hover:-translate-y-0.5 hover:border-fg/60">{x.name}{x.price ? <span className="ml-1 font-mono text-muted">{money(x.price, cur)}</span> : null}</button>))}</div>
            <p className="mt-2 text-[11px] text-muted">D'après vos achats validés (prix = dernier prix payé).</p>
          </Card>)}
        <Card title="Ajouter un article">
          <form onSubmit={add} className="flex flex-col gap-2">
            <Input id="gr-name" aria-label="Article" list="gr-products" autoComplete="off" placeholder="Ex. Lait demi-écrémé" value={name} onChange={(e) => onName(e.target.value)} />
            <datalist id="gr-products">{db.map((x) => <option key={x.name} value={x.name}>{x.price ? money(x.price, cur) : ""}</option>)}</datalist>
            <div className="grid grid-cols-2 gap-2"><Input id="gr-qty" aria-label="Quantité" placeholder="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Input id="gr-price" aria-label="Prix estimé" inputMode="decimal" placeholder={`Prix estimé (${cur})`} value={price} onChange={(e) => setPrice(e.target.value)} />
              <Select id="gr-aisle" aria-label="Rayon" className="col-span-2" value={aisle} onChange={(e) => setAisle(e.target.value as Aisle | "auto")}><option value="auto">Rayon auto{name ? ` (${guessAisle(name)})` : ""}</option>{AISLES.map((a) => <option key={a} value={a}>{a}</option>)}</Select></div>
            <Btn type="submit" variant="primary"><Plus size={14} />Ajouter</Btn>
          </form>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Bookmark size={15} />Listes prêtes</span>}>
          <div className="flex flex-wrap gap-1.5">
            {[...BUILTIN_TEMPLATES, ...state.templates].map((t) => (
              <span key={t.id} className="group inline-flex items-center rounded-full border-2 border-fg/70 bg-panel text-xs font-semibold transition hover:-translate-y-0.5 hover:bg-hi/40">
                <button className="py-1 pl-3 pr-2" onClick={() => applyTemplate(t)} title={t.items.map((i) => i.name).join(", ")}>{t.name} <span className="font-mono text-muted">· {t.items.length}</span></button>
                {state.templates.some((x) => x.id === t.id) && <button aria-label={`Supprimer ${t.name}`} className="pr-2 text-muted hover:text-bad" onClick={() => undoable({ type: "template/remove", id: t.id }, `Liste « ${t.name} » supprimée`)}><X size={11} /></button>}
              </span>))}
          </div>
          <div className="mt-3 flex gap-2">
            <Input id="tpl-name" aria-label="Nom de la liste" placeholder="Enregistrer la liste actuelle sous…" value={tplName} onChange={(e) => setTplName(e.target.value)} />
            <Btn onClick={saveTemplate} disabled={!state.groceries.length} aria-label="Enregistrer la liste"><Plus size={14} /></Btn>
          </div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Database size={15} />Base de produits</span>} action={<span className="font-mono text-[11px] text-muted">{db.length}</span>}>
          <Input id="db-q" aria-label="Chercher un produit" placeholder="Chercher un produit…" value={dbQuery} onChange={(e) => setDbQuery(e.target.value)} />
          <ul className="mt-2 flex max-h-72 flex-col divide-y divide-line overflow-y-auto text-[13px]">
            {dbList.map((x) => (
              <li key={x.name} className="group flex items-center gap-2 py-1.5">
                <button className="min-w-0 flex-1 truncate text-left hover:text-accent" title="Ajouter à la liste"
                  onClick={() => { dispatch({ type: "grocery/add", item: { id: uid(), name: x.name, aisle: x.aisle, qty: x.qty, checked: false, price: x.price } }); toast(`${x.name} ajouté`); }}>
                  {x.mine && <span className="mr-1 text-accent" title="Appris de vos achats">●</span>}{x.name}</button>
                <input aria-label={`Prix ${x.name}`} inputMode="decimal" defaultValue={x.price ? String(x.price).replace(".", ",") : ""} key={x.name + x.price}
                  onBlur={(e) => { const v = parseAmount(e.target.value); if (v > 0 && v !== x.price) { dispatch({ type: "product/upsert", product: { name: x.name, aisle: x.aisle, price: v } }); toast("Prix enregistré"); } }}
                  className="w-16 rounded-md border border-transparent bg-transparent px-1 text-right font-mono text-xs tabular-nums text-muted outline-none hover:border-line focus:border-accent focus:text-fg" />
                {x.mine && <button aria-label="Oublier ce produit" className="text-muted opacity-0 hover:text-bad group-hover:opacity-100" onClick={() => undoable({ type: "product/remove", name: x.name }, `${x.name} oublié`)}><X size={11} /></button>}
              </li>))}
            {!dbList.length && <li className="py-3 text-xs text-muted">Aucun produit. Ajoutez-le à la liste avec un prix : il sera mémorisé.</li>}
          </ul>
          <p className="mt-2 text-[11px] text-muted">● produits appris de vos achats (dernier prix payé). Touchez un nom pour l'ajouter à la liste.</p>
        </Card>
        <Card title="Saisie en vrac">
          <textarea id="gr-bulk" aria-label="Articles en vrac" value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={"tomates 6\nliquide vaisselle\nthé vert, riz"} className={cx(inputCls, "h-auto py-2")} />
          <Btn className="mt-2 w-full" onClick={addBulk} disabled={!bulk.trim()}>Trier et ajouter</Btn>
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Budget & dépenses
const CATS: ExpenseCat[] = ["Courses", "Restauration", "Logement", "Transport", "Études", "Loisirs", "Santé", "Autre"];
const BASE_COLOR: Record<string, string> = {
  Courses: "#10a37f", Restauration: "#e0802a", Logement: "#5b6b8c", Transport: "#2b8bd6", Études: "#6d5bd0", Loisirs: "#d6457a", Santé: "#1aa3a3", Autre: "#8a8f98",
};
const EXTRA_COLORS = ["#c2417a", "#b5651d", "#3d8b37", "#7a5af5", "#d4a017", "#1d9bb5", "#a0522d", "#e05d5d"];
/** Couleur d'une catégorie (intégrée, ou stable pour une catégorie perso). */
const CAT_COLOR = new Proxy(BASE_COLOR, { get: (t, k: string) => t[k] ?? EXTRA_COLORS[[...k].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7) % EXTRA_COLORS.length] }) as Record<string, string>;
/** Catégories proposées : intégrées + perso (+ celles encore utilisées par des dépenses), « Autre » en dernier. */
const catsOf = (s: AppState): ExpenseCat[] => {
  const used = [...s.budget.expenses.map((e) => e.category), ...s.budget.recurring.map((r) => r.category)];
  const extra = [...new Set([...(s.settings.customCats ?? []), ...used])].filter((c) => !CATS.includes(c));
  return [...CATS.filter((c) => c !== "Autre"), ...extra, "Autre"];
};
/** Liste de catégories avec « + Nouvelle catégorie… » (ajoutée aux réglages et sélectionnée). */
const CatSelect: React.FC<Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & { value: string; onPick: (c: ExpenseCat) => void }> = ({ value, onPick, ...rest }) => {
  const { state, dispatch, toast } = useStore();
  return (
    <Select {...rest} value={value} onChange={(e) => {
      if (e.target.value !== "__new") { onPick(e.target.value); return; }
      const name = window.prompt("Nom de la nouvelle catégorie (ex. Abonnements, Sport, Cadeaux)")?.trim().slice(0, 24);
      if (!name) return;
      const existing = catsOf(state).find((c) => norm(c) === norm(name));
      if (!existing) { dispatch({ type: "settings", patch: { customCats: [...(state.settings.customCats ?? []), name] } }); toast(`Catégorie « ${name} » ajoutée`); }
      onPick(existing ?? name);
    }}>
      {catsOf(state).map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="__new">+ Nouvelle catégorie…</option>
    </Select>
  );
};
const BudgetView: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const cur = state.settings.currency;
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const mk = `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}`;
  const isCurrent = offset === 0;
  const today = todayISO();
  const exp = state.budget.expenses.filter((e) => monthKey(e.date) === mk).sort((a, b) => b.date.localeCompare(a.date));
  // Tous les chiffres viennent de budgetStats (mêmes calculs que le tableau de bord), recalculés à chaque modification.
  const bs = budgetStats(state.budget, mk, today, catsOf(state));
  const { spent, remaining, dim, elapsed, projection, perDayLeft, daily } = bs;
  const byCat = bs.byCat.filter((x) => x.spent > 0 || x.limit).map((x) => ({ c: x.cat, v: x.spent, lim: x.limit }));
  const [f, setF] = useState({ label: "", amount: "", category: "Courses" as ExpenseCat, date: today, source: "manuel" as Expense["source"], items: [] as string[], ticket: "" });
  const [editLimits, setEditLimits] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [rec, setRec] = useState({ label: "", amount: "", category: "Logement" as ExpenseCat, day: "1" });
  const lastAdd = useRef<{ key: string; at: number } | null>(null);
  const add = (e: React.FormEvent) => {
    e.preventDefault(); const amount = parseAmount(f.amount);
    if (!(amount > 0) || amount > 100000) { toast("Saisissez un montant positif, par exemple 12,50.", "bad"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast("Choisissez une date valide.", "bad"); return; }
    // Anti double envoi : même dépense saisie deux fois en moins de 3 s.
    const key = `${f.date}|${amount}|${f.category}|${f.label.trim()}`;
    if (lastAdd.current && lastAdd.current.key === key && Date.now() - lastAdd.current.at < 3000) return;
    if (f.ticket && state.budget.expenses.some((x) => x.ticket === f.ticket)) { toast("Ce ticket est déjà enregistré dans le budget.", "bad"); return; }
    lastAdd.current = { key, at: Date.now() };
    dispatch({ type: "expense/add", expense: { id: uid(), date: f.date, amount, category: f.category, label: f.label.trim() || f.category, source: f.source, ...(f.items.length ? { items: f.items } : {}), ...(f.ticket ? { ticket: f.ticket } : {}) } });
    const lim = state.budget.limits[f.category];
    const catSpent = bs.byCat.find((x) => x.cat === f.category)?.spent ?? 0;
    if (monthKey(f.date) === mk && lim && catSpent <= lim && catSpent + amount > lim) toast(`${money(amount, cur)} ajoutés · plafond ${f.category} dépassé (${money(catSpent + amount, cur)} / ${money(lim, cur)})`, "bad");
    else toast(`${money(amount, cur)} ajoutés en ${f.category}`);
    setF({ ...f, label: "", amount: "", source: "manuel", items: [], ticket: "" });
  };
  const rebuy = (e: Expense) => {
    const have = new Set(state.groceries.map((g) => norm(g.name)));
    const items = (e.items ?? []).filter((n) => !have.has(norm(n))).map((n) => { const p = state.products.find((x) => norm(x.name) === norm(n)); return { id: uid(), name: n, aisle: p?.aisle ?? guessAisle(n), qty: "", checked: false, price: p?.price ?? 0 }; });
    if (!items.length) { toast("Ces articles sont déjà dans votre liste.", "info"); return; }
    dispatch({ type: "grocery/addMany", items }); toast(`${items.length} articles remis dans la liste de courses`);
  };
  const tone = remaining < 0 || bs.overCats.length ? "bad" : projection !== null && projection > state.budget.monthly ? "warn" : "ok";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Mois précédent"><ChevronLeft size={14} /></Btn>
        <span className="min-w-[140px] text-center text-sm font-semibold capitalize">{ref.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span>
        <Btn size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Mois suivant"><ChevronRight size={14} /></Btn>
        {!isCurrent && <Btn size="sm" onClick={() => setOffset(0)}>Ce mois</Btn>}
        <div className="ml-auto flex items-center gap-2"><label htmlFor="bd-monthly" className="text-xs text-muted">Budget mensuel</label>
          <Input id="bd-monthly" inputMode="decimal" className="w-28" defaultValue={String(state.budget.monthly)} key={state.budget.monthly}
            onBlur={(e) => { const v = parseAmount(e.target.value); if (v > 0 && v !== state.budget.monthly) { dispatch({ type: "budget/set", patch: { monthly: v } }); toast("Budget mensuel mis à jour"); } }} /><span className="text-xs text-muted">{cur}</span></div>
      </div>
      {remaining < 0 && <div className="flex items-center gap-2 rounded-2xl border border-bad/30 bg-bad/8 px-4 py-3 text-sm text-bad"><AlertTriangle size={16} />Budget dépassé de {money(-remaining, cur)} {isCurrent ? "ce mois-ci" : "ce mois-là"}.</div>}
      {bs.overCats.length > 0 && <div className="flex items-center gap-2 rounded-2xl border border-bad/30 bg-bad/8 px-4 py-3 text-sm text-bad"><AlertTriangle size={16} />Plafond dépassé : {bs.byCat.filter((x) => x.over).map((x) => `${x.cat} (${money(x.spent, cur)} / ${money(x.limit!, cur)})`).join(", ")}.</div>}
      {isCurrent && remaining >= 0 && projection !== null && projection > state.budget.monthly && <div className="flex items-center gap-2 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"><AlertTriangle size={16} />Au rythme actuel, le budget serait dépassé d'environ {money(projection - state.budget.monthly, cur)} en fin de mois.</div>}
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4">
        <Stat label="Dépensé" value={money(spent, cur)} sub={`${Math.round((spent / Math.max(1, state.budget.monthly)) * 100)} % du budget`} />
        <Stat label="Restant" value={money(remaining, cur)} sub={bs.income || bs.saved ? `budget ${money(state.budget.monthly, cur)}${bs.income ? ` + reçu ${money(bs.income, cur)}` : ""}${bs.saved ? ` − épargné ${money(bs.saved, cur)}` : ""}` : perDayLeft !== null ? `${money(Math.max(0, perDayLeft), cur)} / jour d'ici la fin du mois${bs.recurringPlanned > bs.recurringPaid ? " (récurrentes à venir déduites)" : ""}` : undefined} tone={remaining < 0 ? "bad" : "ok"} />
        <Stat label={elapsed && elapsed < dim ? "Projection fin de mois" : "Total du mois"} value={projection === null ? "—" : money(projection, cur)} sub={projection === null ? "mois à venir" : elapsed < dim ? `récurrentes ${money(bs.recurringPlanned, cur)} + variables au rythme actuel` : "mois terminé"} tone={tone === "ok" ? undefined : tone} />
        <Stat label="Dépenses" value={String(exp.length)} sub={exp.length ? `moyenne ${money(spent / exp.length, cur)}` : "aucune ce mois"} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Dépenses par jour" action={<Pill tone="info">{elapsed ? `${money(bs.variable / elapsed, cur)} / jour hors récurrentes` : "—"}</Pill>}>
            <BarChart data={daily.map((v, i) => ({ label: (i + 1) % 5 === 0 || i === 0 ? String(i + 1) : "", value: v, tone: v > state.budget.monthly / dim * 2 ? "warn" : "accent" }))} goal={state.budget.monthly / dim} unit={(v) => `${Math.round(v)}`} />
            <p className="mt-1 text-xs text-muted">Ligne pointillée : budget journalier moyen ({money(state.budget.monthly / dim, cur)}).</p>
          </Card>
          <Card title="Historique" action={<span className="font-mono text-xs text-muted">{exp.length} lignes</span>}>
            {exp.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {exp.map((e) => (
                  <li key={e.id} className="group flex items-center gap-3 py-2 text-[13px]">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[11px] font-semibold text-white" style={{ background: CAT_COLOR[e.category] }}>{e.category.slice(0, 2)}</span>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{e.label}</p><p className="text-[11px] text-muted">{fmtDate(e.date)} · {e.category}{e.source === "courses" ? ` · liste de courses${e.items?.length ? ` (${e.items.length})` : ""}` : e.source === "recurrente" ? " · récurrente" : e.source === "ticket" ? " · ticket scanné" : ""}</p></div>
                    <span className="font-mono tabular-nums">−{money(e.amount, cur)}</span>
                    {e.items?.length ? <button className="text-muted opacity-60 hover:text-accent group-hover:opacity-100" aria-label="Remettre ces articles dans la liste de courses" title="Racheter ces articles" onClick={() => rebuy(e)}><Repeat size={13} /></button> : null}
                    <button className="text-muted opacity-60 hover:text-accent group-hover:opacity-100" aria-label="Modifier la dépense" onClick={() => setEditing(e)}><Pencil size={13} /></button>
                    <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label="Supprimer la dépense" onClick={() => undoable({ type: "expense/remove", id: e.id }, `Dépense « ${e.label} » supprimée`)}><Trash2 size={13} /></button>
                  </li>))}
              </ul>) : <Empty icon={<Receipt size={18} />} title="Aucune dépense ce mois-ci" hint="Ajoutez une dépense à droite, ou validez vos achats depuis la liste de courses." />}
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <MoneyIn mk={mk} cur={cur} />
          <Card title="Nouvelle dépense">
            <ReceiptScanner className="mb-3" withDate known={state.budget.expenses.flatMap((e) => (e.ticket ? [e.ticket] : []))}
              onConfirm={(c) => setF({ ...f, amount: c.amount ? c.amount.toFixed(2).replace(".", ",") : f.amount, date: c.date && c.date <= today ? c.date : f.date, label: c.store || "Ticket de caisse", category: "Courses", source: "ticket",
                items: c.items.filter((i) => i.kind === "item" && i.name).map((i) => i.name), ticket: c.allowDuplicate ? "" : c.fingerprint })} />
            <form onSubmit={add} className="grid grid-cols-2 gap-2">
              <Input id="bd-label" aria-label="Libellé" placeholder="Libellé (ex. Pharmacie)" className="col-span-2" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
              <Input id="bd-amount" aria-label="Montant" inputMode="decimal" placeholder={`Montant (${cur})`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <CatSelect id="bd-cat" aria-label="Catégorie" value={f.category} onPick={(c) => setF({ ...f, category: c })} />
              <Input id="bd-date" aria-label="Date" type="date" className="col-span-2" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              <Btn type="submit" variant="primary" className="col-span-2"><Plus size={14} />Ajouter la dépense</Btn>
            </form>
            {(state.settings.customCats ?? []).length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"><span className="text-muted">Mes catégories :</span>
              {(state.settings.customCats ?? []).map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line bg-sunken py-0.5 pl-2 pr-1"><span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />{c}
                <button aria-label={`Retirer la catégorie ${c}`} title="Retirer (les dépenses existantes gardent cette catégorie)" className="rounded-full px-1 text-muted hover:text-bad" onClick={() => undoable({ type: "settings", patch: { customCats: (state.settings.customCats ?? []).filter((x) => x !== c) } }, `Catégorie « ${c} » retirée de la liste`)}>×</button></span>)}</div>}
            <p className="mb-1.5 mt-3 text-[11px] uppercase tracking-wider text-muted">Ajout rapide</p>
            <div className="flex flex-wrap gap-1.5">{state.settings.quickExpenses.map((q) => (
              <button key={q.label} onClick={() => { const id = uid(); dispatch({ type: "expense/add", expense: { id, date: todayISO(), amount: q.amount, category: q.category, label: q.label, source: "manuel" } }); toast(`${q.label} : ${money(q.amount, cur)}`, "ok", { label: "Annuler", run: () => dispatch({ type: "expense/remove", id }) }); }}
                className="rounded-full border border-line px-2.5 py-1 text-xs transition hover:border-accent hover:text-accent">{q.label} · {money(q.amount, cur)}</button>))}</div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Repeat size={15} />Dépenses récurrentes</span>}>
            {state.budget.recurring.length ? <ul className="mb-3 flex flex-col gap-1.5 text-[13px]">{state.budget.recurring.map((r) => (
              <li key={r.id} className="group flex items-center gap-2">
                <input type="checkbox" aria-label={`Activer ${r.label}`} checked={r.active} onChange={(e) => dispatch({ type: "recurring/save", item: { ...r, active: e.target.checked } })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
                <span className={cx("min-w-0 flex-1 truncate", !r.active && "text-muted line-through")}>{r.label}</span><span className="text-[11px] text-muted">le {r.day}</span>
                <span className="font-mono text-xs tabular-nums">{money(r.amount, cur)}</span>
                <button aria-label={`Supprimer ${r.label}`} className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" onClick={() => undoable({ type: "recurring/remove", id: r.id }, `« ${r.label} » ne sera plus ajoutée`)}><X size={12} /></button>
              </li>))}</ul> : <p className="mb-3 text-xs text-muted">Loyer, abonnement, forfait… ajoutés automatiquement chaque mois au jour choisi, une seule fois.</p>}
            <form className="grid grid-cols-[1fr_80px] gap-1.5" onSubmit={(e) => { e.preventDefault(); const amount = parseAmount(rec.amount), day = Math.round(Number(rec.day));
              if (!rec.label.trim() || !(amount > 0)) { toast("Libellé et montant requis.", "bad"); return; }
              if (!(day >= 1 && day <= 31)) { toast("Jour du mois entre 1 et 31.", "bad"); return; }
              dispatch({ type: "recurring/save", item: { id: uid(), label: rec.label.trim(), amount, category: rec.category, day, active: true, since: todayISO() } });
              dispatch({ type: "recurring/sync", today: todayISO() });
              toast(day <= Number(todayISO().slice(8)) ? `« ${rec.label.trim()} » ajoutée pour ce mois puis chaque mois` : `« ${rec.label.trim()} » sera ajoutée le ${day} de chaque mois`); setRec({ ...rec, label: "", amount: "" }); }}>
              <Input id="rc-label" aria-label="Libellé" placeholder="Ex. Loyer" className="h-8 text-xs" value={rec.label} onChange={(e) => setRec({ ...rec, label: e.target.value })} />
              <Input id="rc-amount" aria-label="Montant" inputMode="decimal" placeholder="0,00" className="h-8 text-xs" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} />
              <CatSelect id="rc-cat" aria-label="Catégorie" className="h-8 text-xs" value={rec.category} onPick={(c) => setRec({ ...rec, category: c })} />
              <Input id="rc-day" aria-label="Jour du mois" type="number" min={1} max={31} className="h-8 text-xs" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} />
              <Btn type="submit" size="sm" className="col-span-2"><Plus size={12} />Ajouter</Btn>
            </form>
            <p className="mt-2 text-[11px] text-muted">Une récurrente déjà payée ce mois n'est jamais ajoutée deux fois. Supprimer la ligne générée ne la recrée pas avant le mois suivant.</p>
          </Card>
          <Card title="Par catégorie" action={<Btn size="sm" variant={editLimits ? "primary" : "soft"} onClick={() => setEditLimits(!editLimits)} data-testid="limits-btn">{editLimits ? <><Check size={13} />Terminé</> : "Plafonds par mois"}</Btn>}>
            {editLimits && <p className="mb-3 text-[11px] text-muted">Plafond mensuel par catégorie (vide = aucun). Une alerte s'affiche quand il est dépassé.</p>}
            <div className="flex flex-col gap-3">
              {(editLimits ? catsOf(state).map((c) => ({ c, v: exp.filter((e) => e.category === c).reduce((n, e) => n + e.amount, 0), lim: state.budget.limits[c] })) : byCat).map(({ c, v, lim }) => (
                <div key={c}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />{c}</span>
                    {editLimits ? <Input id={`lim-${c}`} aria-label={`Plafond ${c}`} inputMode="decimal" placeholder="aucun" className="h-7 w-24 text-xs" defaultValue={lim ? String(lim) : ""}
                      onBlur={(e) => { const val = e.target.value.trim() ? parseAmount(e.target.value) : 0; const limits = { ...state.budget.limits }; if (val > 0) limits[c] = val; else delete limits[c]; dispatch({ type: "budget/set", patch: { limits } }); }} />
                      : <span className={cx("font-mono tabular-nums", lim && v > lim ? "text-bad" : "text-muted")}>{money(v, cur)}{lim ? ` / ${money(lim, cur)}` : ""}</span>}</div>
                  <div className="h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (v / (lim || Math.max(spent, 1))) * 100)}%`, background: lim && v > lim ? "rgb(var(--bad))" : CAT_COLOR[c] }} /></div>
                </div>))}
              {!editLimits && !byCat.length && <div className="text-xs text-muted"><p>Aucune dépense ni plafond ce mois-ci.</p><button className="mt-1 font-semibold text-accent underline" onClick={() => setEditLimits(true)}>Fixer des plafonds par catégorie</button></div>}
            </div>
          </Card>
        </div>
      </div>
      {editing && <Modal title="Modifier la dépense" onClose={() => setEditing(null)}><ExpenseEdit e={editing} onDone={() => setEditing(null)} /></Modal>}
    </div>
  );
};
// ---------------------------------------------------------------- Revenus & épargne
const INCOME_SOURCES = ["Job / paye", "Bourse", "Aides (CAF, APL…)", "Famille", "Ami(e)", "Vente", "Remboursement", "Autre"];
const MoneyIn: React.FC<{ mk: string; cur: string }> = ({ mk, cur }) => {
  const { state, dispatch, toast, undoable } = useStore();
  const today = todayISO();
  const [tab, setTab] = useState<"income" | "saving">("income");
  const [inc, setInc] = useState({ amount: "", source: INCOME_SOURCES[0], label: "", date: today });
  const [sav, setSav] = useState({ amount: "", dir: "in" as "in" | "out", label: "" });
  const [goal, setGoal] = useState<{ name: string; target: string } | null>(null);
  const incomes = (state.budget.incomes ?? []).filter((x) => monthKey(x.date) === mk).sort((a, b) => b.date.localeCompare(a.date));
  const moves = (state.budget.savings ?? []).filter((x) => monthKey(x.date) === mk).sort((a, b) => b.date.localeCompare(a.date));
  const total = (state.budget.savings ?? []).reduce((n, x) => n + x.amount, 0);
  const g = state.budget.savingsGoal;
  const lastPay = incomes[0];
  const addIncome = (e: React.FormEvent) => {
    e.preventDefault(); const amount = parseAmount(inc.amount);
    if (!(amount > 0) || amount > 1_000_000) { toast("Saisissez un montant positif, par exemple 450.", "bad"); return; }
    dispatch({ type: "income/add", income: { id: uid(), date: inc.date || today, amount, source: inc.source, label: inc.label.trim() } });
    toast(`+${money(amount, cur)} (${inc.source}) ajoutés à votre budget du mois`); setInc({ ...inc, amount: "", label: "" });
  };
  const addSaving = (amount: number, label: string) => {
    if (!(amount > 0)) { toast("Saisissez un montant positif.", "bad"); return; }
    if (sav.dir === "out" && amount > total) { toast(`Votre épargne n'est que de ${money(total, cur)}.`, "bad"); return; }
    dispatch({ type: "saving/add", move: { id: uid(), date: today, amount: sav.dir === "out" ? -amount : amount, label } });
    toast(sav.dir === "out" ? `${money(amount, cur)} retirés de l'épargne (ajoutés au budget du mois)` : `${money(amount, cur)} mis de côté`);
    setSav({ ...sav, amount: "", label: "" });
  };
  return (
    <Card title={<span className="flex items-center gap-2"><TrendingUp size={15} />Revenus & épargne</span>}>
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-[12.5px] font-semibold">
        {([["income", "Argent reçu"], ["saving", "Épargne"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx("rounded-lg py-1.5", tab === k ? "bg-panel text-fg shadow-sm" : "text-muted")}>{l}</button>)}
      </div>
      {tab === "income" ? <>
        <form onSubmit={addIncome} className="grid grid-cols-2 gap-2" data-testid="income-form">
          <Field label="Montant" htmlFor="in-amount"><Input id="in-amount" inputMode="decimal" placeholder={`ex. 450 ${cur}`} value={inc.amount} onChange={(e) => setInc({ ...inc, amount: e.target.value })} /></Field>
          <Field label="Provenance" htmlFor="in-src"><Select id="in-src" value={inc.source} onChange={(e) => setInc({ ...inc, source: e.target.value })}>{INCOME_SOURCES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Détail (facultatif)" htmlFor="in-label"><Input id="in-label" placeholder="Paye de septembre" value={inc.label} onChange={(e) => setInc({ ...inc, label: e.target.value })} /></Field>
          <Field label="Date" htmlFor="in-date"><Input id="in-date" type="date" value={inc.date} onChange={(e) => setInc({ ...inc, date: e.target.value })} /></Field>
          <Btn type="submit" variant="primary" className="col-span-2"><Plus size={14} />Ajouter l'entrée d'argent</Btn>
        </form>
        <p className="mt-2 text-[11px] text-muted">Chaque entrée s'ajoute au budget du mois : le « Restant » augmente d'autant.</p>
        {incomes.length > 0 && <ul className="mt-3 flex flex-col divide-y divide-line text-[13px]">{incomes.map((x) => (
          <li key={x.id} className="group flex items-center gap-2 py-1.5"><span className="font-mono text-ok">+{money(x.amount, cur)}</span><span className="min-w-0 flex-1 truncate">{x.source}{x.label ? ` · ${x.label}` : ""}</span><span className="text-[11px] text-muted">{fmtDate(x.date)}</span>
            <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label="Supprimer l'entrée" onClick={() => undoable({ type: "income/remove", id: x.id }, "Entrée d'argent supprimée")}><Trash2 size={12} /></button></li>))}</ul>}
      </> : <>
        <div className="mb-3 rounded-xl border-2 border-line p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Épargne totale</p>
          <p className="font-display text-2xl font-extrabold text-ok" data-testid="savings-total">{money(total, cur)}</p>
          {g ? <>
            <div className="mt-2 flex items-center justify-between text-xs"><span>Objectif : <b>{g.name}</b></span><span className="font-mono">{money(total, cur)} / {money(g.target, cur)}</span></div>
            <div className="mt-1 h-2 rounded-full bg-sunken"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${Math.min(100, (total / g.target) * 100)}%` }} /></div>
            <p className="mt-1 text-[11px] text-muted">{total >= g.target ? "Objectif atteint, bravo !" : `Encore ${money(g.target - total, cur)}`} · <button className="underline" onClick={() => setGoal({ name: g.name, target: String(g.target) })}>modifier</button></p>
          </> : <button className="mt-1 text-xs font-semibold text-accent underline" onClick={() => setGoal({ name: "", target: "" })}>Fixer un objectif d'épargne</button>}
          {goal && <form className="mt-2 grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); const t = parseAmount(goal.target); if (!(t > 0)) { toast("Montant d'objectif invalide.", "bad"); return; }
            dispatch({ type: "budget/set", patch: { savingsGoal: { name: goal.name.trim() || "Mon objectif", target: t } } }); setGoal(null); toast("Objectif d'épargne enregistré"); }}>
            <Input aria-label="Nom de l'objectif" placeholder="Vacances, permis…" value={goal.name} onChange={(e) => setGoal({ ...goal, name: e.target.value })} />
            <Input aria-label="Montant visé" inputMode="decimal" placeholder={`Montant (${cur})`} value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} />
            <div className="col-span-2 flex justify-end gap-2">{g && <Btn type="button" size="sm" variant="ghost" onClick={() => { dispatch({ type: "budget/set", patch: { savingsGoal: null } }); setGoal(null); }}>Retirer l'objectif</Btn>}<Btn type="submit" size="sm">Enregistrer</Btn></div>
          </form>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); addSaving(parseAmount(sav.amount), sav.label.trim() || (sav.dir === "in" ? "Mis de côté" : "Retrait")); }} className="grid grid-cols-2 gap-2" data-testid="saving-form">
          <div className="col-span-2 grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-[12px] font-semibold">
            {([["in", "Mettre de côté"], ["out", "Retirer"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={sav.dir === k} onClick={() => setSav({ ...sav, dir: k })} className={cx("rounded-lg py-1", sav.dir === k ? "bg-panel text-fg shadow-sm" : "text-muted")}>{l}</button>)}
          </div>
          <Field label="Montant" htmlFor="sv-amount"><Input id="sv-amount" inputMode="decimal" placeholder={`ex. 50 ${cur}`} value={sav.amount} onChange={(e) => setSav({ ...sav, amount: e.target.value })} /></Field>
          <Field label="Note (facultatif)" htmlFor="sv-label"><Input id="sv-label" placeholder="Sur ma paye" value={sav.label} onChange={(e) => setSav({ ...sav, label: e.target.value })} /></Field>
          <Btn type="submit" variant="primary" className="col-span-2">{sav.dir === "in" ? "Épargner" : "Retirer de l'épargne"}</Btn>
        </form>
        {lastPay && sav.dir === "in" && <div className="mt-2 flex flex-wrap gap-1.5">{[10, 20, 30].map((p) => (
          <button key={p} className="rounded-full border border-line bg-sunken px-2.5 py-1 text-[12px] hover:border-fg/60" onClick={() => addSaving(Math.round(lastPay.amount * p) / 100, `${p} % de « ${lastPay.label || lastPay.source} »`)}>Épargner {p} % ({money(Math.round(lastPay.amount * p) / 100, cur)})</button>))}</div>}
        <p className="mt-2 text-[11px] text-muted">L'argent mis de côté est retiré du « Restant » du mois ; un retrait l'y ajoute.</p>
        {moves.length > 0 && <ul className="mt-3 flex flex-col divide-y divide-line text-[13px]">{moves.map((x) => (
          <li key={x.id} className="group flex items-center gap-2 py-1.5"><span className={cx("font-mono", x.amount > 0 ? "text-ok" : "text-warn")}>{x.amount > 0 ? "+" : "−"}{money(Math.abs(x.amount), cur)}</span><span className="min-w-0 flex-1 truncate">{x.label}</span><span className="text-[11px] text-muted">{fmtDate(x.date)}</span>
            <button className="text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label="Supprimer le mouvement" onClick={() => undoable({ type: "saving/remove", id: x.id }, "Mouvement d'épargne supprimé")}><Trash2 size={12} /></button></li>))}</ul>}
      </>}
    </Card>
  );
};

const ExpenseEdit: React.FC<{ e: Expense; onDone: () => void }> = ({ e, onDone }) => {
  const { dispatch, toast, state } = useStore();
  const [f, setF] = useState({ label: e.label, amount: String(e.amount).replace(".", ","), category: e.category, date: e.date });
  return (
    <form className="grid grid-cols-2 gap-3" onSubmit={(ev) => { ev.preventDefault(); const amount = parseAmount(f.amount);
      if (!(amount > 0)) { toast("Montant positif requis.", "bad"); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast("Date invalide.", "bad"); return; }
      dispatch({ type: "expense/update", id: e.id, patch: { label: f.label.trim() || f.category, amount, category: f.category, date: f.date } }); toast("Dépense modifiée, statistiques recalculées"); onDone(); }}>
      <Field label="Libellé" htmlFor="ee-label" className="col-span-2"><Input id="ee-label" autoFocus value={f.label} onChange={(x) => setF({ ...f, label: x.target.value })} /></Field>
      <Field label={`Montant (${state.settings.currency})`} htmlFor="ee-amount"><Input id="ee-amount" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} /></Field>
      <Field label="Catégorie" htmlFor="ee-cat"><CatSelect id="ee-cat" value={f.category} onPick={(c) => setF({ ...f, category: c })} /></Field>
      <Field label="Date" htmlFor="ee-date" className="col-span-2"><Input id="ee-date" type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></Field>
      {e.recurringId && <p className="col-span-2 text-xs text-muted">Dépense récurrente : la modification ne concerne que ce mois-ci.</p>}
      <div className="col-span-2 flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary"><Check size={14} />Enregistrer</Btn></div>
    </form>
  );
};

// ---------------------------------------------------------------- Module : Ménage
const EVENT_REC_LABEL: Record<EventRecurrence, string> = { none: "Une seule fois", daily: "Tous les jours", weekly: "Chaque semaine", biweekly: "Toutes les 2 semaines", monthly: "Chaque mois" };
/** Corvées courantes : un clic préremplit le formulaire (modifiable avant d'ajouter). */
const CHORE_PRESETS: { name: string; recurrence: Recurrence; day: number; minutes: number; group: "Nettoyage" | "Cuisine & repas" | "Linge" | "Maison" }[] = [
  { name: "Vaisselle", recurrence: "daily", day: 0, minutes: 15, group: "Cuisine & repas" }, { name: "Cuisiner le dîner", recurrence: "daily", day: 0, minutes: 40, group: "Cuisine & repas" },
  { name: "Préparer les repas de la semaine", recurrence: "weekly", day: 6, minutes: 90, group: "Cuisine & repas" }, { name: "Préparer le déjeuner du lendemain", recurrence: "daily", day: 0, minutes: 15, group: "Cuisine & repas" },
  { name: "Remplir / vider le lave-vaisselle", recurrence: "daily", day: 0, minutes: 10, group: "Cuisine & repas" }, { name: "Cuisine (plans de travail)", recurrence: "weekly", day: 3, minutes: 20, group: "Cuisine & repas" },
  { name: "Frigo (vider et nettoyer)", recurrence: "biweekly", day: 6, minutes: 20, group: "Cuisine & repas" }, { name: "Micro-ondes et four", recurrence: "biweekly", day: 3, minutes: 15, group: "Cuisine & repas" },
  { name: "Aspirateur", recurrence: "weekly", day: 5, minutes: 25, group: "Nettoyage" }, { name: "Serpillière", recurrence: "biweekly", day: 5, minutes: 25, group: "Nettoyage" },
  { name: "Salle de bain", recurrence: "weekly", day: 6, minutes: 30, group: "Nettoyage" }, { name: "Toilettes", recurrence: "weekly", day: 2, minutes: 10, group: "Nettoyage" },
  { name: "Poussière", recurrence: "biweekly", day: 4, minutes: 15, group: "Nettoyage" }, { name: "Vitres", recurrence: "biweekly", day: 6, minutes: 30, group: "Nettoyage" },
  { name: "Lessive", recurrence: "weekly", day: 6, minutes: 20, group: "Linge" }, { name: "Étendre / plier le linge", recurrence: "weekly", day: 6, minutes: 15, group: "Linge" },
  { name: "Repassage", recurrence: "weekly", day: 0, minutes: 30, group: "Linge" }, { name: "Changer les draps", recurrence: "biweekly", day: 0, minutes: 15, group: "Linge" },
  { name: "Sortir les poubelles", recurrence: "weekly", day: 1, minutes: 5, group: "Maison" }, { name: "Recyclage / verre", recurrence: "biweekly", day: 4, minutes: 10, group: "Maison" },
  { name: "Ranger la chambre", recurrence: "weekly", day: 0, minutes: 15, group: "Maison" }, { name: "Ranger le salon", recurrence: "weekly", day: 4, minutes: 15, group: "Maison" },
  { name: "Faire les courses", recurrence: "weekly", day: 5, minutes: 45, group: "Maison" }, { name: "Arroser les plantes", recurrence: "weekly", day: 2, minutes: 5, group: "Maison" },
];
/** Personne d'autre que « Moi » : pas de colocataire et aucune corvée partagée. */
const isSolo = (s: AppState) => !s.settings.roommates.length && s.chores.every((c) => c.assignees.every((a) => a === "Moi"));
const REC_LABEL: Record<Recurrence, string> = { daily: "Quotidienne", weekly: "Hebdomadaire", biweekly: "Bimensuelle", once: "Une seule fois" };
/** Glisser-déposer simple (souris, doigt, Apple Pencil). Souris : dès 6 px. Tactile : appui long (~0,35 s) puis glisser, le défilement est bloqué pendant le geste. */
function useDrag(opts: { onMove?: (dx: number, dy: number, x: number, y: number) => void; onDrop: (dx: number, dy: number, x: number, y: number) => void; onCancel?: () => void }) {
  const st = useRef<{ x: number; y: number; active: boolean; timer?: number; moved: boolean; pointer: string } | null>(null);
  const suppressClick = useRef(false);
  const o = useRef(opts); o.current = opts;
  useEffect(() => () => { if (st.current?.timer) window.clearTimeout(st.current.timer); }, []);
  const block = (e: TouchEvent) => { if (st.current?.active) e.preventDefault(); };
  const end = (e: PointerEvent) => {
    const s = st.current; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel); window.removeEventListener("touchmove", block);
    if (!s) return; if (s.timer) window.clearTimeout(s.timer); st.current = null;
    if (s.active && s.moved) { suppressClick.current = true; window.setTimeout(() => (suppressClick.current = false), 50); o.current.onDrop(e.clientX - s.x, e.clientY - s.y, e.clientX, e.clientY); }
    else if (s.active) o.current.onCancel?.();
  };
  const cancel = () => { const s = st.current; st.current = null; if (s?.timer) window.clearTimeout(s.timer); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", cancel); window.removeEventListener("touchmove", block); o.current.onCancel?.(); };
  const move = (e: PointerEvent) => {
    const s = st.current; if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.active) { if (s.pointer === "mouse" && Math.hypot(dx, dy) > 6) s.active = true; else if (s.pointer !== "mouse" && Math.hypot(dx, dy) > 10) { cancel(); return; } else return; }
    if (Math.hypot(dx, dy) > 4) s.moved = true;
    o.current.onMove?.(dx, dy, e.clientX, e.clientY);
  };
  const onPointerDown = (e: React.PointerEvent, immediate = false) => {
    if (e.button !== 0) return;
    st.current = { x: e.clientX, y: e.clientY, active: immediate, moved: false, pointer: e.pointerType };
    if (immediate) { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* facultatif */ } o.current.onMove?.(0, 0, e.clientX, e.clientY); }
    else if (e.pointerType !== "mouse") st.current.timer = window.setTimeout(() => { if (st.current) { st.current.active = true; navigator.vibrate?.(15); o.current.onMove?.(0, 0, st.current.x, st.current.y); } }, 350);
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", cancel);
    window.addEventListener("touchmove", block, { passive: false });
  };
  return { onPointerDown, wasDrag: () => suppressClick.current };
}

/** Déplace une occurrence de corvée vers un autre jour (et éventuellement une heure). */
function moveChoreTo(dispatch: (a: Action) => void, chore: Chore, from: string, to: string, time: string | null) {
  if (to === from) { dispatch({ type: "chore/pin", id: chore.id, date: from, time: time ?? "" }); return; }
  const pin = time ? { [to]: time } : {};
  if (chore.recurrence === "once") dispatch({ type: "chore/update", id: chore.id, patch: { date: to, day: weekday(parseISO(to)), pinned: pin } });
  else {
    dispatch({ type: "chore/skip", id: chore.id, date: from });
    dispatch({ type: "chore/add", chore: { id: uid(), name: chore.name, recurrence: "once", date: to, day: weekday(parseISO(to)), minutes: chore.minutes, assignees: [chore.assignees[0] ?? "Moi"], done: [], pinned: pin, ...(chore.steps?.length ? { steps: chore.steps, stepsDone: {} } : {}) } });
  }
}

/** Case de corvée déplaçable (tableau de la semaine). */
const ChoreDragCell: React.FC<{ chore: Chore; date: string; children: (drag: { onPointerDown: (e: React.PointerEvent, immediate?: boolean) => void; wasDrag: () => boolean; dragging: boolean }) => React.ReactNode }> = ({ chore, date, children }) => {
  const { dispatch, toast } = useStore();
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const cellAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(`[data-chore-row="${chore.id}"][data-date]`);
  const drag = useDrag({
    onMove: (_dx, _dy, x, y) => { setDragging(true); const c = cellAt(x, y); const d = c?.dataset.date ?? null; setHover(d); document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover")); c?.classList.add("drop-hover"); },
    onDrop: (_dx, _dy, x, y) => {
      setDragging(false); document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover"));
      const to = cellAt(x, y)?.dataset.date;
      if (!to || to === date) return;
      if (to < todayISO()) { toast("Choisissez aujourd'hui ou un jour à venir.", "bad"); return; }
      moveChoreTo(dispatch, chore, date, to, null); toast(`${chore.name} : déplacée au ${fmtDate(to)}`);
    },
    onCancel: () => { setDragging(false); document.querySelectorAll(".drop-hover").forEach((n) => n.classList.remove("drop-hover")); },
  });
  void hover;
  return <>{children({ ...drag, dragging })}</>;
};

const Chores: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const [offset, setOffset] = useState(0);
  const monday = addDays(new Date(), offset * 7 - weekday(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Sans colocataire (et sans corvée partagée), on masque tout ce qui concerne la rotation.
  const solo = isSolo(state);
  const [cmode, setCmode] = useState<"duration" | "slot">("duration");
  const [presetEnd, setPresetEnd] = useState(false);
  const [newSteps, setNewSteps] = useState<Step[]>([]);
  const [editSteps, setEditSteps] = useState<ID | null>(null);
  const editing = state.chores.find((c) => c.id === editSteps);
  const [f, setF] = useState({ name: "", recurrence: "weekly" as Recurrence, day: 5, date: todayISO(), minutes: 20, time: "18:00", end: "18:30", assignees: ["Moi", ...state.settings.roommates].join(", ") });
  const people = Array.from(new Set(state.chores.flatMap((c) => c.assignees)));
  const minutesBy = people.map((p) => ({ p, min: state.chores.reduce((n, c) => n + days.filter((d) => choreScheduledOn(c, d) && choreAssignee(c, d) === p).length * c.minutes, 0) }));
  const maxMin = Math.max(1, ...minutesBy.map((x) => x.min));
  const today = todayISO();
  const history = useMemo(() => choreHistory(state.chores, people, today, 4), [state.chores, today, people.join("|")]);
  const onTime = useMemo(() => ({ all: choreOnTimeStats(state.chores, today), d30: choreOnTimeStats(state.chores, today, 30), d7: choreOnTimeStats(state.chores, today, 7) }), [state.chores, today, state.settings.onTimeMode]);
  return (
    <div className="flex flex-col gap-4">
      <Card title={<span className="flex items-center gap-2"><Repeat size={15} />Semaine {isoWeek(monday)} · {monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
        action={<><Btn size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Semaine précédente"><ChevronLeft size={14} /></Btn><Btn size="sm" onClick={() => setOffset(0)}>Cette semaine</Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Semaine suivante"><ChevronRight size={14} /></Btn></>}>
        {!state.chores.length ? <Empty icon={<Home size={18} />} title="Aucune corvée définie" hint="Ajoutez une corvée ci-dessous pour générer la matrice et la rotation." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-1 text-[12px]">
              <thead><tr><th className="text-left text-[11px] font-medium uppercase tracking-wider text-muted">Corvée</th>
                {days.map((d) => <th key={iso(d)} className={cx("rounded-md py-1 text-center font-medium", iso(d) === today ? "bg-accent/10 text-accent" : "text-muted")}>{DAYS[weekday(d)]} {d.getDate()}</th>)}<th /></tr></thead>
              <tbody>
                {state.chores.map((c) => (
                  <tr key={c.id} className="group">
                    <td className="pr-2"><p className="font-medium text-fg">{c.name}</p>
                      <button className="text-[11px] text-accent hover:underline" onClick={() => setEditSteps(c.id)} aria-label={`Checklist de ${c.name}`}>{c.steps?.length ? `☑ Checklist · ${c.steps.length} étape${c.steps.length > 1 ? "s" : ""}` : "+ Checklist"}</button><p className="text-[11px] text-muted">{REC_LABEL[c.recurrence]}{c.recurrence === "once" && c.date ? ` · ${fmtDate(c.date)}` : ""}{c.time ? ` · ${c.time}–${toHHMM(toMin(c.time) + c.minutes)}` : ` · ${c.minutes} min`}</p></td>
                    {days.map((d) => { const on = choreScheduledOn(c, d); const k = iso(d); const done = c.done.includes(k); const skipped = (c.skipped ?? []).includes(k); const who = choreAssignee(c, d); const by = c.doneBy?.[k] ?? who; return (
                      <td key={k} className="relative text-center" data-chore-row={c.id} data-date={k}>{on ? (<>
                        {skipped ? (
                          <button onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: k }); toast("Report annulé", "info"); }} title="Reportée · cliquer pour annuler le report"
                            className="flex h-10 w-full flex-col items-center justify-center rounded-md border border-dashed border-line text-[10px] text-muted">reportée</button>
                        ) : <ChoreDragCell chore={c} date={k}>{(dg) => <><button onPointerDown={!done ? (e) => dg.onPointerDown(e) : undefined} style={{ WebkitTouchCallout: "none", userSelect: "none" } as React.CSSProperties} onContextMenu={(e) => e.preventDefault()} onClick={() => { if (dg.wasDrag()) return; dispatch({ type: "chore/toggle", id: c.id, date: k, who }); if (!done) toast(solo ? `${c.name} : faite` : `${c.name} : fait par ${who}`); }} title={done ? `Faite par ${by} · cliquer pour annuler` : `À faire par ${who} · cliquer quand c'est fait`}
                          className={cx(dg.dragging && "dragging-src", "flex h-10 w-full flex-col items-center justify-center rounded-md border text-[11px] transition", done && choreDoneLate(c, k) ? "border-warn/50 bg-warn/12 text-warn" : done ? "border-ok/40 bg-ok/12 text-ok" : k < today || (k === today && (choreSlotEnd(c, k) ?? 1e9) < nowMinutes()) ? "border-bad/30 bg-bad/6 text-bad" : who === "Moi" ? "border-accent/40 bg-accent/8 text-fg" : "border-line bg-sunken text-fg hover:border-accent/50")}>
                          {done ? <><Check size={14} />{choreDoneLate(c, k) ? <span className="text-[9px]">en retard</span> : !solo && by !== who && <span className="text-[9px]">{by}</span>}</> : <span className="font-medium">{solo ? "à faire" : who}</span>}
                        </button>
                          <span role="button" aria-label={`Déplacer ${c.name} vers un autre jour`} title="Glisser vers un autre jour" onPointerDown={(e) => { e.stopPropagation(); dg.onPointerDown(e, true); }}
                            className="absolute bottom-1 left-1 z-10 grid h-6 w-6 cursor-grab touch-none select-none place-items-center rounded-md bg-fg/10 text-[13px] leading-none text-fg/70 active:cursor-grabbing" style={{ touchAction: "none" }}>⠿</span></>}</ChoreDragCell>}
                        {!done && !skipped && k >= iso(addDays(parseISO(today), -7)) && <button aria-label={`Reporter ${c.name}`} title="Reporter (non faite, sans pénalité)" onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: k }); toast(`${c.name} reportée`, "info"); }}
                          className="absolute right-1 top-1 rounded px-0.5 text-[9px] leading-none text-muted opacity-60 hover:text-fg hover:opacity-100">↷</button>}
                      </>) : <span className="block h-10 rounded-md bg-sunken/40" />}</td>); })}
                    <td><button className="p-1 text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer la corvée" onClick={() => undoable({ type: "chore/remove", id: c.id }, `Corvée « ${c.name} » supprimée`)}><Trash2 size={12} /></button></td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
        {solo ? <p className="mt-2 text-xs text-muted">Cliquez une case quand la corvée est faite. Les corvées non faites sont ajoutées à votre planning du jour, à l'heure choisie ou dans un créneau libre. ↷ reporte une corvée sans la marquer faite. Glissez une case vers un autre jour pour la déplacer (appui long sur iPhone/iPad).</p> :
        <p className="mt-2 text-xs text-muted">La rotation avance automatiquement : chaque jour pour les tâches quotidiennes, chaque semaine (ou toutes les deux semaines) pour les autres. Les cases « Moi » non faites sont injectées dans le planning du jour. ↷ reporte une corvée sans la marquer faite. Glissez ⠿ (ou appui long sur la case) vers un autre jour pour la déplacer. Les données restent sur cet appareil (pas de partage entre colocataires).</p>}
      </Card>
      <div className={cx("grid grid-cols-1 gap-4 md:grid-cols-2", !solo && "xl:grid-cols-3")}>
        {!solo && <Card title={<span className="flex items-center gap-2"><Users size={15} />Répartition de la semaine</span>} action={<span className="text-[11px] text-muted">temps prévu</span>}>
          <div className="flex flex-col gap-3">{minutesBy.map(({ p, min }) => (
            <div key={p} className="grid grid-cols-[64px_1fr_56px] items-center gap-2 text-[13px]"><span className="truncate">{p}</span><div className="h-2 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(min / maxMin) * 100}%` }} /></div><span className="text-right font-mono text-xs tabular-nums text-muted">{fmtDur(min)}</span></div>))}</div>
        </Card>}
        <Card title={<span className="flex items-center gap-2"><Check size={15} />À l'heure ?</span>}>
          <div className="flex flex-col gap-3" data-testid="chore-ontime">
            <CounterRow label={solo ? "Mes corvées" : "Mes corvées (Moi)"} target={((state.settings.onTimeMode ?? "time") === "time") ? "faites à l'heure prévue" : "faites le jour prévu"} a={onTime.all} m={onTime.d30} lateWord="en retard ou oubliées" />
            <p className="text-[12px]">Cette semaine (7 j) : <b className="text-ok">{onTime.d7.ok} à l'heure</b> · <b className="text-bad">{onTime.d7.late} en retard</b></p>
            <ul className="flex flex-col gap-1 text-[11px] text-muted">
              <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-ok/40 bg-ok/12 align-middle" />{((state.settings.onTimeMode ?? "time") === "time") ? "Faite à l'heure prévue" : "Faite le jour prévu"}</li>
              <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-warn/50 bg-warn/12 align-middle" />{((state.settings.onTimeMode ?? "time") === "time") ? "Faite, mais cochée après l'heure prévue" : "Faite, mais cochée après le jour prévu"}</li>
              <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-bad/30 bg-bad/6 align-middle" />{((state.settings.onTimeMode ?? "time") === "time") ? "Heure passée, pas faite" : "Jour passé, pas faite"}</li>
            </ul>
            <p className="text-[11px] text-muted">{((state.settings.onTimeMode ?? "time") === "time") ? "Une corvée avec un créneau compte « en retard » dès que son heure de fin est passée sans être cochée. Comptées à partir de la première corvée cochée ou reportée ; les reportées (↷) ne comptent pas." : "Une corvée compte « en retard » si elle n'est pas cochée le jour prévu (jugée le lendemain). Comptées à partir de la première corvée cochée ou reportée ; les reportées (↷) ne comptent pas."} (Réglable dans Réglages.)</p>
          </div>
        </Card>
        <Card title="Historique · 4 semaines">
          {people.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[320px] text-left text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wider text-muted">{!solo && <th className="pb-2 font-medium">Personne</th>}<th className="pb-2 text-right font-medium">Faites</th><th className="pb-2 text-right font-medium">Prévues</th><th className="pb-2 text-right font-medium">Reportées</th><th className="pb-2 text-right font-medium">Temps</th></tr></thead>
              <tbody className="divide-y divide-line">{history.map((r) => (
                <tr key={r.person}>{!solo && <td className="py-1.5">{r.person}</td>}<td className="py-1.5 text-right font-mono tabular-nums">{r.done}</td><td className="text-right font-mono tabular-nums text-muted">{r.assigned}</td>
                  <td className="text-right font-mono tabular-nums text-muted">{r.skipped}</td><td className="text-right font-mono text-xs tabular-nums text-muted">{fmtDur(r.minutes)}</td></tr>))}</tbody>
            </table></div>) : <p className="text-xs text-muted">L'historique apparaîtra avec vos premières corvées.</p>}
          {!solo && <p className="mt-2 text-[11px] text-muted">« Prévues » : selon la rotation automatique. Une corvée faite par quelqu'un d'autre est comptée pour la personne qui l'a faite.</p>}
        </Card>
        <Card title="Nouvelle corvée">
          <form className="grid grid-cols-2 gap-2" onSubmit={(e) => { e.preventDefault(); const assignees = state.settings.roommates.length ? f.assignees.split(",").map((s) => s.trim()).filter(Boolean) : ["Moi"];
            if (!f.name.trim() || !assignees.length) { toast("Nom et au moins une personne requis.", "bad"); return; }
            if (cmode === "slot" && toMin(f.end) <= toMin(f.time)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
            const minutes = cmode === "slot" ? toMin(f.end) - toMin(f.time) : f.minutes;
            if (f.recurrence === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast("Choisissez la date de la corvée.", "bad"); return; }
            dispatch({ type: "chore/add", chore: { id: uid(), name: f.name.trim(), recurrence: f.recurrence, day: f.recurrence === "once" ? weekday(parseISO(f.date)) : f.day, ...(f.recurrence === "once" ? { date: f.date } : {}), minutes, assignees, done: [], ...(cmode === "slot" ? { time: f.time } : {}), ...(newSteps.some((x) => x.text.trim()) ? { steps: newSteps.filter((x) => x.text.trim()).map(({ id, text }) => ({ id, text: text.trim() })), stepsDone: {} } : {}) } }); setF({ ...f, name: "" }); setNewSteps([]); toast(state.settings.roommates.length ? "Corvée ajoutée à la rotation" : "Corvée ajoutée"); }}>
            <div className="col-span-2">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Suggestions</p>
              <div className="relative">
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1 pb-3" data-testid="chore-presets"
                onScroll={(e) => { const el = e.currentTarget; setPresetEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 6); }}>
                {(["Cuisine & repas", "Nettoyage", "Linge", "Maison"] as const).map((g) => {
                  const list = CHORE_PRESETS.filter((p) => p.group === g && !state.chores.some((c) => norm(c.name) === norm(p.name)));
                  return list.length ? <div key={g}><p className="mb-1 text-[11px] font-semibold text-muted">{g}</p><div className="flex flex-wrap gap-1.5">{list.map((p) => (
                    <button key={p.name} type="button" onClick={() => { setF({ ...f, name: p.name, recurrence: p.recurrence, day: p.day, minutes: p.minutes }); setCmode("duration"); }}
                      className={cx("rounded-full border px-2.5 py-1 text-[12px] transition", f.name === p.name ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken hover:border-fg/60")}>{p.name}</button>))}</div></div> : null;
                })}
              </div>
              {!presetEnd && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel to-transparent" />}
              </div>
              {!presetEnd && <p className="mt-1 text-center text-[11px] font-semibold text-muted">Descendez pour voir plus de suggestions ↓</p>}
            </div>
            <Field label="Corvée" htmlFor="ch-name" className="col-span-2"><Input id="ch-name" placeholder="Ex. Nettoyer la plaque" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <div className="col-span-2 flex gap-1.5" role="group" aria-label="Fréquence">
              {([[false, "🔁 Récurrente"], [true, "📅 Une seule fois"]] as [boolean, string][]).map(([once, l]) => { const on = (f.recurrence === "once") === once; return (
                <button key={l} type="button" aria-pressed={on} onClick={() => setF({ ...f, recurrence: once ? "once" : f.recurrence === "once" ? "weekly" : f.recurrence })}
                  className={cx("flex-1 rounded-lg border-2 px-2 py-2 text-[13px] font-semibold transition", on ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>); })}
            </div>
            {f.recurrence === "once" ? <Field label="Date choisie" htmlFor="ch-date" className="col-span-2"><Input id="ch-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field> : <>
            <Field label="Récurrence" htmlFor="ch-rec"><Select id="ch-rec" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as Recurrence })}>{(Object.keys(REC_LABEL) as Recurrence[]).filter((r) => r !== "once").map((r) => <option key={r} value={r}>{REC_LABEL[r]}</option>)}</Select></Field>
            <Field label="Jour" htmlFor="ch-day"><Select id="ch-day" value={f.day} disabled={f.recurrence === "daily"} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field></>}
            <TimeMode id="ch-mode" value={cmode} onChange={setCmode} className="col-span-2" />
            {cmode === "duration"
              ? <Field label="Durée (min)" htmlFor="ch-min" className="col-span-2"><Input id="ch-min" type="number" min={5} step={5} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></Field>
              : <><Field label="Début" htmlFor="ch-time"><Input id="ch-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
                <Field label="Fin" htmlFor="ch-end"><Input id="ch-end" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field></>}
            <StepsEditor id="ch-steps" steps={newSteps} onChange={setNewSteps} className="col-span-2" placeholder="Ex. Vider le frigo, laver les étagères…" />
            {state.settings.roommates.length > 0 && <Field label="Rotation (séparée par des virgules)" htmlFor="ch-who" className="col-span-2"><Input id="ch-who" placeholder="Moi, Inès" value={f.assignees} onChange={(e) => setF({ ...f, assignees: e.target.value })} /></Field>}
            <p className="col-span-2 text-[11px] text-muted">{cmode === "duration" ? "La corvée est placée dans un créneau libre de votre planning." : "La corvée apparaît à cet horaire dans votre planning."}{!state.settings.roommates.length && " Ajoutez des colocataires dans Réglages pour activer la rotation."}</p>
            <Btn type="submit" variant="primary" className="col-span-2"><Plus size={14} />Ajouter</Btn>
          </form>
        </Card>
      </div>
      {editing && <Modal title={`Checklist · ${editing.name}`} onClose={() => setEditSteps(null)}><ChoreStepsEdit c={editing} onDone={() => setEditSteps(null)} /></Modal>}
    </div>
  );
};

/** Coche une étape de corvée ; la corvée est marquée faite quand toutes ses étapes le sont. */
export function useChoreStep() {
  const { dispatch, toast } = useStore();
  return (c: Chore, date: string, stepId: ID, who: string) => {
    const was = choreStepsDone(c, date);
    const now = was.includes(stepId) ? was.filter((x) => x !== stepId) : [...was, stepId];
    dispatch({ type: "chore/step", id: c.id, date, stepId });
    const all = !!c.steps?.length && now.length === c.steps.length, done = c.done.includes(date);
    if (all && !done) { dispatch({ type: "chore/toggle", id: c.id, date, who }); toast(`${c.name} : toutes les étapes faites ✓`); }
    else if (!all && done && was.length === c.steps?.length) dispatch({ type: "chore/toggle", id: c.id, date, who });
  };
}

const ChoreStepsEdit: React.FC<{ c: Chore; onDone: () => void }> = ({ c, onDone }) => {
  const { dispatch, toast } = useStore();
  const today = todayISO();
  const [steps, setSteps] = useState<Step[]>(c.steps ?? []);
  const step = useChoreStep();
  const on = choreScheduledOn(c, parseISO(today));
  return (
    <div className="flex flex-col gap-4">
      {on && !!c.steps?.length && <div><p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Aujourd'hui · {choreStepsDone(c, today).length}/{c.steps.length}</p>
        <StepsCheck steps={c.steps} done={(id) => choreStepsDone(c, today).includes(id)} onToggle={(id) => step(c, today, id, choreAssignee(c, parseISO(today)))} /></div>}
      <StepsEditor id="cs-steps" steps={steps} onChange={setSteps} placeholder="Ex. Dégivrer, laver les bacs…" />
      <p className="text-[11px] text-muted">Les étapes se décochent automatiquement à chaque nouvelle occurrence de la corvée. Quand toutes sont cochées, la corvée est marquée faite.</p>
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Annuler</Btn>
        <Btn variant="primary" onClick={() => { const clean = steps.map((x) => ({ id: x.id, text: x.text.trim() })).filter((x) => x.text); dispatch({ type: "chore/update", id: c.id, patch: { steps: clean, stepsDone: c.stepsDone ?? {} } }); toast("Checklist enregistrée"); onDone(); }}><Check size={14} />Enregistrer</Btn></div>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Sommeil
// ---------------------------------------------------------------- Module : Routines (soins, médicaments, habitudes)
const HABIT_PRESETS: { group: string; name: string; emoji: string; cat: HabitCat; time?: string; steps?: string[]; days?: number[] }[] = [
  { group: "Soins", name: "Routine soin du soir", emoji: "🌙", cat: "soin", time: "22:30", steps: ["Démaquillant", "Nettoyant", "Sérum", "Crème hydratante"] },
  { group: "Soins", name: "Routine soin du matin", emoji: "🧴", cat: "soin", time: "07:45", steps: ["Nettoyant", "Crème hydratante", "Crème solaire"] },
  { group: "Soins", name: "Se brosser les dents", emoji: "🪥", cat: "soin", steps: ["Matin", "Soir"] },
  { group: "Soins", name: "Masque visage", emoji: "🧖", cat: "soin", days: [6] },
  { group: "Santé", name: "Prendre mes médicaments", emoji: "💊", cat: "santé", time: "08:00" },
  { group: "Santé", name: "Vitamines", emoji: "🍊", cat: "santé", time: "08:00" },
  { group: "Santé", name: "Boire 2 L d'eau", emoji: "💧", cat: "santé", steps: ["Matin", "Midi", "Après-midi", "Soir"] },
  { group: "Santé", name: "Prendre la pilule", emoji: "💊", cat: "santé", time: "21:00" },
  { group: "Sport", name: "Étirements", emoji: "🤸", cat: "sport", time: "07:30" },
  { group: "Sport", name: "Marche 30 min", emoji: "🚶", cat: "sport" },
  { group: "Sport", name: "Séance de sport", emoji: "🏋️", cat: "sport", days: [0, 2, 4] },
  { group: "Bien-être", name: "Méditation 10 min", emoji: "🧘", cat: "bien-être" },
  { group: "Bien-être", name: "Lire 20 min", emoji: "📖", cat: "bien-être", time: "22:00" },
  { group: "Bien-être", name: "Journal / gratitude", emoji: "✍️", cat: "bien-être", time: "22:15" },
  { group: "Bien-être", name: "Pas d'écran avant de dormir", emoji: "📵", cat: "bien-être", time: "23:00" },
  { group: "Maison", name: "Faire mon lit", emoji: "🛏️", cat: "maison", time: "07:40" },
  { group: "Maison", name: "Préparer mon sac", emoji: "🎒", cat: "maison", time: "21:30", days: [6, 0, 1, 2, 3] },
  { group: "Maison", name: "Arroser les plantes", emoji: "🪴", cat: "maison", days: [2, 5] },
];
const HABIT_EMOJIS = ["✨", "🌙", "🧴", "🪥", "💊", "💧", "🍊", "🤸", "🏋️", "🚶", "🧘", "📖", "✍️", "📵", "🛏️", "🎒", "🪴", "🥗", "☀️", "🐶"];
const catOf = (k: HabitCat) => HABIT_CATS.find((c) => c.k === k) ?? HABIT_CATS[HABIT_CATS.length - 1];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Coche une étape ; la routine est validée quand toutes ses étapes le sont. */
function useHabitStep() {
  const { dispatch, toast } = useStore();
  return (h: Habit, date: string, stepId: ID) => {
    const was = habitStepsDone(h, date);
    const now = was.includes(stepId) ? was.filter((x) => x !== stepId) : [...was, stepId];
    dispatch({ type: "habit/step", id: h.id, date, stepId });
    const all = !!h.steps?.length && now.length === h.steps.length, done = h.done.includes(date);
    if (all && !done) { dispatch({ type: "habit/toggle", id: h.id, date }); toast(`${h.emoji} ${h.name} : fait ✓`); }
    else if (!all && done && was.length === h.steps?.length) dispatch({ type: "habit/toggle", id: h.id, date });
  };
}

/** Liste des routines du jour (onglet Routines et tableau de bord). */
const HabitToday: React.FC<{ date: string; compact?: boolean }> = ({ date, compact }) => {
  const { state, dispatch, toast } = useStore();
  const step = useHabitStep();
  const list = (state.habits ?? []).filter((h) => habitOn(h, date)).sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.name.localeCompare(b.name));
  if (!list.length) return null;
  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="habits-today">
      {list.map((h) => { const done = h.done.includes(date), streak = habitStreak(h, date); return (
        <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0 text-[13px]">
          <button onClick={() => { dispatch({ type: "habit/toggle", id: h.id, date }); if (!done) toast(streak >= 1 ? `🔥 ${h.name} : série de ${streak + 1} jours !` : `${h.emoji} ${h.name} : fait ✓`); }} aria-label={done ? `Annuler ${h.name}` : `Marquer ${h.name} comme fait`}
            className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition", done ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40 hover:border-accent")}>{done && <Check size={13} strokeWidth={3} />}</button>
          <span className="text-base leading-none" aria-hidden>{h.emoji}</span>
          <span className={cx("min-w-0 flex-1 truncate font-medium", done && "text-muted line-through")}>{h.name}</span>
          {h.time && <span className="font-mono text-[11px] text-muted">{h.time}</span>}
          {(habitDoneLate(h, date) || habitTimePassed(h, date)) && <Pill tone={done ? "warn" : "bad"}>{done ? "Fait en retard" : "En retard"}</Pill>}
          {streak > 1 && <span key={streak} className="streak text-[11px] font-semibold text-warn" title="Série en cours"><span className="flame">🔥</span>{streak}</span>}
          {!compact && <span className="hidden h-2 w-2 rounded-full sm:inline-block" style={{ background: catOf(h.cat).color }} title={catOf(h.cat).label} />}
          {h.note && !compact && <p className="basis-full pl-8 text-[11px] text-muted">{h.note}</p>}
          {!!h.steps?.length && <div className="basis-full pl-8"><StepsCheck small steps={h.steps} done={(id) => habitStepsDone(h, date).includes(id)} onToggle={(id) => step(h, date, id)} label={`Étapes de ${h.name}`} /></div>}
        </li>); })}
    </ul>
  );
};

const HabitForm: React.FC<{ habit?: Habit; preset?: (typeof HABIT_PRESETS)[number] | null; onDone: () => void }> = ({ habit, preset, onDone }) => {
  const { dispatch, toast } = useStore();
  const init = habit ?? (preset ? { name: preset.name, emoji: preset.emoji, cat: preset.cat, time: preset.time, days: preset.days ?? ALL_DAYS, steps: (preset.steps ?? []).map((text) => ({ id: uid(), text })), note: "" } : null);
  const [f, setF] = useState({ name: init?.name ?? "", emoji: init?.emoji ?? "✨", cat: (init?.cat ?? "soin") as HabitCat, time: init?.time ?? "", days: init?.days ?? ALL_DAYS, note: init?.note ?? "" });
  const [steps, setSteps] = useState<Step[]>(init?.steps ?? []);
  const [rec, setRec] = useState<"week" | "every" | "month">(habit?.every ? "every" : habit?.monthDay ? "month" : "week");
  const [every, setEvery] = useState(habit?.every ?? 2), [monthDay, setMonthDay] = useState(habit?.monthDay ?? new Date().getDate());
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { toast("Donnez un nom à la routine.", "bad"); return; }
    if (rec === "week" && !f.days.length) { toast("Choisissez au moins un jour.", "bad"); return; }
    const clean = steps.map((x) => ({ id: x.id, text: x.text.trim() })).filter((x) => x.text);
    const data = { name: f.name.trim(), emoji: f.emoji, cat: f.cat, days: [...f.days].sort(), time: f.time || undefined, note: f.note.trim() || undefined, steps: clean.length ? clean : undefined,
      every: rec === "every" ? Math.max(2, Math.min(60, Math.round(every))) : undefined, monthDay: rec === "month" ? Math.max(1, Math.min(31, Math.round(monthDay))) : undefined };
    if (habit) { dispatch({ type: "habit/update", id: habit.id, patch: data }); toast("Routine mise à jour"); }
    else { dispatch({ type: "habit/add", habit: { id: uid(), ...data, done: [], stepsDone: {}, since: todayISO() } }); toast(`${f.emoji} ${f.name.trim()} ajoutée`); }
    onDone();
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <Field label="Nom" htmlFor="hb-name" className="col-span-2"><Input id="hb-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex. Prendre mes médicaments" /></Field>
      <div className="col-span-2"><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Icône</p>
        <div className="flex flex-wrap gap-1.5">{HABIT_EMOJIS.map((em) => <button key={em} type="button" onClick={() => setF({ ...f, emoji: em })} aria-label={`Icône ${em}`} aria-pressed={f.emoji === em}
          className={cx("grid h-9 w-9 place-items-center rounded-lg border-2 text-lg transition", f.emoji === em ? "border-fg bg-hi" : "border-line bg-sunken hover:border-fg/60")}>{em}</button>)}</div></div>
      <Field label="Catégorie" htmlFor="hb-cat"><Select id="hb-cat" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value as HabitCat })}>{HABIT_CATS.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}</Select></Field>
      <Field label="Heure (facultatif)" htmlFor="hb-time"><Input id="hb-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
      <div className="col-span-2"><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Récurrence</p>
        <div className="flex gap-1.5" role="group">{([["week", "Jours de la semaine"], ["every", "Tous les N jours"], ["month", "Chaque mois"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={rec === k} onClick={() => setRec(k)}
          className={cx("flex-1 rounded-lg border-2 px-2 py-1.5 text-[12px] font-semibold", rec === k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{l}</button>)}</div></div>
      {rec === "every" && <Field label="Tous les … jours" htmlFor="hb-every" className="col-span-2"><Input id="hb-every" type="number" min={2} max={60} value={every} onChange={(e) => setEvery(Number(e.target.value))} /></Field>}
      {rec === "month" && <Field label="Le … de chaque mois" htmlFor="hb-month" className="col-span-2"><Input id="hb-month" type="number" min={1} max={31} value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} /></Field>}
      {rec === "week" && <>
      <div className="col-span-2"><p className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted">Jours
        <span className="flex gap-2 normal-case tracking-normal"><button type="button" className="text-accent hover:underline" onClick={() => setF({ ...f, days: ALL_DAYS })}>Tous les jours</button><button type="button" className="text-accent hover:underline" onClick={() => setF({ ...f, days: [0, 1, 2, 3, 4] })}>En semaine</button></span></p>
        <div className="flex gap-1.5">{DAYS.map((d, i) => { const on = f.days.includes(i); return <button key={d} type="button" aria-pressed={on} onClick={() => setF({ ...f, days: on ? f.days.filter((x) => x !== i) : [...f.days, i] })}
          className={cx("h-9 flex-1 rounded-lg border-2 text-[12px] font-semibold transition", on ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken text-muted")}>{d}</button>; })}</div></div>
      </>}
      <Field label="Note (dose, produit…)" htmlFor="hb-note" className="col-span-2"><Input id="hb-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ex. 1 comprimé après le repas" /></Field>
      <StepsEditor id="hb-steps" steps={steps} onChange={setSteps} className="col-span-2" placeholder="Ex. Nettoyant, sérum, crème…" />
      <div className="col-span-2 flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary">{habit ? <><Check size={14} />Enregistrer</> : <><Plus size={14} />Ajouter</>}</Btn></div>
    </form>
  );
};

// ---------------------------------------------------------------- Module : Tâches perso (hors cours)
const kindOf = (k?: TodoKind) => TODO_KINDS.find((x) => x.k === k) ?? TODO_KINDS[TODO_KINDS.length - 1];
const PRIO: Record<Priority, { label: string; tone: "bad" | "warn" | "muted" }> = { 3: { label: "Haute", tone: "bad" }, 2: { label: "Normale", tone: "warn" }, 1: { label: "Basse", tone: "muted" } };
/** Ordre : date, puis heure de début, puis priorité. */
const todoSort = (a: Todo, b: Todo) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.start ?? "99").localeCompare(b.start ?? "99") || (b.priority ?? 2) - (a.priority ?? 2);

const TodoForm: React.FC<{ todo?: Todo; onDone: () => void }> = ({ todo, onDone }) => {
  const { dispatch, toast } = useStore();
  const today = todayISO();
  const [f, setF] = useState({ text: todo?.text ?? "", due: todo?.due ?? today, start: todo?.start ?? "", end: todo?.end ?? "", priority: (todo?.priority ?? 2) as Priority, kind: (todo?.kind ?? "perso") as TodoKind, note: todo?.note ?? "" });
  const [steps, setSteps] = useState<Step[]>(todo?.steps ?? []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.text.trim()) { toast("Donnez un titre à la tâche.", "bad"); return; }
    if (f.end && !f.start) { toast("Indiquez aussi l'heure de début.", "bad"); return; }
    if (f.start && f.end && toMin(f.end) <= toMin(f.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
    const clean = steps.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text);
    const data = { text: f.text.trim(), due: f.due || undefined, start: f.start || undefined, end: f.start && f.end ? f.end : undefined, priority: f.priority, kind: f.kind, note: f.note.trim() || undefined, steps: clean.length ? clean : undefined };
    if (todo) { dispatch({ type: "todo/update", id: todo.id, patch: data }); toast("Tâche mise à jour"); }
    else { dispatch({ type: "todo/add", todo: { id: uid(), done: false, createdAt: today, ...data } }); toast(f.start && f.end && f.due ? "Tâche ajoutée (visible dans le planning)" : "Tâche ajoutée"); }
    onDone();
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Titre" htmlFor="td-text" className="col-span-2 sm:col-span-4"><Input id="td-text" autoFocus value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Ex. Appeler la banque, RDV dentiste…" /></Field>
      <div className="col-span-2 sm:col-span-4"><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Type</p>
        <div className="flex flex-wrap gap-1.5">{TODO_KINDS.map((k) => <button key={k.k} type="button" aria-pressed={f.kind === k.k} onClick={() => setF({ ...f, kind: k.k })}
          className={cx("rounded-full border px-2.5 py-1 text-[12px] transition", f.kind === k.k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken hover:border-fg/60")}>{k.emoji} {k.label}</button>)}</div></div>
      <div className="col-span-2 sm:col-span-4"><p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Priorité</p>
        <div className="flex gap-1.5">{([3, 2, 1] as Priority[]).map((p) => <button key={p} type="button" aria-pressed={f.priority === p} onClick={() => setF({ ...f, priority: p })}
          className={cx("h-9 flex-1 rounded-lg border-2 text-[12px] font-semibold transition", f.priority === p ? (p === 3 ? "border-bad bg-bad/12 text-bad" : p === 2 ? "border-warn bg-warn/12 text-warn" : "border-fg/60 bg-sunken text-fg") : "border-line bg-sunken text-muted")}>{p === 3 && "🔥 "}{PRIO[p].label}</button>)}</div></div>
      <Field label="Jour" htmlFor="td-due" className="col-span-2"><Input id="td-due" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
      <Field label="Début (facultatif)" htmlFor="td-start"><Input id="td-start" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
      <Field label="Fin (facultatif)" htmlFor="td-end"><Input id="td-end" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
      <p className="col-span-2 -mt-1 text-[11px] text-muted sm:col-span-4">Jour vide = sans date. Avec un début et une fin, la tâche apparaît dans votre planning comme un rendez-vous.{f.due && <> <button type="button" className="text-accent hover:underline" onClick={() => setF({ ...f, due: "", start: "", end: "" })}>Retirer la date</button></>}</p>
      <Field label="Note" htmlFor="td-note" className="col-span-2 sm:col-span-4"><Input id="td-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Adresse, numéro, documents à prendre…" /></Field>
      <StepsEditor id="td-steps" steps={steps} onChange={setSteps} checkable className="col-span-2 sm:col-span-4" />
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-4"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary">{todo ? <><Check size={14} />Enregistrer</> : <><Plus size={14} />Ajouter</>}</Btn></div>
    </form>
  );
};

const TodoRow: React.FC<{ t: Todo; onEdit?: (t: Todo) => void; showDate?: boolean }> = ({ t, onEdit, showDate = true }) => {
  const { dispatch, toast, undoable } = useStore();
  const today = todayISO();
  const late = !t.done && !!t.due && t.due < today;
  const nSteps = t.steps?.length ?? 0, doneSteps = t.steps?.filter((x) => x.done).length ?? 0;
  return (
    <li className="group flex flex-wrap items-center gap-2 py-2 text-[13px]">
      <button onClick={() => { dispatch({ type: "todo/toggle", id: t.id }); if (!t.done) toast(`« ${t.text} » fait ✓`); }} aria-label={t.done ? `Rouvrir ${t.text}` : `Marquer ${t.text} comme fait`}
        className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition", t.done ? "border-fg bg-hi text-[rgb(24_22_46)]" : t.priority === 3 ? "border-bad hover:bg-bad/10" : "border-fg/40 hover:border-accent")}>{t.done && <Check size={11} strokeWidth={3} />}</button>
      <span aria-hidden className="text-[15px] leading-none">{kindOf(t.kind).emoji}</span>
      <button className={cx("min-w-0 flex-1 break-words text-left", t.done ? "text-muted line-through" : "hover:text-accent")} onClick={() => onEdit?.(t)} disabled={!onEdit}>{t.text}
        {nSteps > 0 && <span className="ml-1.5 font-mono text-[11px] text-muted">☑ {doneSteps}/{nSteps}</span>}</button>
      {t.start && <span className="font-mono text-[11px] tabular-nums text-muted">{t.start}{t.end ? `–${t.end}` : ""}</span>}
      {showDate && t.due && t.due !== today && !t.done && <Pill tone={late ? "bad" : "muted"}>{fmtDate(t.due)}</Pill>}
      {!t.done && t.priority === 3 && <Pill tone="bad">🔥 Haute</Pill>}
      {todoDoneLate(t) && <Pill tone="warn">Fait en retard</Pill>}
      {onEdit && <button className="p-1 text-muted opacity-60 hover:text-bad group-hover:opacity-100" aria-label={`Supprimer ${t.text}`} onClick={() => undoable({ type: "todo/remove", id: t.id }, `« ${t.text} » supprimée`)}><Trash2 size={12} /></button>}
      {t.note && !t.done && <p className="basis-full pl-12 text-[11px] text-muted">{t.note}</p>}
    </li>
  );
};

const Perso: React.FC = () => {
  const { state, dispatch, undoable } = useStore();
  const today = todayISO();
  const todos = state.todos ?? [];
  const [form, setForm] = useState<{ todo?: Todo } | null>(null);
  const [quick, setQuick] = useState(""); const [qDay, setQDay] = useState(todayISO());
  const [filter, setFilter] = useState<TodoKind | "">("");
  const [showDone, setShowDone] = useState(false);
  const open = todos.filter((t) => !t.done && (!filter || t.kind === filter)).sort(todoSort);
  const tomorrow = iso(addDays(parseISO(today), 1)), in7 = iso(addDays(parseISO(today), 7));
  const groups: [string, Todo[], boolean][] = [
    ["En retard", open.filter((t) => t.due && t.due < today), true],
    ["Aujourd'hui", open.filter((t) => t.due === today), false],
    ["Demain", open.filter((t) => t.due === tomorrow), false],
    ["Cette semaine", open.filter((t) => t.due && t.due > tomorrow && t.due <= in7), false],
    ["Plus tard", open.filter((t) => t.due && t.due > in7), false],
    ["Sans date", open.filter((t) => !t.due), false],
  ];
  const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const all = todoOnTimeStats(todos, today), d30 = todoOnTimeStats(todos, today, 30);
  const addQuick = (e: React.FormEvent) => { e.preventDefault(); const t = quick.trim(); if (!t) return; dispatch({ type: "todo/add", todo: { id: uid(), text: t.slice(0, 200), done: false, createdAt: today, ...(qDay ? { due: qDay } : {}), priority: 2, kind: "perso" } }); setQuick(""); };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card title={<span className="flex items-center gap-2"><ListChecks size={15} />À faire · {open.length}</span>} className="lg:col-span-2" action={<Btn size="sm" variant="primary" onClick={() => setForm({})}><Plus size={13} />Tâche détaillée</Btn>}>
        <form onSubmit={addQuick} className="mb-3 flex flex-col gap-2"><div className="flex gap-2"><Input aria-label="Ajout rapide" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Ajout rapide… (Entrée)" />
          <Btn type="submit" disabled={!quick.trim()} aria-label="Ajouter"><Plus size={14} /></Btn></div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {([["Aujourd'hui", today], ["Demain", tomorrow], ["Sans date", ""]] as [string, string][]).map(([l, v]) => <button key={l} type="button" aria-pressed={qDay === v} onClick={() => setQDay(v)}
              className={cx("rounded-full border px-2.5 py-1 transition", qDay === v ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken hover:border-fg/60")}>{l}</button>)}
            <Input type="date" aria-label="Autre jour" value={qDay} onChange={(e) => setQDay(e.target.value)} className="h-8 w-auto py-0 text-[12px]" />
            <span className="text-[11px] text-muted">Juste un jour, sans heure : la tâche reste dans votre liste ce jour-là.</span>
          </div></form>
        <div className="mb-3 flex flex-wrap gap-1.5">
          <button onClick={() => setFilter("")} aria-pressed={!filter} className={cx("rounded-full border px-2.5 py-1 text-[12px]", !filter ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken")}>Tout</button>
          {TODO_KINDS.filter((k) => todos.some((t) => !t.done && t.kind === k.k)).map((k) => <button key={k.k} onClick={() => setFilter(k.k)} aria-pressed={filter === k.k} className={cx("rounded-full border px-2.5 py-1 text-[12px]", filter === k.k ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-line bg-sunken")}>{k.emoji} {k.label}</button>)}
        </div>
        {open.length ? <div className="flex flex-col gap-3" data-testid="todos">{groups.filter(([, l]) => l.length).map(([label, list, bad]) => (
          <div key={label}><p className={cx("text-[11px] font-semibold uppercase tracking-wider", bad ? "text-bad" : "text-muted")}>{label} · {list.length}</p>
            <ul className="flex flex-col divide-y divide-line">{list.map((t) => <TodoRow key={t.id} t={t} onEdit={(x) => setForm({ todo: x })} showDate={label !== "Aujourd'hui"} />)}</ul></div>))}</div>
          : <Empty icon={<ListChecks size={18} />} title={todos.length ? "Tout est fait 🎉" : "Aucune tâche perso"} hint="Démarches, rendez-vous, appels, achats… tout ce qui n'est pas un devoir de cours." />}
        {done.length > 0 && <div className="mt-4 border-t border-dashed border-line pt-3">
          <div className="flex items-center justify-between"><button className="text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>Faites · {done.length} {showDone ? "▾" : "▸"}</button>
            {showDone && <Btn size="sm" variant="ghost" onClick={() => undoable({ type: "todo/clearDone" }, "Tâches faites effacées")}>Tout effacer</Btn>}</div>
          {showDone && <ul className="flex flex-col divide-y divide-line">{done.slice(0, 40).map((t) => <TodoRow key={t.id} t={t} onEdit={(x) => setForm({ todo: x })} />)}</ul>}
        </div>}
      </Card>
      <Card title="Bilan">
        <div className="flex flex-col gap-3">
          <CounterRow label="Tâches perso" target={((state.settings.onTimeMode ?? "time") === "time") ? "faites à l'heure prévue" : "faites le jour prévu"} a={all} m={d30} />
          <ul className="flex flex-col gap-1.5 text-[13px]">{TODO_KINDS.map((k) => { const n = todos.filter((t) => !t.done && t.kind === k.k).length; return n ? <li key={k.k} className="flex items-center gap-2"><span aria-hidden>{k.emoji}</span><span className="flex-1">{k.label}</span><span className="font-mono text-[12px] tabular-nums text-muted">{n}</span></li> : null; })}</ul>
          <p className="text-[11px] text-muted">Touchez une tâche pour la modifier (priorité, type, horaire, checklist). Les tâches avec un horaire précis apparaissent dans le planning.</p>
        </div>
      </Card>
      {form && <Modal title={form.todo ? "Modifier la tâche perso" : "Nouvelle tâche perso"} onClose={() => setForm(null)}><TodoForm todo={form.todo} onDone={() => setForm(null)} /></Modal>}
    </div>
  );
};

/** Carte du tableau de bord (tout en haut) : tâches perso en retard, d'aujourd'hui et de demain (pas celles plus lointaines). */
const TodoDashCard: React.FC<{ go: (v: ViewKey) => void }> = ({ go }) => {
  const { state } = useStore();
  const today = todayISO(), tomorrow = iso(addDays(parseISO(today), 1));
  const todos = state.todos ?? [];
  const open = todos.filter((t) => !t.done && t.due && t.due <= tomorrow).sort(todoSort);
  const groups: [string, Todo[], boolean][] = [
    ["En retard", open.filter((t) => t.due! < today), true],
    ["Aujourd'hui", open.filter((t) => t.due === today), false],
    ["Demain", open.filter((t) => t.due === tomorrow), false],
  ];
  const doneToday = todos.filter((t) => t.done && t.due === today).length, todayTotal = groups[1][1].length + doneToday;
  return (
    <Card title={<span className="flex items-center gap-2"><ListChecks size={15} />Mes tâches perso{todayTotal ? ` · ${doneToday}/${todayTotal} aujourd'hui` : ""}</span>} action={<Btn size="sm" variant="ghost" onClick={() => go("todos")}>Tout voir</Btn>}>
      {open.length ? <div className="flex flex-col gap-2" data-testid="dash-todos">{groups.filter(([, l]) => l.length).map(([label, list, bad]) => (
        <div key={label}><p className={cx("text-[11px] font-semibold uppercase tracking-wider", bad ? "text-bad" : "text-muted")}>{label} · {list.length}</p>
          <ul className="flex flex-col divide-y divide-line">{list.map((t) => <TodoRow key={t.id} t={t} showDate={bad} />)}</ul></div>))}</div>
        : <p className="text-[13px] text-muted">{doneToday ? "Tout est fait pour aujourd'hui 🎉" : "Rien de prévu aujourd'hui ni demain."} <button className="text-accent hover:underline" onClick={() => go("todos")}>Ajouter une tâche perso</button></p>}
    </Card>
  );
};

const Routines: React.FC = () => {
  const { state, dispatch, undoable } = useStore();
  const today = todayISO();
  const habits = state.habits ?? [];
  const [form, setForm] = useState<{ habit?: Habit; preset?: (typeof HABIT_PRESETS)[number] | null } | null>(null);
  const [offset, setOffset] = useState(0);
  const monday = addDays(parseISO(today), offset * 7 - weekday(parseISO(today)));
  const week = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));
  const todays = habits.filter((h) => habitOn(h, today)), doneToday = todays.filter((h) => h.done.includes(today)).length;
  const all = habitStats(habits, today), d30 = habitStats(habits, today, 30);
  const presets = HABIT_PRESETS.filter((p) => !habits.some((h) => norm(h.name) === norm(p.name)));
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Sparkles size={15} />Aujourd'hui · {todays.length ? `${doneToday}/${todays.length}` : "—"}</span>} action={<Btn size="sm" variant="primary" onClick={() => setForm({})}><Plus size={13} />Routine</Btn>}>
        {todays.length ? <>
          <div className="mb-3 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-ok transition-all" style={{ width: `${(doneToday / todays.length) * 100}%` }} /></div>
          <HabitToday date={today} />
          {doneToday === todays.length && <p className="mt-3 text-center text-[13px] font-semibold text-ok">Tout est fait aujourd'hui, bravo ! 🎉</p>}
        </> : <Empty icon={<Sparkles size={18} />} title={habits.length ? "Rien de prévu aujourd'hui" : "Aucune routine"} hint={habits.length ? "Vos routines ne sont pas prévues ce jour-là." : "Soin du soir, médicaments, eau, sport… Choisissez une suggestion ci-dessous ou créez la vôtre."} />}
      </Card>
      <Card title="Bilan">
        <div className="flex flex-col gap-3" data-testid="habit-stats">
          <CounterRow label="Routines" target="faites le jour prévu" a={all} m={d30} lateWord="oubliées" />
          {habits.length > 0 && <ul className="flex flex-col gap-1.5 text-[13px]">{[...habits].sort((a, b) => habitStreak(b, today) - habitStreak(a, today)).slice(0, 5).map((h) => (
            <li key={h.id} className="flex items-center gap-2"><span aria-hidden>{h.emoji}</span><span className="min-w-0 flex-1 truncate">{h.name}</span><span key={habitStreak(h, today)} className="streak font-mono text-[12px] tabular-nums text-muted"><span className="flame">🔥</span>{habitStreak(h, today)} j</span></li>))}</ul>}
          <p className="text-[11px] text-muted">Une routine non cochée un jour prévu compte comme oubliée (à partir du jour de sa création), et une routine cochée après son jour compte en retard. Avec une heure : en retard 30 min après cette heure (réglable dans Réglages).</p>
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Repeat size={15} />Semaine {isoWeek(monday)}</span>} className="md:col-span-2"
        action={<><Btn size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Semaine précédente"><ChevronLeft size={14} /></Btn><Btn size="sm" onClick={() => setOffset(0)}>Cette semaine</Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Semaine suivante"><ChevronRight size={14} /></Btn></>}>
        {habits.length ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-separate border-spacing-1 text-[12px]">
          <thead><tr><th className="text-left text-[11px] font-medium uppercase tracking-wider text-muted">Routine</th>{week.map((d) => <th key={d} className={cx("rounded-md py-1 text-center font-medium", d === today ? "bg-accent/10 text-accent" : "text-muted")}>{DAYS[weekday(parseISO(d))]} {parseISO(d).getDate()}</th>)}<th /></tr></thead>
          <tbody>{habits.map((h) => (
            <tr key={h.id} className="group">
              <td className="pr-2"><p className="flex items-center gap-1.5 font-medium text-fg"><span aria-hidden>{h.emoji}</span>{h.name}</p><p className="text-[11px] text-muted">{catOf(h.cat).label}{h.time ? ` · ${h.time}` : ""}{h.every ? ` · tous les ${h.every} jours` : h.monthDay ? ` · le ${h.monthDay} du mois` : h.days.length < 7 ? ` · ${h.days.map((d) => DAYS[d]).join(", ")}` : ""}</p></td>
              {week.map((d) => { const on = habitOn(h, d), done = h.done.includes(d); return (
                <td key={d} className="text-center">{on ? <button onClick={() => d <= today && dispatch({ type: "habit/toggle", id: h.id, date: d })} disabled={d > today} aria-label={`${h.name} le ${fmtDate(d)} : ${done ? "fait" : "non fait"}`}
                  className={cx("flex h-9 w-full items-center justify-center rounded-md border transition", done && habitDoneLate(h, d) ? "border-warn/50 bg-warn/12 text-warn" : done ? "border-ok/40 bg-ok/12 text-ok" : habitTimePassed(h, d) ? "border-bad/30 bg-bad/6 text-bad" : d < today ? "border-bad/30 bg-bad/6 text-bad" : d === today ? "border-accent/40 bg-accent/8" : "border-line bg-sunken text-muted opacity-60")}>
                  {done ? <Check size={14} strokeWidth={3} /> : d < today ? <X size={12} /> : ""}</button> : <span className="block h-9 rounded-md bg-sunken/40" />}</td>); })}
              <td className="whitespace-nowrap"><button className="p-1 text-muted hover:text-accent" aria-label={`Modifier ${h.name}`} onClick={() => setForm({ habit: h })}><Pencil size={12} /></button>
                <button className="p-1 text-muted hover:text-bad" aria-label={`Supprimer ${h.name}`} onClick={() => undoable({ type: "habit/remove", id: h.id }, `Routine « ${h.name} » supprimée`)}><Trash2 size={12} /></button></td>
            </tr>))}</tbody></table></div>
          : <p className="text-xs text-muted">Le tableau de la semaine apparaîtra avec votre première routine.</p>}
      </Card>
      {presets.length > 0 && <Card title="Suggestions" className="md:col-span-2">
        <div className="flex flex-col gap-3">{[...new Set(presets.map((p) => p.group))].map((g) => (
          <div key={g}><p className="mb-1 text-[11px] font-semibold text-muted">{g}</p><div className="flex flex-wrap gap-1.5">{presets.filter((p) => p.group === g).map((p) => (
            <button key={p.name} onClick={() => setForm({ preset: p })} className="rounded-full border border-line bg-sunken px-2.5 py-1 text-[12px] transition hover:border-fg/60">{p.emoji} {p.name}</button>))}</div></div>))}</div>
        <p className="mt-2 text-[11px] text-muted">Touchez une suggestion pour la personnaliser (heure, jours, étapes) avant de l'ajouter. Rappel : l'application ne remplace pas un avis médical ; suivez la posologie de votre ordonnance.</p>
      </Card>}
      {form && <Modal title={form.habit ? "Modifier la routine" : "Nouvelle routine"} onClose={() => setForm(null)}><HabitForm habit={form.habit} preset={form.preset} onDone={() => setForm(null)} /></Modal>}
    </div>
  );
};

const Sleep: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const s = state.settings;
  const tomorrow = addDays(new Date(), 1);
  const firstClass = state.classes.filter((c) => c.day === weekday(tomorrow)).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  const [manualWake, setManualWake] = useState("");
  const autoWake = firstClass ? toMin(firstClass.start) - s.prepMinutes : toMin(s.wakeDefault) + 60;
  const wake = manualWake ? toMin(manualWake) : autoWake;
  const opts = bedtimeOptions(wake, s.fallAsleep);
  const [log, setLog] = useState<SleepLog>({ date: todayISO(), bed: s.bedDefault, wake: s.wakeDefault, quality: 3 });
  // Cases « à l'heure » : proposées d'après les heures visées, jusqu'à ce que l'utilisateur les coche lui-même.
  const [touched, setTouched] = useState(false);
  const guess = onTimeGuess(log.bed, log.wake, s.bedDefault, s.wakeDefault);
  const bedOk = touched ? !!log.bedOk : guess.bedOk, wakeOk = touched ? !!log.wakeOk : guess.wakeOk;
  const ot = { all: onTimeStats(state.sleep, todayISO()), d30: onTimeStats(state.sleep, todayISO(), 30) };
  const flip = (l: SleepLog, k: "bedOk" | "wakeOk") => dispatch({ type: "sleep/upsert", log: { ...l, [k]: l[k] === undefined ? false : !l[k] } });
  const last14 = lastNDays(14);
  const today = todayISO();
  const ss = sleepStats(state.sleep, s.sleepGoal, today);
  const debt = ss.debt7;
  const existing = state.sleep.find((l) => l.date === log.date);
  const dur = sleepMinutes(log.bed, log.wake);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(log.date) || log.date > today) { toast("Choisissez une date passée ou aujourd'hui.", "bad"); return; }
    if (!log.bed || !log.wake) { toast("Indiquez l'heure de coucher et de réveil.", "bad"); return; }
    if (dur < 60 || dur > 16 * 60) { toast(`Durée de ${fmtDur(dur)} peu plausible : vérifiez les heures (le passage de minuit est géré automatiquement).`, "bad"); return; }
    const prev = state.sleep.find((l) => l.date === log.date);
    dispatch({ type: "sleep/upsert", log: { ...log, bedOk, wakeOk } }); setTouched(false);
    toast(`Nuit ${prev ? "mise à jour" : "enregistrée"} : ${fmtDur(dur)}`, "ok", prev ? { label: "Annuler", run: () => dispatch({ type: "sleep/upsert", log: prev }) } : undefined);
  };
  const firstCourse = firstClass ? state.courses.find((c) => c.id === firstClass.courseId) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><BedDouble size={15} />Heure idéale d'endormissement</span>}>
        <p className="text-[13px] text-muted">{firstClass ? <>Demain ({DAYS_LONG[weekday(tomorrow)].toLowerCase()}), premier cours à <b className="font-mono text-fg">{firstClass.start}</b> · {firstCourse?.name}. Avec {s.prepMinutes} min de préparation, réveil à <b className="font-mono text-fg">{toHHMM(autoWake)}</b>.</> : <>Pas de cours demain : réveil conseillé à <b className="font-mono text-fg">{toHHMM(autoWake)}</b>.</>}</p>
        <div className="mt-3 flex items-end gap-2"><Field label="Forcer un réveil" htmlFor="sl-wake"><Input id="sl-wake" type="time" value={manualWake} onChange={(e) => setManualWake(e.target.value)} className="w-32" /></Field>{manualWake && <Btn variant="ghost" onClick={() => setManualWake("")}>Automatique</Btn>}</div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {opts.map((o, i) => (
            <div key={o.cycles} className={cx("rounded-lg border p-3", i === 1 ? "border-accent bg-accent/8" : "border-line")}>
              <p className="text-[11px] uppercase tracking-wider text-muted">{o.cycles} cycles · {o.hours} h</p>
              <p className="font-mono text-2xl font-semibold tabular-nums">{toHHMM(o.bed)}</p>
              <p className="text-[11px] text-muted">{i === 0 ? "Optimal" : i === 1 ? "Recommandé" : "Minimum"}</p>
            </div>))}
        </div>
        <p className="mt-3 text-xs text-muted">Estimation approximative : cycles moyens de 90 min (en réalité 70 à 120 min selon les personnes et les nuits) plus {s.fallAsleep} min d'endormissement. Repère indicatif, pas un avis médical.</p>
      </Card>
      <Card title="Régularité & dette">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Moyenne 7 j</p><p className="font-mono text-lg font-semibold tabular-nums">{ss.avg7 === null ? "—" : fmtDur(ss.avg7)}</p><p className="text-[10px] text-muted">{ss.nights7} nuit{ss.nights7 > 1 ? "s" : ""} saisie{ss.nights7 > 1 ? "s" : ""}{ss.nights7 ? ` · ${ss.onGoal7} à l'objectif` : ""}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Moyenne 14 j</p><p className="font-mono text-lg font-semibold tabular-nums">{ss.avg14 === null ? "—" : fmtDur(ss.avg14)}</p><p className="text-[10px] text-muted">{ss.nights14} nuit{ss.nights14 > 1 ? "s" : ""}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Dette 7 j</p><p className={cx("font-mono text-lg font-semibold tabular-nums", !ss.nights7 ? "" : debt > 240 ? "text-bad" : debt > 60 ? "text-warn" : "text-ok")}>{!ss.nights7 ? "—" : debt > 0 ? fmtDur(debt) : "0"}</p><p className="text-[10px] text-muted">vs {s.sleepGoal} h, nuits saisies</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Coucher moyen</p><p className="font-mono text-lg font-semibold tabular-nums">{ss.avgBed === null ? "—" : toHHMM(ss.avgBed)}</p><p className={cx("text-[10px]", ss.bedSpread !== null && ss.bedSpread > 45 ? "text-warn" : "text-muted")}>{ss.bedSpread === null ? "2 nuits min." : `régularité ± ${Math.round(ss.bedSpread)} min`}</p></div>
          <div><p className="text-[11px] uppercase tracking-wider text-muted">Réveil moyen</p><p className="font-mono text-lg font-semibold tabular-nums">{ss.avgWake === null ? "—" : toHHMM(ss.avgWake)}</p><p className={cx("text-[10px]", ss.wakeSpread !== null && ss.wakeSpread > 45 ? "text-warn" : "text-muted")}>{ss.wakeSpread === null ? "2 nuits min." : `régularité ± ${Math.round(ss.wakeSpread)} min`}</p></div>
        </div>
        <div className="mt-3"><BarChart data={last14.map((d) => { const l = state.sleep.find((x) => x.date === d); const h = l ? sleepMinutes(l.bed, l.wake) / 60 : 0;
          return { label: String(parseISO(d).getDate()), value: h, missing: !l, tone: h >= s.sleepGoal - 0.25 ? "ok" : h >= s.sleepGoal - 1.25 ? "warn" : "bad" }; })} goal={s.sleepGoal} max={10} unit={(v) => `${Math.round(v)}h`} /></div>
        <div className="mt-2 flex items-center gap-2"><Field label="Objectif (h/nuit)" htmlFor="sl-goal"><Input id="sl-goal" type="number" min={5} max={11} step={0.5} className="w-24" value={s.sleepGoal} onChange={(e) => dispatch({ type: "settings", patch: { sleepGoal: Number(e.target.value) } })} /></Field>
          <p className="text-xs text-muted">{!ss.nights7 ? "Saisissez quelques nuits pour obtenir des statistiques. Les nuits non saisies (tirets) ne sont pas comptées." : debt > 240 ? "Dette élevée : couchez-vous 30 à 45 min plus tôt pendant quelques jours plutôt que de tout rattraper le week-end." : "Dette maîtrisée. Gardez des horaires réguliers à ± 30 min."} Indications générales, pas un avis médical.</p></div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Check size={15} />À l'heure ?</span>} className="md:col-span-2">
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <OnTimeCounter all={ot.all} d30={ot.d30} bedTarget={s.bedDefault} wakeTarget={s.wakeDefault} />
          <div className="flex flex-wrap items-end gap-3 md:flex-col md:items-stretch">
            <Field label="Coucher visé" htmlFor="sl-tbed"><Input id="sl-tbed" type="time" className="w-32" value={s.bedDefault} onChange={(e) => e.target.value && dispatch({ type: "settings", patch: { bedDefault: e.target.value } })} /></Field>
            <Field label="Réveil visé" htmlFor="sl-twake"><Input id="sl-twake" type="time" className="w-32" value={s.wakeDefault} onChange={(e) => e.target.value && dispatch({ type: "settings", patch: { wakeDefault: e.target.value } })} /></Field>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">À l'enregistrement d'une nuit, les cases sont pré-cochées (jusqu'à 15 min de retard = à l'heure) ; vous pouvez les changer, et cliquer ✓ / ✗ dans le tableau ci-dessous pour corriger une nuit.</p>
      </Card>
      <Card title="Enregistrer une nuit" className="md:col-span-2">
        <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
          <Field label="Nuit se terminant le" htmlFor="sl-date"><Input id="sl-date" type="date" value={log.date} max={todayISO()} onChange={(e) => setLog({ ...log, date: e.target.value })} /></Field>
          <Field label="Coucher" htmlFor="sl-bed"><Input id="sl-bed" type="time" value={log.bed} onChange={(e) => setLog({ ...log, bed: e.target.value })} /></Field>
          <Field label="Réveil" htmlFor="sl-wk"><Input id="sl-wk" type="time" value={log.wake} onChange={(e) => setLog({ ...log, wake: e.target.value })} /></Field>
          <Field label="Qualité" htmlFor="sl-q"><Select id="sl-q" value={log.quality} onChange={(e) => setLog({ ...log, quality: Number(e.target.value) as SleepLog["quality"] })}>{[1, 2, 3, 4, 5].map((q) => <option key={q} value={q}>{"★".repeat(q)}</option>)}</Select></Field>
          <div className="flex gap-2 pb-0.5" role="group" aria-label="À l'heure ?">
            {([["bedOk", "Couché·e à l'heure", bedOk], ["wakeOk", "Levé·e à l'heure", wakeOk]] as const).map(([k, label, v]) => (
              <button key={k} type="button" aria-pressed={v} onClick={() => { setTouched(true); setLog({ ...log, bedOk, wakeOk, [k]: !v }); }}
                className={cx("flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[12px] font-medium transition", v ? "border-ok/60 bg-ok/12 text-ok" : "border-bad/50 bg-bad/8 text-bad")}>
                {v ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}{label}</button>))}
          </div>
          <span className="pb-2 font-mono text-sm tabular-nums text-muted">= {fmtDur(dur)}{toMin(log.wake) <= toMin(log.bed) ? " (passage de minuit)" : ""}</span>
          <Btn type="submit" variant="primary"><Moon size={14} />{existing ? "Remplacer" : "Enregistrer"}</Btn>
          {existing && <span className="pb-2 text-xs text-warn">Une nuit existe déjà à cette date ({existing.bed} → {existing.wake}).</span>}
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[580px] text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Coucher</th><th className="pb-2 font-medium">Réveil</th><th className="pb-2 font-medium">Durée</th><th className="pb-2 font-medium">Écart objectif</th><th className="pb-2 font-medium">Qualité</th><th className="pb-2 font-medium">À l'heure</th><th /></tr></thead>
            <tbody className="divide-y divide-line">{[...state.sleep].reverse().slice(0, 10).map((l) => { const m = sleepMinutes(l.bed, l.wake); const diff = m - s.sleepGoal * 60; return (
              <tr key={l.date} className="group"><td className="py-1.5">{fmtDate(l.date)}</td><td className="font-mono tabular-nums">{l.bed}</td><td className="font-mono tabular-nums">{l.wake}</td><td className="font-mono tabular-nums">{fmtDur(m)}</td>
                <td className={cx("font-mono tabular-nums", diff < -60 ? "text-bad" : diff < 0 ? "text-warn" : "text-ok")}>{diff >= 0 ? "+" : "−"}{fmtDur(Math.abs(diff))}</td><td className="text-warn">{"★".repeat(l.quality)}</td>
                <td className="whitespace-nowrap">{(["bedOk", "wakeOk"] as const).map((k) => (
                  <button key={k} onClick={() => flip(l, k)} title={`${k === "bedOk" ? "Coucher" : "Réveil"} : ${l[k] === undefined ? "non renseigné" : l[k] ? "à l'heure" : "en retard"} · cliquer pour changer`} aria-label={`${k === "bedOk" ? "Coucher" : "Réveil"} à l'heure du ${fmtDate(l.date)}`}
                    className={cx("mr-1 inline-flex h-6 items-center gap-0.5 rounded-md border px-1.5 text-[11px]", l[k] === undefined ? "border-dashed border-line text-muted" : l[k] ? "border-ok/50 bg-ok/10 text-ok" : "border-bad/40 bg-bad/8 text-bad")}>
                    {k === "bedOk" ? "🛏" : "⏰"}{l[k] === undefined ? "?" : l[k] ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}</button>))}</td>
                <td className="text-right"><button className="text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer la nuit" onClick={() => undoable({ type: "sleep/remove", date: l.date }, "Nuit supprimée")}><Trash2 size={12} /></button></td></tr>); })}</tbody></table>
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Réglages
const ACCENTS: { k: string; label: string; light: string; dark: string }[] = [
  { k: "cobalt", label: "Cobalt", light: "52 72 240", dark: "120 138 255" },
  { k: "menthe", label: "Menthe", light: "0 135 105", dark: "60 210 160" },
  { k: "corail", label: "Corail", light: "222 64 52", dark: "255 120 100" },
  { k: "prune", label: "Prune", light: "128 58 200", dark: "182 132 255" },
  { k: "ocre", label: "Ocre", light: "176 110 0", dark: "245 180 60" },
  { k: "fuchsia", label: "Fuchsia", light: "212 30 120", dark: "255 110 170" },
];
export const accentCss = (k: string) => {
  const a = ACCENTS.find((x) => x.k === k) ?? ACCENTS[0];
  return `:root{--accent:${a.light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--accent:${a.dark}}}:root[data-theme="dark"]{--accent:${a.dark}}`;
};
const Personalize: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const s = state.settings;
  const set = (patch: Partial<SettingsState>) => dispatch({ type: "settings", patch });
  const [q, setQ] = useState({ label: "", amount: "", category: "Restauration" as ExpenseCat });
  return (
    <Card title={<span className="flex items-center gap-2"><Palette size={15} />Personnalisation</span>} className="lg:col-span-2">
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Couleur d'accent</p>
          <div className="flex flex-wrap gap-2">{ACCENTS.map((a) => (
            <button key={a.k} onClick={() => set({ accent: a.k })} aria-label={a.label} title={a.label}
              className={cx("grid h-10 w-10 place-items-center rounded-full border-2 border-fg transition-transform duration-300 [transition-timing-function:var(--spring)] hover:-rotate-6 hover:scale-110", s.accent === a.k && "scale-110 shadow-[3px_3px_0_0_rgb(var(--ink))]")}
              style={{ background: `rgb(${a.light})` }}>{s.accent === a.k && <Check size={16} className="text-white" strokeWidth={3} />}</button>))}</div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Modules affichés</p>
          <div className="flex flex-wrap gap-1.5">{NAV.filter((n) => n.key !== "dashboard" && n.key !== "settings").map((n) => {
            const on = !s.hiddenViews.includes(n.key);
            return (<button key={n.key} onClick={() => set({ hiddenViews: on ? [...s.hiddenViews, n.key] : s.hiddenViews.filter((x) => x !== n.key) })}
              className={cx("inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-semibold transition", on ? "border-fg bg-hi/60" : "border-line text-muted line-through")}><n.icon size={13} />{n.label}</button>);
          })}</div>
          <p className="mt-2 text-[11px] text-muted">Les modules masqués restent accessibles avec la recherche (Ctrl K).</p>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Dépenses rapides</p>
          <ul className="flex flex-col gap-1">{s.quickExpenses.map((x, i) => (
            <li key={i} className="flex items-center gap-2 text-[13px]"><span className="min-w-0 flex-1 truncate">{x.label}</span><span className="font-mono text-xs text-muted">{money(x.amount, s.currency)}</span>
              <button aria-label={`Retirer ${x.label}`} className="text-muted hover:text-bad" onClick={() => set({ quickExpenses: s.quickExpenses.filter((_, k) => k !== i) })}><X size={12} /></button></li>))}</ul>
          <form className="mt-2 grid grid-cols-[1fr_72px] gap-1.5" onSubmit={(e) => { e.preventDefault(); const amount = parseAmount(q.amount);
            if (!q.label.trim() || !(amount > 0)) { toast("Nom et montant requis.", "bad"); return; }
            set({ quickExpenses: [...s.quickExpenses, { label: q.label.trim(), amount, category: q.category }] }); setQ({ ...q, label: "", amount: "" }); toast("Raccourci ajouté"); }}>
            <Input aria-label="Nom" placeholder="Ex. Kebab" className="h-8 text-xs" value={q.label} onChange={(e) => setQ({ ...q, label: e.target.value })} />
            <Input aria-label="Montant" inputMode="decimal" placeholder="0,00" className="h-8 text-xs" value={q.amount} onChange={(e) => setQ({ ...q, amount: e.target.value })} />
            <CatSelect aria-label="Catégorie" className="h-8 text-xs" value={q.category} onPick={(c) => setQ({ ...q, category: c })} />
            <Btn type="submit" size="sm" className="h-8"><Plus size={12} /></Btn>
          </form>
        </div>
      </div>
    </Card>
  );
};

// ---------------------------------------------------------------- Mon compte (mode connecté)
export const SYNC_LABEL: Record<string, string> = { loading: "Chargement…", saving: "Enregistrement…", saved: "Enregistré", pending: "Modifications en attente", offline: "Hors ligne", error: "Erreur de synchronisation" };
export const syncTone = (st: string) => (st === "saved" ? "ok" : st === "error" ? "bad" : st === "offline" ? "warn" : "info") as "ok" | "bad" | "warn" | "info";
const AccountCard: React.FC = () => {
  const { env, toast, state } = useStore();
  const acc = env.account!, sync = env.sync;
  const [name, setName] = useState(acc.displayName);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState({ a: "", b: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState("");
  const [askDel, setAskDel] = useState(false);
  const run = async (key: string, fn: () => Promise<string | null>, ok: string) => {
    setBusy(key); const err = await fn(); setBusy(null);
    if (err) toast(err, "bad"); else toast(ok);
    return !err;
  };
  const exportAll = () => {
    const data = JSON.stringify({ exportedAt: new Date().toISOString(), account: { id: acc.id, email: acc.email, displayName: acc.displayName }, data: state }, null, 2);
    try { const url = URL.createObjectURL(new Blob([data], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `etudiant-os-mes-donnees-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); toast("Export téléchargé"); }
    catch { navigator.clipboard?.writeText(data).then(() => toast("Export copié dans le presse-papiers"), () => toast("Export impossible dans ce navigateur", "bad")); }
  };
  const pwError = pw.a && (pw.a.length < 8 || !/[a-zA-Z]/.test(pw.a) || !/\d/.test(pw.a)) ? "8 caractères minimum, avec au moins une lettre et un chiffre." : pw.b && pw.a !== pw.b ? "Les deux mots de passe ne correspondent pas." : null;
  return (
    <Card title={<span className="flex items-center gap-2"><Users size={15} />Mon compte</span>} className="lg:col-span-2" action={sync && <Pill tone={syncTone(sync.status)}>{SYNC_LABEL[sync.status]}{sync.pending && sync.status !== "saved" ? ` · ${sync.pending}` : ""}</Pill>}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-3">
          <div><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Connecté en tant que</p><p className="mt-1 truncate font-semibold" data-testid="account-email">{acc.email}</p>
            {acc.pendingEmail && <p className="mt-0.5 text-xs text-warn">Changement vers {acc.pendingEmail} en attente de confirmation (vérifiez vos deux boîtes mail).</p>}</div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (!n || n.length > 80) { toast("Nom entre 1 et 80 caractères.", "bad"); return; } void run("name", () => acc.updateName(n), "Nom d'affichage mis à jour"); }}>
            <Field label="Nom d'affichage" htmlFor="ac-name" className="flex-1"><Input id="ac-name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Btn type="submit" disabled={busy === "name" || name.trim() === acc.displayName}>{busy === "name" ? "…" : "Enregistrer"}</Btn>
          </form>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = email.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("Adresse e-mail invalide.", "bad"); return; }
            void run("email", () => acc.updateEmail(v), "Lien de confirmation envoyé : validez le changement depuis vos boîtes mail.").then((ok) => { if (ok) setEmail(""); }); }}>
            <Field label="Nouvelle adresse e-mail" htmlFor="ac-email" className="flex-1"><Input id="ac-email" type="email" autoComplete="email" placeholder="nouvelle@adresse.fr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Btn type="submit" disabled={busy === "email" || !email}>{busy === "email" ? "…" : "Changer"}</Btn>
          </form>
        </div>
        <form className="flex min-w-0 flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (!pw.a || !pw.b || pwError) { toast(pwError ?? "Remplissez les deux champs.", "bad"); return; }
          void run("pw", () => acc.updatePassword(pw.a), "Mot de passe modifié").then((ok) => { if (ok) setPw({ a: "", b: "" }); }); }}>
          <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Mot de passe</p>
          <Field label="Nouveau mot de passe" htmlFor="ac-pw"><Input id="ac-pw" type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} aria-describedby="ac-pw-help" /></Field>
          <Field label="Confirmer" htmlFor="ac-pw2"><Input id="ac-pw2" type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></Field>
          <p id="ac-pw-help" className={cx("text-[11px]", pwError ? "text-bad" : "text-muted")} aria-live="polite">{pwError ?? "8 caractères minimum, lettres et chiffres."}</p>
          <Btn type="submit" disabled={busy === "pw"}>{busy === "pw" ? "Modification…" : "Changer le mot de passe"}</Btn>
        </form>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted">Synchronisation</p>
          {sync && <div className="text-xs text-muted" data-testid="sync-detail">
            <p>{sync.status === "saved" ? "Toutes vos modifications sont enregistrées dans votre compte." : sync.status === "offline" ? `Hors ligne : ${sync.pending} modification${sync.pending > 1 ? "s" : ""} en attente, envoyée${sync.pending > 1 ? "s" : ""} au retour de la connexion.` : sync.status === "error" ? sync.error : sync.status === "saving" ? "Enregistrement en cours…" : `${sync.pending} modification${sync.pending > 1 ? "s" : ""} en attente d'envoi.`}</p>
            <p className="mt-1">Dernière synchronisation : {sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString("fr-FR") : "—"}</p>
            {sync.conflicts > 0 && <p className="mt-1">{sync.conflicts} modification{sync.conflicts > 1 ? "s" : ""} simultanée{sync.conflicts > 1 ? "s" : ""} d'un autre appareil fusionnée{sync.conflicts > 1 ? "s" : ""} sans perte.</p>}
            {(sync.status === "error" || sync.status === "offline" || sync.status === "pending") && <Btn size="sm" className="mt-2" onClick={sync.retry}><RotateCcw size={12} />Réessayer maintenant</Btn>}
          </div>}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={exportAll}><Download size={14} />Exporter mes données</Btn>
            <Btn variant="ghost" onClick={() => void acc.signOut()}><X size={14} />Se déconnecter</Btn>
          </div>
          {!askDel ? <Btn variant="danger" className="self-start" onClick={() => setAskDel(true)}><Trash2 size={14} />Supprimer mon compte</Btn> : (
            <div className="rounded-xl border-2 border-bad/50 bg-bad/5 p-3 text-xs">
              <p className="font-semibold text-bad">Suppression définitive</p>
              <p className="mt-1 text-muted">Votre compte, toutes vos données synchronisées et vos fichiers seront supprimés. Cette action est irréversible. Exportez vos données avant si besoin.</p>
              <Field label="Tapez SUPPRIMER pour confirmer" htmlFor="ac-del" className="mt-2"><Input id="ac-del" value={confirmDel} onChange={(e) => setConfirmDel(e.target.value)} autoComplete="off" /></Field>
              <div className="mt-2 flex gap-2">
                <Btn size="sm" variant="danger" disabled={confirmDel !== "SUPPRIMER" || busy === "del"} onClick={() => void run("del", acc.deleteAccount, "Compte supprimé")}>{busy === "del" ? "Suppression…" : "Supprimer définitivement"}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => { setAskDel(false); setConfirmDel(""); }}>Annuler</Btn>
              </div>
            </div>)}
        </div>
      </div>
    </Card>
  );
};

/** Aide, signalements et (pour les administrateurs reconnus par le serveur) accès à l'administration. */
const SupportCard: React.FC = () => {
  const { env } = useStore();
  const sp = env.support!;
  return (
    <Card title={<span className="flex items-center gap-2"><Sparkles size={15} />Aide & support</span>} className="lg:col-span-2">
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => sp.open("help")}>Besoin d'aide ?</Btn>
        <Btn onClick={() => sp.open("report")}><AlertTriangle size={14} />Signaler un problème</Btn>
        <Btn onClick={() => sp.open("requests")}><FileText size={14} />Mes demandes{sp.unread > 0 && <span className="rounded-full bg-pink px-1.5 text-[11px] text-white">{sp.unread}</span>}</Btn>
        {sp.isAdmin && <Btn variant="primary" onClick={sp.openAdmin} data-testid="admin-link"><Database size={14} />Administration</Btn>}
      </div>
    </Card>
  );
};

const SettingsView: React.FC = () => {
  const { state, dispatch, toast, undoable, env } = useStore();
  const BKEY = `${env.ns}:backup`, CKEY = `${env.ns}:corrupt`;
  const s = state.settings;
  const [json, setJson] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = () => { const text = JSON.stringify(state, null, 2); setJson(text);
    navigator.clipboard?.writeText(text).then(() => toast("Sauvegarde JSON copiée dans le presse-papiers"), () => toast("Sauvegarde générée ci-dessous : sélectionnez et copiez", "info")); };
  const [pending, setPending] = useState<{ state: AppState; repaired: string | null } | null>(null);
  const readStore = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const [backup, setBackup] = useState(() => readStore(BKEY));
  const corrupt = readStore(CKEY);
  const download = (text: string, name: string) => {
    try { const url = URL.createObjectURL(new Blob([text], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch { /* téléchargement bloqué : le texte reste copiable */ }
  };
  /** Copie de sécurité de l'état actuel avant toute opération qui le remplace. */
  const snapshot = () => { try { const t = JSON.stringify({ ...state, savedAt: new Date().toISOString() }); localStorage.setItem(BKEY, t); setBackup(t); return true; } catch { return false; } };
  // Étape 1 : lecture et validation ; étape 2 : confirmation explicite avant de remplacer les données.
  const importJson = (text: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { toast("Import impossible : le texte n'est pas du JSON valide.", "bad"); return; }
    const r = validateState(parsed);
    if (!r.ok) { toast(`Import impossible : ${r.error}`, "bad"); return; }
    setPending({ state: { ...r.state, settings: { ...r.state.settings, onboarded: true } }, repaired: r.repaired });
  };
  const confirmImport = () => {
    if (!pending) return;
    if (!snapshot()) { toast("Impossible de créer la copie de sécurité (stockage plein). Exportez d'abord vos données.", "bad"); return; }
    dispatch({ type: "replace", state: pending.state });
    toast(`Données importées${pending.repaired ? ` (${pending.repaired})` : ""}. Copie de sécurité de l'ancien état conservée.`); setPending(null); setJson("");
  };
  const restoreBackup = () => {
    if (!backup) return;
    const r = (() => { try { return validateState(JSON.parse(backup)); } catch { return null; } })();
    if (!r || !r.ok) { toast("La copie de sécurité est illisible.", "bad"); return; }
    const current = JSON.stringify(state);
    dispatch({ type: "replace", state: r.state });
    try { localStorage.setItem(BKEY, current); setBackup(current); } catch { /* ignore */ }
    toast("Copie de sécurité restaurée. L'état précédent devient la nouvelle copie (échange possible).");
  };
  const set = (patch: Partial<SettingsState>) => dispatch({ type: "settings", patch });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {env.account && <AccountCard />}
      {env.support && <SupportCard />}
      <Card title="Profil & rythme">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prénom" htmlFor="st-name"><Input id="st-name" value={s.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Thème" htmlFor="st-theme"><Select id="st-theme" value={s.theme} onChange={(e) => set({ theme: e.target.value as SettingsState["theme"] })}><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></Select></Field>
          <Field label="Réveil par défaut" htmlFor="st-wake"><Input id="st-wake" type="time" value={s.wakeDefault} onChange={(e) => set({ wakeDefault: e.target.value })} /></Field>
          <Field label="Coucher par défaut" htmlFor="st-bed"><Input id="st-bed" type="time" value={s.bedDefault} onChange={(e) => set({ bedDefault: e.target.value })} /></Field>
          <Field label="Préparation matin (min)" htmlFor="st-prep"><Input id="st-prep" type="number" min={10} max={180} value={s.prepMinutes} onChange={(e) => set({ prepMinutes: Number(e.target.value) })} /></Field>
          <Field label="Endormissement (min)" htmlFor="st-fall"><Input id="st-fall" type="number" min={0} max={60} value={s.fallAsleep} onChange={(e) => set({ fallAsleep: Number(e.target.value) })} /></Field>
          <Field label="Colocataires" htmlFor="st-room"><Input id="st-room" defaultValue={s.roommates.join(", ")} placeholder="Sami, Lina" onBlur={(e) => set({ roommates: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
          <Field label="Devise" htmlFor="st-cur"><Select id="st-cur" value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{["€", "$", "£", "CHF", "DT", "MAD", "FCFA"].map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
          <Field label="« À l'heure » compté selon" htmlFor="st-ontime" className="col-span-2">
            <Select id="st-ontime" value={s.onTimeMode ?? "time"} onChange={(e) => dispatch({ type: "settings", patch: { onTimeMode: e.target.value === "day" ? "day" : undefined } })}>
              <option value="time">L'heure du créneau (en retard dès que l'heure est passée)</option>
              <option value="day">Le jour prévu seulement (en retard le lendemain)</option>
            </Select></Field>
          <Field label="Objectif de focus / jour (min)" htmlFor="st-focus"><Input id="st-focus" type="number" min={0} max={720} step={15} value={s.focusGoal} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 720) set({ focusGoal: v }); }} /></Field>
          <Field label="Bloc de travail max (min)" htmlFor="st-block"><Input id="st-block" type="number" min={25} max={180} step={5} value={s.maxBlock} onChange={(e) => set({ maxBlock: Math.max(25, Number(e.target.value)) })} /></Field>
        </div>
      </Card>
      <Personalize />
      <Card title="Sauvegarde">
        <div className="flex flex-wrap gap-2">
          <Btn onClick={exportJson}><Download size={14} />Exporter en JSON</Btn>
          <Btn onClick={() => download(JSON.stringify(state, null, 2), `etudiant-os-${todayISO()}.json`)}><Download size={14} />Télécharger le fichier</Btn>
          <Btn onClick={() => fileRef.current?.click()}><Upload size={14} />Importer un fichier</Btn>
          <input ref={fileRef} id="st-file" type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(importJson); e.target.value = ""; }} />
        </div>
        <textarea id="st-json" aria-label="JSON" value={json} onChange={(e) => setJson(e.target.value)} rows={8} placeholder="Collez ici une sauvegarde JSON pour l'importer…" className={cx(inputCls, "mt-3 h-auto py-2 font-mono text-[11px]")} />
        <div className="mt-2 flex flex-wrap justify-between gap-2">
          <Btn variant="primary" disabled={!json.trim()} onClick={() => importJson(json)}>Vérifier et importer</Btn>
          {confirmReset ? (<div className="flex items-center gap-2"><span className="text-xs text-bad">Effacer toutes vos données ? (copie de sécurité conservée)</span><Btn size="sm" variant="danger" onClick={() => { snapshot(); dispatch({ type: "replace", state: blank({ onboarded: false, theme: s.theme }, 600) }); setConfirmReset(false); toast("Tout a été effacé. Recommencez la configuration.", "info"); }}>Confirmer</Btn><Btn size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Annuler</Btn></div>)
            : <Btn variant="danger" onClick={() => setConfirmReset(true)}><RotateCcw size={14} />Tout effacer</Btn>}
        </div>
        {pending && (
          <div className="mt-3 rounded-xl border-2 border-warn/60 bg-warn/10 p-3 text-xs">
            <p className="font-semibold">Remplacer vos données actuelles par ce fichier ?</p>
            <p className="mt-1 text-muted">{pending.state.tasks.length} tâches · {pending.state.courses.length} modules · {pending.state.budget.expenses.length} dépenses · {pending.state.sleep.length} nuits · {pending.state.focus.length} sessions de focus.{pending.repaired ? ` Réparations : ${pending.repaired}.` : ""}</p>
            <p className="mt-1 text-muted">Une copie de sécurité de vos données actuelles sera créée et restaurable ici.</p>
            <div className="mt-2 flex gap-2"><Btn size="sm" variant="primary" onClick={confirmImport}>Remplacer</Btn><Btn size="sm" variant="ghost" onClick={() => setPending(null)}>Annuler</Btn></div>
          </div>)}
        {backup && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted"><span className="min-w-0 flex-1">Copie de sécurité disponible{(() => { try { const d = JSON.parse(backup).savedAt; return d ? ` (${new Date(d).toLocaleString("fr-FR")})` : ""; } catch { return ""; } })()}.</span><Btn size="sm" onClick={restoreBackup}><RotateCcw size={12} />Restaurer</Btn></div>}
        {corrupt && <div className="mt-3 rounded-xl border border-bad/30 bg-bad/5 p-3 text-xs"><p className="text-bad">Des données illisibles ont été conservées lors d'un chargement précédent.</p>
          <div className="mt-2 flex flex-wrap gap-2"><Btn size="sm" onClick={() => { setJson(corrupt); toast("Données brutes affichées ci-dessus : corrigez-les puis importez.", "info"); }}>Afficher</Btn><Btn size="sm" onClick={() => download(corrupt, "etudiant-os-illisible.json")}>Télécharger</Btn></div></div>}
        <p className="mt-3 text-xs text-muted">{env.mode === "cloud" ? "Vos données sont enregistrées dans votre compte et synchronisées entre vos appareils. L'import vérifie et répare le fichier avant de remplacer quoi que ce soit ; une copie de sécurité reste sur cet appareil." : "Mode local : les données restent dans ce navigateur, sur cet appareil uniquement. Créez un compte pour les retrouver sur vos autres appareils. L'import vérifie et répare le fichier avant de remplacer quoi que ce soit."}</p>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------- Premier lancement
const Onboarding: React.FC<{ onDone: (s: AppState) => void }> = ({ onDone }) => {
  const { env } = useStore();
  const [f, setF] = useState({ name: env.account?.displayName ?? "", roommates: "", budget: "600", wake: "07:30", bed: "23:30", sleepGoal: 8 });
  const settings = (): Partial<SettingsState> => ({ name: f.name.trim() || "Moi", roommates: f.roommates.split(",").map((x) => x.trim()).filter(Boolean), wakeDefault: f.wake, bedDefault: f.bed, sleepGoal: f.sleepGoal });
  const start = (e: React.FormEvent) => { e.preventDefault(); onDone(blank(settings(), parseAmount(f.budget) || 600)); };
  const demo = () => { const s = seed(); onDone({ ...s, settings: { ...s.settings, onboarded: true } }); };
  return (
    <div className="grid min-h-full place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-lg animate-pop">
        <div className="mb-6 flex items-center gap-3"><div className="sticker grid h-12 w-12 place-items-center rounded-2xl border-2 border-fg bg-pink text-white shadow-[3px_3px_0_0_rgb(var(--ink))]"><Sparkles size={22} /></div>
          <div><h1 className="font-display text-3xl font-extrabold tracking-tight">Bienvenue dans <span className="marker">Étudiant OS<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h1><p className="text-sm text-muted">Trois réglages et votre espace est prêt. Tout reste dans ce navigateur.</p></div></div>
        <form onSubmit={start} className="inked stagger grid grid-cols-2 gap-3 rounded-3xl bg-panel p-5">
          <Field label="Votre prénom" htmlFor="ob-name" className="col-span-2"><Input id="ob-name" autoFocus placeholder="Ex. Khaled" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Colocataires (pour le ménage, facultatif)" htmlFor="ob-room" className="col-span-2"><Input id="ob-room" placeholder="Ex. Sami, Lina" value={f.roommates} onChange={(e) => setF({ ...f, roommates: e.target.value })} /></Field>
          <Field label="Budget mensuel (€)" htmlFor="ob-budget"><Input id="ob-budget" inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></Field>
          <Field label="Sommeil visé (h)" htmlFor="ob-sleep"><Input id="ob-sleep" type="number" min={5} max={11} step={0.5} value={f.sleepGoal} onChange={(e) => setF({ ...f, sleepGoal: Number(e.target.value) })} /></Field>
          <Field label="Réveil habituel" htmlFor="ob-wake"><Input id="ob-wake" type="time" value={f.wake} onChange={(e) => setF({ ...f, wake: e.target.value })} /></Field>
          <Field label="Coucher habituel" htmlFor="ob-bed"><Input id="ob-bed" type="time" value={f.bed} onChange={(e) => setF({ ...f, bed: e.target.value })} /></Field>
          <Btn type="submit" variant="primary" className="col-span-2 h-11 text-sm">Créer mon espace</Btn>
          <p className="col-span-2 text-center text-xs text-muted">Envie de voir l'application remplie d'abord ? <button type="button" onClick={demo} className="font-medium text-accent hover:underline">Explorer avec des données d'exemple</button></p>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Palette de commandes & raccourcis
interface Command { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void; group?: string; keywords?: string }
const CommandPalette: React.FC<{ commands: Command[]; onClose: () => void }> = ({ commands, onClose }) => {
  const [q, setQ] = useState(""); const [i, setI] = useState(0);
  // Recherche insensible aux accents, tous les mots doivent correspondre ; les tâches ne s'affichent qu'en cherchant.
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = commands.filter((c) => (c.group !== "Tâches" || words.length) && words.every((w) => norm(`${c.label} ${c.keywords ?? ""}`).includes(w))).slice(0, 40);
  useEffect(() => setI(0), [q]);
  // Le focus revient à l'élément actif avant l'ouverture.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); prev?.focus?.(); };
  }, []);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" }); }, [i]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-[8vh] animate-fade sm:px-4 sm:pt-[14vh]" onMouseDown={onClose}>
      <div className="inked w-full max-w-lg overflow-hidden rounded-[22px] bg-panel animate-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4"><Search size={15} className="text-muted" />
          <input id="cmdk" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Page, action ou tâche…" aria-label="Rechercher une page, une action ou une tâche" className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, list.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); } if (e.key === "Enter" && list[i]) { e.preventDefault(); const c = list[i]; onClose(); window.setTimeout(c.run, 0); } if (e.key === "Escape") onClose(); }} />
          <Kbd>Échap</Kbd></div>
        <ul ref={listRef} role="listbox" aria-label="Résultats" className="max-h-80 overflow-auto p-1.5">
          {list.map((c, k) => (<li key={c.id}>{(k === 0 || list[k - 1].group !== c.group) && c.group && <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[.12em] text-muted">{c.group}</p>}
            <button data-i={k} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => { onClose(); c.run(); }} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]", k === i ? "bg-sunken text-fg" : "text-muted")}>
            {c.icon}<span className="min-w-0 flex-1 truncate">{c.label}</span>{c.hint && <Kbd>{c.hint}</Kbd>}</button></li>))}
          {!list.length && <li className="px-3 py-6 text-center text-xs text-muted">Aucun résultat</li>}
        </ul>
      </div>
    </div>
  );
};

const NAV: { key: ViewKey; label: string; icon: React.FC<{ size?: number }>; short: string }[] = [
  { key: "dashboard", label: "Tableau de bord", icon: LayoutDashboard, short: "1" },
  { key: "planning", label: "Planning", icon: CalendarClock, short: "2" },
  { key: "academic", label: "Académique", icon: GraduationCap, short: "3" },
  { key: "focus", label: "Focus", icon: Timer, short: "4" },
  { key: "groceries", label: "Courses", icon: ShoppingCart, short: "5" },
  { key: "budget", label: "Budget", icon: Wallet, short: "6" },
  { key: "chores", label: "Ménage", icon: Home, short: "7" },
  { key: "todos", label: "Tâches perso", icon: ListChecks, short: "" },
  { key: "routines", label: "Routines", icon: Sparkles, short: "0" },
  { key: "sleep", label: "Sommeil", icon: Moon, short: "8" },
  { key: "settings", label: "Réglages", icon: Settings, short: "9" },
];

/** Menu complet sur téléphone, ouvert depuis le bouton ⋮ de l'en-tête (remplace la barre du bas). */
const MobileMenu: React.FC<{ items: typeof NAV; view: ViewKey; plan: DayPlan; onPick: (k: ViewKey) => void; onSearch: () => void; onTheme: () => void; isDark: boolean; onClose: () => void; extra?: React.ReactNode }> = ({ items, view, plan, onPick, onSearch, onTheme, isDark, onClose, extra }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[aria-current=page]")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Le menu est fixe : on le ferme dès que la page défile, pour qu'il ne « suive » pas le défilement.
    const y0 = window.scrollY;
    const scroll = () => { if (Math.abs(window.scrollY - y0) > 8) onClose(); };
    window.addEventListener("scroll", scroll, { passive: true });
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.parentElement!.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", key); window.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", down); window.removeEventListener("scroll", scroll);
      // Ne reprend pas le focus si une autre fenêtre (recherche) vient de le prendre.
      const act = document.activeElement; if (!act || act === document.body || ref.current?.contains(act)) prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label="Navigation"
      className="inked fixed z-50 w-[min(18rem,calc(100vw-2rem))] origin-top-right overflow-y-auto rounded-[20px] bg-panel p-2 animate-pop"
      style={{ top: "calc(var(--safe-top) + 72px)", right: "max(16px, env(safe-area-inset-right, 0px))", maxHeight: "calc(100dvh - 90px - var(--safe-top))" }}>
      {items.map((n) => (
        <button key={n.key} role="menuitem" aria-current={view === n.key ? "page" : undefined} onClick={() => onPick(n.key)}
          className={cx("nav-item flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left text-[14px] transition", view === n.key ? "border-fg bg-hi font-bold text-[rgb(24_22_46)] shadow-[2px_2px_0_0_rgb(var(--ink))]" : "border-transparent text-fg hover:bg-sunken")}>
          <n.icon size={18} /><span className="flex-1">{n.label}</span>
        </button>))}
      <div className="mt-2 border-t-2 border-dashed border-line px-1 pt-2">
        <button role="menuitem" onClick={onSearch} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-[14px] text-muted hover:bg-sunken"><Search size={17} />Rechercher</button>
        <button role="menuitem" onClick={onTheme} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left text-[14px] text-muted hover:bg-sunken">{isDark ? <Sun size={17} /> : <Moon size={17} />}{isDark ? "Thème clair" : "Thème sombre"}</button>
        {extra}
        <div className="px-2 pb-1 pt-2"><p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Charge du jour</p><LoadMeter load={plan.load} level={plan.level} /></div>
      </div>
    </div>
  );
};
export const ToastStack: React.FC<{ toasts: Toast[] }> = ({ toasts }) => (
  <div className="pointer-events-none fixed z-[60] flex flex-col items-end gap-2" style={{ bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))" }}>
    {toasts.map((t) => (
      <div key={t.id} role="status" className={cx("inked pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold animate-slide", t.tone === "bad" ? "bg-pink text-white" : "bg-hi text-[rgb(24_22_46)]")}>
        <span className="tick grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-current">{t.tone === "bad" ? <X size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}</span><span className="min-w-0 flex-1">{t.text}</span>
        {t.action && <button onClick={t.action.run} className="ml-1 shrink-0 rounded-lg border-2 border-current px-2 py-0.5 text-xs font-bold underline-offset-2 hover:underline">{t.action.label}</button>}
      </div>))}
  </div>
);

// ---------------------------------------------------------------- Application racine
export interface StudentOSProps {
  state: AppState; dispatch: (a: Action) => void; env: AppEnv;
  view: ViewKey; onView: (v: ViewKey) => void;
  /** Message à afficher au démarrage (données réparées, stockage indisponible…). */
  notice?: string | null;
  /** Contenu ajouté sous l'en-tête (statut de synchronisation…) et dans le menu (déconnexion…). */
  headerExtra?: React.ReactNode; menuExtra?: React.ReactNode;
  /** Page affichée à la place du module courant (pages de support), dans le même cadre. */
  override?: { key: string; title: string; node: React.ReactNode } | null;
}
export default function StudentOS({ state, dispatch, env, view, onView, notice, headerExtra, menuExtra, override }: StudentOSProps) {
  const stateRef = useRef(state); stateRef.current = state;
  setOnTimeMode(state.settings.onTimeMode); // avant tout affichage des compteurs « à l'heure »
  useFeedAutoSync(state, dispatch, env.fetchCalendar);
  // Corvées sans heure placées aujourd'hui : on fige leur créneau (placé après l'heure actuelle) pour qu'il ne bouge plus.
  useEffect(() => {
    const today = todayISO(); const plan = planFor(state, today);
    for (const b of plan.blocks) if (b.kind === "chore" && b.refId) { const c = state.chores.find((x) => x.id === b.refId); if (c && !c.time && !c.pinned?.[today]) dispatch({ type: "chore/pin", id: c.id, date: today, time: toHHMM(b.start) }); }
  }, [state.chores, state.classes, state.events, state.tasks]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [editTask, setEditTask] = useState<ID | null>(null);
  const setViewRaw = onView;
  const [palette, setPalette] = useState(false);
  // Changement de module animé : View Transitions API si disponible, sinon simple entrée échelonnée.
  const setView = useCallback((v: ViewKey) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduce) doc.startViewTransition(() => flushSync(() => setViewRaw(v)));
    else setViewRaw(v);
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [onView]);
  const [newTask, setNewTask] = useState(false);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => { if (notice) toast(notice, "bad"); }, [notice]);
  // Dépenses récurrentes : ajoutées le jour venu (au chargement puis toutes les heures, sans doublon).
  // Relancé aussi quand la liste des récurrentes change (import, données d'exemple) ; l'opération est idempotente.
  useEffect(() => { const sync = () => dispatch({ type: "recurring/sync", today: todayISO() }); sync(); const id = window.setInterval(sync, 3600_000); return () => window.clearInterval(id); }, [state.budget.recurring]);
  // Minuteur global : continue quand on change de page, reprend après actualisation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.timer.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state.timer.running]);
  const finishing = useRef<string | null>(null);
  useEffect(() => {
    const t = state.timer;
    if (!t.running || timerLeft(t, now) > 0 || finishing.current === t.sessionId) return;
    finishing.current = t.sessionId; // une seule fin par session, même si l'effet se relance
    beep();
    const wasWork = t.phase === "work", cfg = state.settings.pomodoro;
    dispatch({ type: "timer/finish", now: Date.now(), date: todayISO() });
    const nextLong = (t.cycles + 1) % cfg.longEvery === 0;
    toast(wasWork ? `Session terminée : ${cfg.work} min enregistrées · ${nextLong ? `pause longue de ${cfg.long}` : `pause courte de ${cfg.short}`} min` : "Pause terminée, prêt à reprendre", wasWork ? "ok" : "info");
  }, [now, state.timer]);
  useEffect(() => {
    const t = state.timer, left = timerLeft(t, now);
    document.title = t.running ? `${pad(Math.floor(left / 60))}:${pad(left % 60)} · ${PHASE_LABEL[t.phase]}` : "Étudiant OS";
  }, [now, state.timer]);
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", state.settings.theme);
    try { localStorage.setItem("etudiant-os/theme", JSON.stringify(state.settings.theme)); } catch { /* facultatif */ }
  }, [state.settings.theme]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok", action?: ToastAction) => {
    const id = uid();
    const act = action && { ...action, run: () => { action.run(); setToasts((t) => t.filter((x) => x.id !== id)); } };
    setToasts((t) => [...t.slice(-3), { id, text, tone, action: act }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 6500 : 3200);
  }, []);
  const undoable = useCallback((a: Action, text: string) => {
    const prev = stateRef.current;
    dispatch(a);
    toast(text, "info", { label: "Annuler", run: () => { dispatch({ type: "replace", state: prev }); toast("Action annulée", "info"); } });
  }, [toast, dispatch]);
  const ctx = useMemo(() => ({ state, dispatch, toast, undoable, go: setView, openTask: setEditTask, now, env }), [state, dispatch, toast, undoable, setView, now, env]);
  const isDark = state.settings.theme === "dark" || (state.settings.theme === "system" && typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches);
  const toggleTheme = () => dispatch({ type: "settings", patch: { theme: isDark ? "light" : "dark" } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      if (typing || palette || newTask || editTask || e.metaKey || e.ctrlKey || e.altKey) return;
      const nav = NAV.find((n) => n.short === e.key); if (nav) { setView(nav.key); return; }
      if (e.key === "n") { e.preventDefault(); setNewTask(true); }
      else if (e.key === "t") toggleTheme();
      else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === " " && view === "focus") { e.preventDefault(); dispatch({ type: stateRef.current.timer.running ? "timer/pause" : "timer/start", now: Date.now() }); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });

  const plan = useMemo(() => planFor(state, todayISO()), [state]);
  const focusField = (v: ViewKey, id: string) => { setView(v); window.setTimeout(() => document.getElementById(id)?.focus(), 350); };
  const commands: Command[] = [
    { id: "new", group: "Actions", label: "Nouvelle tâche", hint: "N", icon: <Plus size={14} />, run: () => setNewTask(true) },
    { id: "focus-start", group: "Actions", label: state.timer.running ? "Mettre le minuteur en pause" : "Démarrer le minuteur de focus", keywords: "pomodoro timer", hint: "Espace", icon: state.timer.running ? <Pause size={14} /> : <Play size={14} />, run: () => { dispatch({ type: state.timer.running ? "timer/pause" : "timer/start", now: Date.now() }); setView("focus"); } },
    { id: "expense", group: "Actions", label: "Ajouter une dépense", keywords: "budget argent", icon: <Wallet size={14} />, run: () => focusField("budget", "bd-amount") },
    { id: "grocery", group: "Actions", label: "Ajouter un article de courses", keywords: "liste", icon: <ShoppingCart size={14} />, run: () => focusField("groceries", "gr-name") },
    { id: "sleep", group: "Actions", label: "Enregistrer une nuit", keywords: "sommeil", icon: <BedDouble size={14} />, run: () => focusField("sleep", "sl-bed") },
    { id: "export", group: "Actions", label: "Exporter mes données (JSON)", keywords: "sauvegarde backup", icon: <Download size={14} />, run: () => setView("settings") },
    { id: "theme", group: "Actions", label: "Basculer clair / sombre", hint: "T", icon: isDark ? <Sun size={14} /> : <Moon size={14} />, run: toggleTheme },
    { id: "help", group: "Actions", label: "Raccourcis clavier", hint: "?", icon: <Keyboard size={14} />, run: () => setHelp(true) },
    ...NAV.map((n) => ({ id: `page-${n.key}`, group: "Pages", label: n.label, keywords: "aller page", hint: n.short, icon: <n.icon size={14} />, run: () => setView(n.key) })),
    ...state.tasks.map((t) => ({ id: `task-${t.id}`, group: "Tâches", label: t.title, keywords: `${state.courses.find((c) => c.id === t.courseId)?.name ?? ""} ${t.kind} ${t.status === "done" ? "terminé" : ""}`,
      icon: t.status === "done" ? <Check size={14} /> : <ListChecks size={14} />, hint: t.status === "done" || t.deadline === NO_DEADLINE ? undefined : fmtDate(t.deadline), run: () => setEditTask(t.id) })),
  ];
  const hour = new Date().getHours();
  const greet = hour < 6 ? "Bonne nuit" : hour < 18 ? "Bonjour" : "Bonsoir";
  const current = NAV.find((n) => n.key === view)!;
  const [headerRef, headerH] = useFixedHeader();
  // En-tête toujours visible et immobile (plus de masquage au défilement : plus stable sur iPhone).
  const headerHidden = false;
  // Tirer pour actualiser : données du compte, calendriers abonnés, notifications — sans recharger la page.
  const pullRefresh = useCallback(async () => {
    const jobs: Promise<unknown>[] = [env.refresh?.() ?? Promise.resolve()];
    if (env.fetchCalendar) for (const f of stateRef.current.settings.feeds ?? []) jobs.push(syncFeed(f, env.fetchCalendar, dispatch).catch(() => {}));
    dispatch({ type: "recurring/sync", today: todayISO() });
    await Promise.all(jobs);
    toast(navigator.onLine ? "À jour" : "Hors ligne : affichage des données de l'appareil", navigator.onLine ? "ok" : "info");
  }, [env, dispatch]);
  const navItems = NAV.filter((n) => !state.settings.hiddenViews.includes(n.key));

  if (!state.settings.onboarded && !override) return (
    <StoreCtx.Provider value={ctx}>
      <style>{accentCss(state.settings.accent)}</style>
      <Onboarding onDone={(s) => { dispatch({ type: "replace", state: s }); setView("dashboard"); toast(`Bienvenue ${s.settings.name} ! Commencez par ajouter vos cours dans Académique et Planning.`); }} />
      <ToastStack toasts={toasts} />
    </StoreCtx.Provider>
  );

  return (
    <StoreCtx.Provider value={ctx}>
      <style>{accentCss(state.settings.accent)}</style>
      <div className="flex min-h-full bg-bg text-fg">
        <aside className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col overflow-y-auto p-3 md:flex lg:w-60 2xl:w-64" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
          <div className="mb-6 flex items-center gap-2.5 px-1 pt-2 lg:px-2"><div className="sticker grid h-9 w-9 place-items-center rounded-xl border-2 border-fg bg-pink text-white shadow-[3px_3px_0_0_rgb(var(--ink))]"><ListChecks size={17} /></div><span className="hidden font-display text-[19px] font-extrabold leading-none tracking-tight lg:inline">Étudiant<span className="text-accent">.</span>OS</span></div>
          <nav className="relative flex flex-col gap-0.5">
            <span aria-hidden className="absolute inset-x-0 top-0 h-10 rounded-xl border-2 border-fg bg-hi shadow-[3px_3px_0_0_rgb(var(--ink))] transition-transform duration-500 [transition-timing-function:var(--spring)]"
              style={{ transform: `translateY(${Math.max(0, navItems.findIndex((n) => n.key === view)) * 42}px) rotate(-1deg)`, opacity: !override && navItems.some((n) => n.key === view) ? 1 : 0 }} />
            {navItems.map((n) => (<button key={n.key} onClick={() => setView(n.key)} title={n.label} aria-label={n.label} className={cx("nav-item group relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-[13px] transition-colors duration-300", view === n.key && !override ? "font-bold text-[rgb(24_22_46)]" : "text-muted hover:text-fg")}>
              <span className="grid w-full place-items-center lg:w-auto"><n.icon size={17} /></span><span className="hidden flex-1 text-left lg:inline">{n.label}</span><span className="hidden font-mono text-[10px] text-muted opacity-0 group-hover:opacity-100 lg:inline">{n.short}</span></button>))}
          </nav>
          <div className="mt-auto flex flex-col gap-2">
            <div className="inked hidden rounded-2xl bg-panel p-3 lg:block"><p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Charge du jour</p><LoadMeter load={plan.load} level={plan.level} /></div>
            <button onClick={() => setPalette(true)} aria-label="Rechercher" className="flex items-center justify-center gap-2 lg:justify-start rounded-xl border border-line bg-panel px-2.5 py-1.5 text-xs text-muted hover:text-fg"><Search size={13} /><span className="hidden flex-1 text-left lg:inline">Rechercher</span><span className="hidden lg:inline"><Kbd>Ctrl K</Kbd></span></button>
            {menuExtra && <div className="hidden lg:block">{menuExtra}</div>}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header ref={headerRef} className={cx("relative z-30 border-b-2 border-dashed border-line bg-bg md:sticky md:top-0 md:z-20", headerHidden && "-translate-y-full")} style={{ paddingTop: "var(--safe-top)", backgroundColor: "rgb(var(--bg))" }}>
            <div className="mx-auto flex max-w-6xl 2xl:max-w-[1560px] min-[2200px]:max-w-[1880px] flex-wrap items-center gap-x-1.5 gap-y-2 py-3 px-4 sm:flex-nowrap sm:gap-3 sm:px-6">
              <div className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-0"><p className="truncate text-xs text-muted">{greet} {state.settings.name}<span className="hidden min-[400px]:inline"> · {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span></p>
                <h1 className="truncate pb-0.5 font-display text-[18px] min-[400px]:text-[20px] sm:text-[26px] font-extrabold leading-tight tracking-tight"><span key={override?.key ?? view} className="marker">{override?.title ?? current.label}<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h1></div>
              {headerExtra}
              <span className="hidden lg:inline-flex"><Pill tone={levelTone(plan.level)}>Journée {plan.level}</Pill></span>
              <Btn variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setHelp(true)} aria-label="Raccourcis"><Keyboard size={15} /></Btn>
              <span className="mr-auto flex items-center gap-1.5 sm:mr-0"><StreakChip /></span>
              <LangSwitch className="px-1.5 sm:px-2" />
              <Btn variant="ghost" size="sm" onClick={toggleTheme} aria-label="Changer de thème" className="hidden sm:inline-flex">{isDark ? <Sun size={15} /> : <Moon size={15} />}</Btn>
              <Btn variant="primary" size="sm" onClick={() => setNewTask(true)} aria-label="Nouvelle tâche"><Plus size={14} /><span className="hidden sm:inline">Tâche</span></Btn>
              <div className="relative md:hidden">
                <Btn variant="soft" size="sm" aria-label="Menu" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)} className={cx(menu && "bg-hi/60")}><MoreVertical size={18} strokeWidth={3} /></Btn>
                {menu && <MobileMenu items={navItems} view={override ? ("" as ViewKey) : view} plan={plan} onPick={(k) => { setMenu(false); setView(k); }} onSearch={() => { setMenu(false); setPalette(true); }} onTheme={toggleTheme} isDark={isDark} onClose={() => setMenu(false)} extra={menuExtra} />}
              </div>
            </div>
          </header>
          <main key={override?.key ?? view} className="page stagger mx-auto w-full max-w-6xl 2xl:max-w-[1560px] min-[2200px]:max-w-[1880px] flex-1 px-4 pb-10 pt-5 sm:px-6 md:pb-8">
            {override ? override.node : <>
            {view === "dashboard" && <Dashboard go={setView} openNewTask={() => setNewTask(true)} />}
            {view === "planning" && <Planning />}
            {view === "academic" && <Academic openNewTask={() => setNewTask(true)} />}
            {view === "focus" && <Focus />}
            {view === "groceries" && <Groceries />}
            {view === "budget" && <BudgetView />}
            {view === "chores" && <Chores />}
            {view === "routines" && <Routines />}
            {view === "todos" && <Perso />}
            {view === "sleep" && <Sleep />}
            {view === "settings" && <SettingsView />}
            </>}
          </main>
        </div>
      </div>

      <PullToRefresh onRefresh={pullRefresh} top={headerH} />
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {newTask && <Modal title="Nouvelle tâche" onClose={() => setNewTask(false)}><TaskForm onDone={() => setNewTask(false)} /></Modal>}
      {editTask && state.tasks.some((t) => t.id === editTask) && <Modal title="Modifier la tâche" onClose={() => setEditTask(null)}><TaskForm task={state.tasks.find((t) => t.id === editTask)} onDone={() => setEditTask(null)} /></Modal>}
      {help && (
        <Modal title="Raccourcis clavier" onClose={() => setHelp(false)}>
          <ul className="grid gap-2 text-[13px] sm:grid-cols-2">
            {[["Ctrl / ⌘ K", "Palette de commandes"], ["1 – 9", "Changer de module"], ["N", "Nouvelle tâche"], ["T", "Thème clair / sombre"], ["Espace", "Démarrer / pause (Focus)"], ["?", "Afficher cette aide"], ["Échap", "Fermer une fenêtre"]].map(([k, l]) => (
              <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2"><span>{l}</span><Kbd>{k}</Kbd></li>))}
          </ul>
        </Modal>
      )}
      <ToastStack toasts={toasts} />
    </StoreCtx.Provider>
  );
}
