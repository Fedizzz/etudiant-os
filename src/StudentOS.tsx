import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MiniPdf } from "./pdf.ts";
import { DAY_WORDS, dayOf, pageGeometry, parseGrid } from "./timetable.ts";
import { BACKUP_KEY, CORRUPT_KEY, DAYS, DAYS_LONG, OVERDUE_SPREAD, STORAGE_KEY, addDays, bedtimeOptions, blank, budgetStats, choreAssignee, choreHistory, choreScheduledOn, cx, daysBetween, fmtDate, fmtDur, focusStats, iso, isoWeek, lastNDays, loadState, money, monthKey, norm, pad, parseAmount, parseISO, parseReceipt, phaseSeconds, planFor, planRange, reducer, seed, sleepMinutes, sleepStats, timerLeft, toHHMM, toMin, todayISO, uid, validateState, weekday } from "./core.ts";
import type { Action, Aisle, AppState, Block, Budget, Course, DayPlan, Expense, ExpenseCat, GroceryTemplate, ID, Phase, PomodoroCfg, Priority, ReceiptResult, Recurrence, EventRecurrence, SettingsState, SleepLog, Task, TaskKind, TaskStatus, TemplateItem, ViewKey } from "./core.ts";
import type { AppEnv } from "./env.ts";

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

const TaskForm: React.FC<{ onDone: () => void; task?: Task }> = ({ onDone, task }) => {
  const { state, dispatch, toast } = useStore();
  const [f, setF] = useState(task
    ? { title: task.title, courseId: task.courseId ?? "", kind: task.kind, deadline: task.deadline, estimate: task.estimate, priority: task.priority, spent: task.spent }
    : { title: "", courseId: state.courses[0]?.id ?? "", kind: "devoir" as TaskKind, deadline: iso(addDays(new Date(), 3)), estimate: 120, priority: 2 as Priority, spent: 0 });
  const [mode, setMode] = useState<"duration" | "slot">(task?.slot ? "slot" : "duration");
  const [slot, setSlot] = useState(task?.slot ?? { date: todayISO(), start: "14:00", end: "16:00" });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) { toast("Donnez un titre à la tâche.", "bad"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deadline) || isNaN(parseISO(f.deadline).getTime())) { toast("Choisissez une date d'échéance valide.", "bad"); return; }
    let estimate = f.estimate, chosen: Task["slot"] | undefined;
    if (mode === "slot") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) { toast("Choisissez le jour du créneau.", "bad"); return; }
      if (toMin(slot.end) <= toMin(slot.start)) { toast("L'heure de fin doit suivre l'heure de début.", "bad"); return; }
      chosen = slot; estimate = toMin(slot.end) - toMin(slot.start);
    } else if (!(f.estimate >= 5)) { toast("L'estimation doit être d'au moins 5 minutes.", "bad"); return; }
    if (!(f.spent >= 0)) { toast("Le temps passé ne peut pas être négatif.", "bad"); return; }
    if (!task && f.deadline < todayISO()) toast("Échéance déjà passée : la tâche apparaîtra en retard.", "info");
    const data = { ...f, estimate, title: f.title.trim(), courseId: f.courseId || null, slot: chosen };
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
        <option value="devoir">Devoir</option><option value="examen">Examen</option><option value="projet">Projet</option></Select></Field>
      <Field label="Priorité" htmlFor="tf-prio"><Select id="tf-prio" value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) as Priority })}>
        <option value={1}>Basse</option><option value={2}>Normale</option><option value={3}>Haute</option></Select></Field>
      <Field label="Échéance" htmlFor="tf-dl" className="col-span-2"><Input id="tf-dl" type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
      <TimeMode id="tf-mode" value={mode} onChange={setMode} className="col-span-2" />
      {mode === "duration" ? <>
        <Field label="Durée estimée (min)" htmlFor="tf-est" className="col-span-2"><Input id="tf-est" type="number" min={15} step={15} value={f.estimate} onChange={(e) => setF({ ...f, estimate: Math.max(15, Number(e.target.value)) })} /></Field>
        <p className="col-span-2 self-end pb-2 text-[11px] text-muted">Répartie automatiquement dans vos créneaux libres avant l'échéance.</p>
      </> : <>
        <Field label="Jour" htmlFor="tf-sday" className="col-span-2"><Input id="tf-sday" type="date" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} /></Field>
        <Field label="Début" htmlFor="tf-sstart"><Input id="tf-sstart" type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} /></Field>
        <Field label="Fin" htmlFor="tf-send"><Input id="tf-send" type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} /></Field>
      </>}
      {task && <Field label="Temps déjà passé (min)" htmlFor="tf-spent" className="col-span-2"><Input id="tf-spent" type="number" min={0} step={5} value={f.spent} onChange={(e) => setF({ ...f, spent: Math.max(0, Number(e.target.value)) })} /></Field>}
      <div className="col-span-2 flex justify-end gap-2 sm:col-span-4"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary">{task ? <><Check size={14} />Enregistrer</> : <><Plus size={14} />Ajouter</>}</Btn></div>
    </form>
  );
};

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-[2px] animate-fade sm:items-start sm:px-4 sm:pt-[12vh]" onMouseDown={onClose}>
      <div className="inked sheet max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-t-[22px] bg-panel animate-pop sm:max-h-[80vh] sm:rounded-[22px]" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3"><h2 className="font-display text-lg font-bold">{title}</h2><Btn variant="ghost" size="sm" onClick={onClose} aria-label="Fermer"><X size={14} /></Btn></header>
        <div className="p-5">{children}</div>
      </div>
    </div>
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
    for (const b of d.blocks) {
      if (b.kind === "sleep") continue;
      const y = top + ((b.start - minH * 60) / 60) * rowH; if (y + 1 > H - M) continue;
      const h = Math.min(Math.max(3.4, ((b.end - b.start) / 60) * rowH - 0.4), H - M - y);
      const rgb = (b.kind === "class" || b.kind === "task" ? hexRgb(b.color) : null) ?? KIND_RGB[b.kind];
      doc.rect(x + 0.6, y + 0.2, colW - 1.2, h, rgb.map((c) => Math.round(c + (255 - c) * 0.82)) as [number, number, number], rgb, 0.2);
      doc.rect(x + 0.6, y + 0.2, 1, h, rgb);
      const label = doc.wrap(b.label, colW - 4.5, 6.5);
      const lines = h >= 7 ? [`${toHHMM(b.start)}-${toHHMM(b.end)}`, ...label] : [`${toHHMM(b.start)} ${label[0] ?? ""}`];
      lines.slice(0, Math.max(1, Math.floor((h - 0.6) / 2.6))).forEach((l, k) => doc.text(x + 2.4, y + 2.9 + k * 2.6, l, 6.5, k === 0 && h >= 7 ? muted : ink, { bold: k === 1 }));
    }
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
type Tess = { recognize: (img: File, lang: string, o?: { logger?: (m: { status: string; progress: number }) => void }) => Promise<{ data: { text: string } }> };
async function tesseract(): Promise<Tess> {
  await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js");
  return (window as unknown as { Tesseract: Tess }).Tesseract;
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
const ReceiptScanner: React.FC<{ onResult: (r: ReceiptResult) => void; label?: string; className?: string }> = ({ onResult, label = "Scanner un ticket", className }) => {
  const { toast } = useStore();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const run = async (file: File) => {
    setBusy(0);
    try {
      const T = await tesseract();
      const { data } = await T.recognize(file, "fra", { logger: (m) => m.status === "recognizing text" && setBusy(Math.round(m.progress * 100)) });
      const r = parseReceipt(data.text);
      onResult(r);
      toast(r.amount ? `Ticket lu : ${r.amount.toFixed(2).replace(".", ",")}${r.store ? ` · ${r.store}` : ""}. Vérifiez puis validez.` : "Montant introuvable sur la photo. Saisissez-le à la main.", r.amount ? "ok" : "info");
    } catch {
      toast("Lecture impossible ici. Elle fonctionne sur le site en ligne (connexion requise la première fois).", "bad");
    } finally { setBusy(null); }
  };
  return (
    <>
      <Btn type="button" className={className} disabled={busy !== null} onClick={() => ref.current?.click()}>
        <Camera size={15} />{busy !== null ? `Lecture du ticket… ${busy} %` : label}
      </Btn>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }} />
    </>
  );
};

// ---------------------------------------------------------------- Module : Tableau de bord
const Dashboard: React.FC<{ go: (v: ViewKey) => void; openNewTask: () => void }> = ({ go, openNewTask }) => {
  const { state, dispatch, toast, openTask } = useStore();
  const today = todayISO();
  const cur = state.settings.currency;
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
  const bs = budgetStats(state.budget, monthKey(today), today, CATS);
  const open = state.tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => t.deadline < today).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const doneWeek = state.tasks.filter((t) => t.doneAt && daysBetween(t.doneAt, today) < 7).length;
  const upcoming = open.filter((t) => t.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline) || b.priority - a.priority).slice(0, 5);
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
  return (
    <div className="flex flex-col gap-4">
      {stepsLeft > 0 && (
        <Card title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-accent" />Pour bien démarrer · {steps.length - stepsLeft}/{steps.length}</span>}>
          <div className="mb-3 h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((steps.length - stepsLeft) / steps.length) * 100}%` }} /></div>
          <ul className="grid gap-2 sm:grid-cols-2">{steps.map((x) => (
            <li key={x.label}><button onClick={x.run} disabled={x.done} className={cx("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] transition", x.done ? "border-transparent text-muted line-through" : "border-line hover:border-accent hover:bg-accent/5")}>
              <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border", x.done ? "border-ok bg-ok text-onaccent" : "border-line")}>{x.done && <Check size={11} strokeWidth={3} />}</span>{x.label}{!x.done && <ChevronRight size={14} className="ml-auto text-muted" />}</button></li>))}</ul>
        </Card>)}
      {plan.level === "surcharge" && (
        <div className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/8 p-4 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" />
          <div className="min-w-0"><p className="font-semibold text-bad">Risque de surcharge aujourd'hui ({Math.round(plan.load * 100)} %)</p>
            <p className="text-muted">{plan.overflow.length ? `${fmtDur(plan.overflow.reduce((n, o) => n + o.minutes, 0))} de travail ne tient pas dans la journée. ` : ""}Repoussez une échéance ou découpez une tâche.</p></div>
          <Btn size="sm" className="ml-auto shrink-0" onClick={() => go("planning")}>Voir le planning</Btn>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-6 md:[&>*]:col-span-2 md:[&>*:nth-child(n+4)]:col-span-3 xl:grid-cols-5 xl:[&>*]:col-span-1 xl:[&>*:nth-child(n+4)]:col-span-1">
        <button onClick={() => go("focus")} className="text-left"><Stat label="Focus · 7 jours" value={fmtDur(fs.week)} sub={delta === null ? (fs.week ? "pas de semaine précédente" : "aucune session") : `${delta >= 0 ? "+" : ""}${delta} % vs semaine précédente`} tone={delta === null ? undefined : delta >= 0 ? "ok" : "warn"} /></button>
        <button onClick={() => go("academic")} className="text-left"><Stat label="Terminées · 7 j" value={String(doneWeek)} sub={`${open.length} ouvertes · ${late.length} en retard`} tone={late.length ? "bad" : undefined} /></button>
        <button onClick={() => go("sleep")} className="text-left"><Stat label="Sommeil · 7 jours" value={ss.avg7 === null ? "—" : fmtDur(ss.avg7)} sub={ss.nights7 ? `moyenne sur ${ss.nights7} nuit${ss.nights7 > 1 ? "s" : ""} · dette ${ss.debt7 > 0 ? fmtDur(ss.debt7) : "0"}` : "aucune nuit saisie"} tone={debtTone} /></button>
        <button onClick={() => go("chores")} className="text-left"><Stat label="Ménage aujourd'hui" value={chores.length ? `${chores.length - choresLeft.length}/${chores.length}` : "—"} sub={!chores.length ? "aucune corvée prévue" : choresLeft.length ? (solo ? `${choresLeft.length} à faire` : `${myLeft ? `${myLeft} pour vous` : "rien pour vous"} · ${choresLeft.length} à faire`) : "tout est fait"} tone={!chores.length ? undefined : choresLeft.length ? (lateChores ? "warn" : undefined) : "ok"} /></button>
        <button onClick={() => go("budget")} className="text-left min-[360px]:col-span-2"><Stat label="Budget restant" value={money(bs.remaining, cur)} sub={`${money(bs.spent, cur)} dépensés ce mois${bs.overCats.length ? ` · ${bs.overCats.length} plafond${bs.overCats.length > 1 ? "s" : ""} dépassé${bs.overCats.length > 1 ? "s" : ""}` : ""}`} tone={bs.remaining < 0 || bs.overCats.length ? "bad" : bs.remaining < state.budget.monthly * 0.15 ? "warn" : "ok"} /></button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                  <span className="font-mono text-xs tabular-nums text-muted">{fmtDur(minutes)}<span className="hidden sm:inline"> prévus</span></span>
                  <Btn size="sm" onClick={() => startFocus(t)} aria-label={`Lancer le focus sur ${t.title}`}><Play size={12} /><span className="hidden sm:inline">Focus</span></Btn>
                  <Btn size="sm" variant="ghost" onClick={() => finish(t)} aria-label="Marquer terminé"><Check size={13} /></Btn>
                </li>); })}
            </ul>
          ) : <Empty icon={<Check size={18} />} title={open.length ? "Rien de planifié aujourd'hui" : "Aucune tâche ouverte"} hint={open.length ? "Vos tâches sont réparties sur les jours suivants." : "Ajoutez un devoir, un projet ou un examen : il sera réparti dans vos créneaux libres."} action={!open.length ? <Btn variant="primary" onClick={openNewTask}><Plus size={14} />Nouvelle tâche</Btn> : undefined} />}
        </Card>
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
        <Card title="Temps de focus" action={<Pill tone="info">7 derniers jours</Pill>}>
          {fs.week ? <>
            <BarChart data={fs.byDay.map((d) => ({ label: DAYS[weekday(parseISO(d.date))], value: d.minutes / 60, tone: "accent" }))} goal={state.settings.focusGoal / 60} unit={(v) => `${v.toFixed(v < 10 && v % 1 ? 1 : 0)}h`} height={120} />
            <p className="mt-2 text-xs text-muted">Pointillés : objectif de {fmtDur(state.settings.focusGoal)} par jour (Réglages).</p></>
            : <Empty icon={<Timer size={18} />} title="Aucune session cette semaine" hint="Le graphique se remplit avec vos sessions du minuteur." action={<Btn onClick={() => go("focus")}><Play size={13} />Lancer le minuteur</Btn>} />}
        </Card>
        <Card title="Sommeil" action={<Btn size="sm" variant="ghost" onClick={() => go("sleep")}>Détails</Btn>}>
          {ss.nights7 ? <>
            <BarChart data={lastNDays(7).map((d) => { const l = state.sleep.find((x) => x.date === d); const h = l ? sleepMinutes(l.bed, l.wake) / 60 : 0;
              return { label: DAYS[weekday(parseISO(d))], value: h, missing: !l, tone: h >= state.settings.sleepGoal - 0.25 ? "ok" : h >= state.settings.sleepGoal - 1.25 ? "warn" : "bad" }; })} goal={state.settings.sleepGoal} max={10} unit={(v) => `${Math.round(v)}h`} height={120} />
            <p className="mt-2 text-xs text-muted">Tiret : nuit non saisie (non comptée).</p></>
            : <Empty icon={<Moon size={18} />} title="Aucune nuit cette semaine" hint="Enregistrez vos heures de coucher et de réveil pour suivre votre régularité." action={<Btn onClick={() => go("sleep")}>Enregistrer une nuit</Btn>} />}
        </Card>
        <Card title="Charge des 7 prochains jours" action={<Btn size="sm" variant="ghost" onClick={() => go("planning")}>Planning</Btn>}>
          <div className="flex flex-col gap-2.5">
            {days7.map((p) => (<div key={p.date} className="grid grid-cols-[52px_1fr] items-center gap-2"><span className="text-xs text-muted">{DAYS[weekday(parseISO(p.date))]} {parseISO(p.date).getDate()}</span><LoadMeter load={p.load} level={p.level} /></div>))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Cours, indisponibilités, tâches et corvées ; le travail planifié un jour n'est pas recompté les jours suivants.</p>
        </Card>
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
        <Card title={<span className="flex items-center gap-2"><Home size={15} />Ménage du jour</span>} className="md:col-span-2 xl:col-span-1" action={<Btn size="sm" variant="ghost" onClick={() => go("chores")}>Tout voir</Btn>}>
          {chores.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {chores.map(({ c, who, done, skipped }) => (
                <li key={c.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 text-[13px]">
                  <button onClick={() => { if (skipped) return; dispatch({ type: "chore/toggle", id: c.id, date: today, who }); if (!done) toast(solo ? `${c.name} : faite` : `${c.name} : fait par ${who}`); }} disabled={skipped}
                    aria-label={done ? `Annuler ${c.name}` : `Marquer ${c.name} comme faite`}
                    className={cx("grid h-5 w-5 shrink-0 place-items-center rounded border-2 transition", done ? "border-fg bg-hi text-[rgb(24_22_46)]" : "border-fg/40 hover:border-accent", skipped && "opacity-40")}>{done && <Check className="tick" size={11} strokeWidth={3} />}</button>
                  <span className={cx("min-w-0 flex-1 truncate", (done || skipped) && "text-muted line-through")}>{c.name}</span>
                  {c.time && <span className="font-mono text-[11px] text-muted">{c.time}</span>}
                  {!solo && <Pill tone={who === "Moi" ? "info" : "muted"}>{who}</Pill>}
                  {!done && !skipped && <Btn size="sm" variant="ghost" title="Reporter" aria-label={`Reporter ${c.name}`} onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: today }); toast(`${c.name} reportée`, "info"); }}>↷</Btn>}
                  {skipped && <span className="text-[11px] text-muted">reportée</span>}
                </li>))}
            </ul>
          ) : <Empty icon={<Home size={18} />} title={state.chores.length ? "Rien aujourd'hui" : "Aucune corvée"} hint={state.chores.length ? "Aucune corvée n'est prévue aujourd'hui dans la rotation." : solo ? "Créez vos corvées dans Ménage." : "Créez vos corvées et la rotation entre colocataires dans Ménage."} action={!state.chores.length ? <Btn onClick={() => go("chores")}><Plus size={13} />Créer une corvée</Btn> : undefined} />}
          {lateChores > 0 && <p className="mt-2 text-[11px] text-warn">{lateChores} corvée{lateChores > 1 ? "s" : ""} non faite{lateChores > 1 ? "s" : ""} ces 3 derniers jours.</p>}
        </Card>
      </div>
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
    const palette = ["#2f6fed", "#0f9d76", "#d9822b", "#c2417a", "#7a5af5", "#1d9bb5", "#b5651d"];
    const newCourses: Course[] = [];
    const courseFor = (title: string) => {
      const k = norm(title);
      // Même module seulement si le nom correspond (pas le code : « Introducción al Álgebra » ≠ « Introducción al Cálculo »).
      const all = [...state.courses, ...newCourses];
      const hit = all.find((c) => norm(c.name) === k) ?? all.find((c) => norm(c.name).length > 6 && (k.startsWith(norm(c.name)) || norm(c.name).startsWith(k)) && Math.abs(norm(c.name).length - k.length) < 4);
      if (hit) return hit.id;
      const words = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^A-Za-z0-9]+/).filter((w) => w.length > 2);
      let code = (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? title).slice(0, 5)).toUpperCase().slice(0, 6);
      for (let n = 2; all.some((c) => c.code === code); n++) code = code.replace(/\d+$/, "") + n;
      const c: Course = { id: uid(), name: title, code, coef: 1, color: palette[(state.courses.length + newCourses.length) % palette.length], grades: [] };
      newCourses.push(c); return c.id;
    };
    // Le module est le même pour la théorie, les TP et les labos (« Cours (TP) » → « Cours »).
    const sessions = sel.map((r) => ({ id: uid(), courseId: courseFor(r.title.replace(/\s*\((?:TP|TD|Labo|Séminaire|Tutorat|Examen)\)$/, "")), day: r.day, start: r.start, end: r.end, room: r.room, ...(r.dates?.length ? { dates: r.dates } : {}) }));
    dispatch({ type: "class/addMany", sessions, courses: newCourses });
    toast(`${sessions.length} cours ajoutés${newCourses.length ? ` · ${newCourses.length} nouveaux modules` : ""}. Retrouvez-les dans Académique.`);
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
          <div className="mt-2 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setRows(null)}>Annuler</Btn><Btn variant="primary" onClick={importRows}><Check size={14} />Ajouter {rows.filter((r) => r.on).length} cours</Btn></div>
        </div>)}
      {viewing && <Modal title="Mon emploi du temps" onClose={() => setViewing(false)}><div ref={viewer} className="text-sm text-muted">Chargement du PDF…</div></Modal>}
    </Card>
  );
};

const Planning: React.FC = () => {
  const { state, dispatch, toast, openTask, undoable } = useStore();
  const [offset, setOffset] = useState(0);
  const today = todayISO();
  const date = iso(addDays(parseISO(today), offset));
  const plan = useMemo(() => planFor(state, date, today), [state, date, today]);
  // Semaine affichée : jours passés tels quels, jours à venir simulés depuis aujourd'hui (charge cohérente avec le tableau de bord).
  const week = useMemo(() => { const mon = iso(addDays(parseISO(date), -weekday(parseISO(date)))); return Array.from({ length: 7 }, (_, i) => planFor(state, iso(addDays(parseISO(mon), i)), today)); }, [state, date, today]);
  const [unav, setUnav] = useState({ day: 0, start: "18:00", end: "21:00", label: "" });
  const [ev, setEv] = useState({ title: "", date: today, start: "18:00", end: "19:00", recurrence: "none" as EventRecurrence, until: "" });
  const upcomingEvents = [...(state.events ?? [])].filter((e) => e.recurrence !== "none" ? !e.until || e.until >= today : e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start));
  const startH = Math.floor(plan.wake / 60), endH = Math.ceil(Math.min(plan.bed, 1440 + 120) / 60);
  const PX = 52; // pixels par heure
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    setExporting(true);
    try { const r = await exportWeekPdf(week, state.settings.name); if (r === "downloaded") toast("PDF du planning téléchargé"); }
    catch { toast("Export PDF impossible : vérifiez votre connexion internet (le générateur PDF se charge à la première utilisation).", "bad"); }
    finally { setExporting(false); }
  };
  const [newClass, setNewClass] = useState({ courseId: state.courses[0]?.id ?? "", day: 0, start: "10:00", end: "12:00", room: "" });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={<span className="flex items-center gap-2"><CalendarClock size={15} />{DAYS_LONG[weekday(parseISO(date))]} {parseISO(date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>}
        action={<><Btn size="sm" variant="ghost" onClick={() => setOffset(offset - 1)} aria-label="Jour précédent"><ChevronLeft size={14} /></Btn><Btn size="sm" onClick={() => setOffset(0)}>Aujourd'hui</Btn><Btn size="sm" variant="ghost" onClick={() => setOffset(offset + 1)} aria-label="Jour suivant"><ChevronRight size={14} /></Btn></>}>
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
            <p className="mt-1 text-muted">Rien n'est déplacé automatiquement : modifiez l'emploi du temps ou vos indisponibilités ci-contre.</p>
          </div>)}
        {plan.past && <p className="mt-3 text-xs text-muted">Journée passée : seuls les cours et indisponibilités sont affichés.</p>}
        <div className="relative mt-4 overflow-hidden rounded-lg border border-line" style={{ height: (endH - startH) * PX }}>
          {Array.from({ length: endH - startH }, (_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * PX }}><span className="absolute left-2 top-0.5 font-mono text-[10px] text-muted">{pad((startH + i) % 24)}:00</span></div>
          ))}
          {offset === 0 && nowMin > startH * 60 && nowMin < endH * 60 && (
            <div className="absolute inset-x-0 z-10 h-px bg-bad" style={{ top: ((nowMin - startH * 60) / 60) * PX }}><span className="absolute -left-0.5 -top-[3px] h-[7px] w-[7px] rounded-full bg-bad" /></div>
          )}
          {plan.blocks.map((b, i) => (
            <div key={i} onClick={b.kind === "task" && b.refId ? () => openTask(b.refId!) : undefined} title={b.kind === "task" ? "Bloc suggéré · cliquer pour modifier la tâche" : undefined}
              className={cx("absolute left-14 right-2 overflow-hidden rounded-md px-2 py-1 text-xs transition hover:brightness-95", BLOCK_STYLE[b.kind], b.kind === "task" && "cursor-pointer")}
              style={{ top: ((b.start - startH * 60) / 60) * PX + 1, height: Math.max(18, ((b.end - b.start) / 60) * PX - 2), borderLeftColor: b.color }}>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] tabular-nums text-muted">{toHHMM(b.start)}–{toHHMM(b.end)}</span>
                {b.kind === "task" && <Zap size={10} className="text-accent" />}{b.kind === "chore" && <Home size={10} className="text-warn" />}{b.kind === "meal" && <Coffee size={10} />}{b.kind === "event" && <CalendarClock size={10} className="text-pink" />}
                {b.kind === "event" && b.refId && <button className="ml-auto rounded px-1 text-[10px] text-muted hover:bg-sunken hover:text-bad" aria-label={`Retirer ${b.label} ce jour-là`} title="Retirer cette occurrence"
                  onClick={(e) => { e.stopPropagation(); const evt = state.events.find((x) => x.id === b.refId); if (!evt) return;
                    if (evt.recurrence === "none") undoable({ type: "event/remove", id: evt.id }, `« ${evt.title} » supprimé`); else undoable({ type: "event/skip", id: evt.id, date }, `« ${evt.title} » retiré ce jour-là`); }}>✕</button>}
              </div>
              <p className="truncate font-medium text-fg">{b.label}</p>
            </div>
          ))}
        </div>
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
const KIND_LABEL: Record<TaskKind, string> = { devoir: "Devoir", examen: "Examen", projet: "Projet" };

const Academic: React.FC<{ openNewTask: () => void }> = ({ openNewTask }) => {
  const { state, dispatch, toast, undoable, openTask } = useStore();
  const [filter, setFilter] = useState<string>("");
  const [dragId, setDragId] = useState<ID | null>(null);
  const [courseForm, setCourseForm] = useState({ name: "", code: "", coef: 1 });
  const today = todayISO();
  const tasks = state.tasks.filter((t) => !filter || t.courseId === filter);
  const move = (t: Task, dir: 1 | -1) => { const i = ORDER.indexOf(t.status) + dir; if (i < 0 || i >= ORDER.length) return; dispatch({ type: "task/update", id: t.id, patch: { status: ORDER[i] } }); if (ORDER[i] === "done") toast(`« ${t.title} » terminé`); };
  const palette = ["#2f6fed", "#0f9d76", "#d9822b", "#c2417a", "#7a5af5", "#1d9bb5", "#b5651d"];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
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
                  <div className="mt-2 h-1 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                    <span className="font-mono tabular-nums">{fmtDur(t.spent)} / {fmtDur(t.estimate)}</span>
                    <span className={cx("ml-auto", s !== "done" && left < 0 && "font-semibold text-bad", s !== "done" && left >= 0 && left <= 2 && "text-warn")}>{fmtDate(t.deadline)}</span>
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
  const checkout = () => {
    const amount = paid.trim() ? parseAmount(paid) : cartTotal;
    if (!(amount > 0)) { toast("Indiquez le montant payé (ou des prix sur les articles cochés).", "bad"); return; }
    dispatch({ type: "grocery/checkout", amount, date: todayISO() }); setPaid("");
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
              <ReceiptScanner label="Scanner le ticket" onResult={(r) => r.amount && setPaid(r.amount.toFixed(2).replace(".", ","))} />
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
const CAT_COLOR: Record<ExpenseCat, string> = {
  Courses: "#10a37f", Restauration: "#e0802a", Logement: "#5b6b8c", Transport: "#2b8bd6", Études: "#6d5bd0", Loisirs: "#d6457a", Santé: "#1aa3a3", Autre: "#8a8f98",
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
  const bs = budgetStats(state.budget, mk, today, CATS);
  const { spent, remaining, dim, elapsed, projection, perDayLeft, daily } = bs;
  const byCat = bs.byCat.filter((x) => x.spent > 0 || x.limit).map((x) => ({ c: x.cat, v: x.spent, lim: x.limit }));
  const [f, setF] = useState({ label: "", amount: "", category: "Courses" as ExpenseCat, date: today, source: "manuel" as Expense["source"] });
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
    lastAdd.current = { key, at: Date.now() };
    dispatch({ type: "expense/add", expense: { id: uid(), date: f.date, amount, category: f.category, label: f.label.trim() || f.category, source: f.source } });
    const lim = state.budget.limits[f.category];
    const catSpent = bs.byCat.find((x) => x.cat === f.category)?.spent ?? 0;
    if (monthKey(f.date) === mk && lim && catSpent <= lim && catSpent + amount > lim) toast(`${money(amount, cur)} ajoutés · plafond ${f.category} dépassé (${money(catSpent + amount, cur)} / ${money(lim, cur)})`, "bad");
    else toast(`${money(amount, cur)} ajoutés en ${f.category}`);
    setF({ ...f, label: "", amount: "", source: "manuel" });
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
        <Stat label="Restant" value={money(remaining, cur)} sub={perDayLeft !== null ? `${money(Math.max(0, perDayLeft), cur)} / jour d'ici la fin du mois${bs.recurringPlanned > bs.recurringPaid ? " (récurrentes à venir déduites)" : ""}` : undefined} tone={remaining < 0 ? "bad" : "ok"} />
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
          <Card title="Nouvelle dépense">
            <ReceiptScanner className="mb-3 w-full" onResult={(r) => setF({ ...f, amount: r.amount ? r.amount.toFixed(2).replace(".", ",") : f.amount, date: r.date && r.date <= today ? r.date : f.date, label: r.store || "Ticket de caisse", category: "Courses", source: "ticket" })} />
            <form onSubmit={add} className="grid grid-cols-2 gap-2">
              <Input id="bd-label" aria-label="Libellé" placeholder="Libellé (ex. Pharmacie)" className="col-span-2" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
              <Input id="bd-amount" aria-label="Montant" inputMode="decimal" placeholder={`Montant (${cur})`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <Select id="bd-cat" aria-label="Catégorie" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCat })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Input id="bd-date" aria-label="Date" type="date" className="col-span-2" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              <Btn type="submit" variant="primary" className="col-span-2"><Plus size={14} />Ajouter la dépense</Btn>
            </form>
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
              <Select id="rc-cat" aria-label="Catégorie" className="h-8 text-xs" value={rec.category} onChange={(e) => setRec({ ...rec, category: e.target.value as ExpenseCat })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Input id="rc-day" aria-label="Jour du mois" type="number" min={1} max={31} className="h-8 text-xs" value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })} />
              <Btn type="submit" size="sm" className="col-span-2"><Plus size={12} />Ajouter</Btn>
            </form>
            <p className="mt-2 text-[11px] text-muted">Une récurrente déjà payée ce mois n'est jamais ajoutée deux fois. Supprimer la ligne générée ne la recrée pas avant le mois suivant.</p>
          </Card>
          <Card title="Par catégorie" action={<Btn size="sm" variant="ghost" onClick={() => setEditLimits(!editLimits)}>{editLimits ? "Terminé" : "Plafonds"}</Btn>}>
            <div className="flex flex-col gap-3">
              {(editLimits ? CATS.map((c) => ({ c, v: exp.filter((e) => e.category === c).reduce((n, e) => n + e.amount, 0), lim: state.budget.limits[c] })) : byCat).map(({ c, v, lim }) => (
                <div key={c}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CAT_COLOR[c] }} />{c}</span>
                    {editLimits ? <Input id={`lim-${c}`} aria-label={`Plafond ${c}`} inputMode="decimal" placeholder="aucun" className="h-7 w-24 text-xs" defaultValue={lim ? String(lim) : ""}
                      onBlur={(e) => { const val = e.target.value.trim() ? parseAmount(e.target.value) : 0; const limits = { ...state.budget.limits }; if (val > 0) limits[c] = val; else delete limits[c]; dispatch({ type: "budget/set", patch: { limits } }); }} />
                      : <span className={cx("font-mono tabular-nums", lim && v > lim ? "text-bad" : "text-muted")}>{money(v, cur)}{lim ? ` / ${money(lim, cur)}` : ""}</span>}</div>
                  <div className="h-1.5 rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (v / (lim || Math.max(spent, 1))) * 100)}%`, background: lim && v > lim ? "rgb(var(--bad))" : CAT_COLOR[c] }} /></div>
                </div>))}
              {!editLimits && !byCat.length && <p className="text-xs text-muted">Les catégories apparaîtront avec vos premières dépenses.</p>}
            </div>
          </Card>
        </div>
      </div>
      {editing && <Modal title="Modifier la dépense" onClose={() => setEditing(null)}><ExpenseEdit e={editing} onDone={() => setEditing(null)} /></Modal>}
    </div>
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
      <Field label="Catégorie" htmlFor="ee-cat"><Select id="ee-cat" value={f.category} onChange={(x) => setF({ ...f, category: x.target.value as ExpenseCat })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
      <Field label="Date" htmlFor="ee-date" className="col-span-2"><Input id="ee-date" type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></Field>
      {e.recurringId && <p className="col-span-2 text-xs text-muted">Dépense récurrente : la modification ne concerne que ce mois-ci.</p>}
      <div className="col-span-2 flex justify-end gap-2"><Btn type="button" variant="ghost" onClick={onDone}>Annuler</Btn><Btn type="submit" variant="primary"><Check size={14} />Enregistrer</Btn></div>
    </form>
  );
};

// ---------------------------------------------------------------- Module : Ménage
const EVENT_REC_LABEL: Record<EventRecurrence, string> = { none: "Une seule fois", daily: "Tous les jours", weekly: "Chaque semaine", biweekly: "Toutes les 2 semaines", monthly: "Chaque mois" };
/** Personne d'autre que « Moi » : pas de colocataire et aucune corvée partagée. */
const isSolo = (s: AppState) => !s.settings.roommates.length && s.chores.every((c) => c.assignees.every((a) => a === "Moi"));
const REC_LABEL: Record<Recurrence, string> = { daily: "Quotidienne", weekly: "Hebdomadaire", biweekly: "Bimensuelle" };
const Chores: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const [offset, setOffset] = useState(0);
  const monday = addDays(new Date(), offset * 7 - weekday(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  // Sans colocataire (et sans corvée partagée), on masque tout ce qui concerne la rotation.
  const solo = isSolo(state);
  const [cmode, setCmode] = useState<"duration" | "slot">("duration");
  const [f, setF] = useState({ name: "", recurrence: "weekly" as Recurrence, day: 5, minutes: 20, time: "18:00", end: "18:30", assignees: ["Moi", ...state.settings.roommates].join(", ") });
  const people = Array.from(new Set(state.chores.flatMap((c) => c.assignees)));
  const minutesBy = people.map((p) => ({ p, min: state.chores.reduce((n, c) => n + days.filter((d) => choreScheduledOn(c, d) && choreAssignee(c, d) === p).length * c.minutes, 0) }));
  const maxMin = Math.max(1, ...minutesBy.map((x) => x.min));
  const today = todayISO();
  const history = useMemo(() => choreHistory(state.chores, people, today, 4), [state.chores, today, people.join("|")]);
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
                    <td className="pr-2"><p className="font-medium text-fg">{c.name}</p><p className="text-[11px] text-muted">{REC_LABEL[c.recurrence]}{c.time ? ` · ${c.time}–${toHHMM(toMin(c.time) + c.minutes)}` : ` · ${c.minutes} min`}</p></td>
                    {days.map((d) => { const on = choreScheduledOn(c, d); const k = iso(d); const done = c.done.includes(k); const skipped = (c.skipped ?? []).includes(k); const who = choreAssignee(c, d); const by = c.doneBy?.[k] ?? who; return (
                      <td key={k} className="relative text-center">{on ? (<>
                        {skipped ? (
                          <button onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: k }); toast("Report annulé", "info"); }} title="Reportée · cliquer pour annuler le report"
                            className="flex h-10 w-full flex-col items-center justify-center rounded-md border border-dashed border-line text-[10px] text-muted">reportée</button>
                        ) : <button onClick={() => { dispatch({ type: "chore/toggle", id: c.id, date: k, who }); if (!done) toast(solo ? `${c.name} : faite` : `${c.name} : fait par ${who}`); }} title={done ? `Faite par ${by} · cliquer pour annuler` : `À faire par ${who} · cliquer quand c'est fait`}
                          className={cx("flex h-10 w-full flex-col items-center justify-center rounded-md border text-[11px] transition", done ? "border-ok/40 bg-ok/12 text-ok" : k < today ? "border-bad/30 bg-bad/6 text-bad" : who === "Moi" ? "border-accent/40 bg-accent/8 text-fg" : "border-line bg-sunken text-fg hover:border-accent/50")}>
                          {done ? <><Check size={14} />{!solo && by !== who && <span className="text-[9px]">{by}</span>}</> : <span className="font-medium">{solo ? "à faire" : who}</span>}
                        </button>}
                        {!done && !skipped && k >= iso(addDays(parseISO(today), -7)) && <button aria-label={`Reporter ${c.name}`} title="Reporter (non faite, sans pénalité)" onClick={() => { dispatch({ type: "chore/skip", id: c.id, date: k }); toast(`${c.name} reportée`, "info"); }}
                          className="absolute right-1 top-1 rounded px-0.5 text-[9px] leading-none text-muted opacity-60 hover:text-fg hover:opacity-100">↷</button>}
                      </>) : <span className="block h-10 rounded-md bg-sunken/40" />}</td>); })}
                    <td><button className="p-1 text-muted opacity-0 hover:text-bad group-hover:opacity-100" aria-label="Supprimer la corvée" onClick={() => undoable({ type: "chore/remove", id: c.id }, `Corvée « ${c.name} » supprimée`)}><Trash2 size={12} /></button></td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
        {solo ? <p className="mt-2 text-xs text-muted">Cliquez une case quand la corvée est faite. Les corvées non faites sont ajoutées à votre planning du jour, à l'heure choisie ou dans un créneau libre. ↷ reporte une corvée sans la marquer faite.</p> :
        <p className="mt-2 text-xs text-muted">La rotation avance automatiquement : chaque jour pour les tâches quotidiennes, chaque semaine (ou toutes les deux semaines) pour les autres. Les cases « Moi » non faites sont injectées dans le planning du jour. ↷ reporte une corvée sans la marquer faite. Les données restent sur cet appareil (pas de partage entre colocataires).</p>}
      </Card>
      <div className={cx("grid grid-cols-1 gap-4 md:grid-cols-2", !solo && "xl:grid-cols-3")}>
        {!solo && <Card title={<span className="flex items-center gap-2"><Users size={15} />Répartition de la semaine</span>} action={<span className="text-[11px] text-muted">temps prévu</span>}>
          <div className="flex flex-col gap-3">{minutesBy.map(({ p, min }) => (
            <div key={p} className="grid grid-cols-[64px_1fr_56px] items-center gap-2 text-[13px]"><span className="truncate">{p}</span><div className="h-2 rounded-full bg-sunken"><div className="h-full rounded-full bg-accent" style={{ width: `${(min / maxMin) * 100}%` }} /></div><span className="text-right font-mono text-xs tabular-nums text-muted">{fmtDur(min)}</span></div>))}</div>
        </Card>}
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
            dispatch({ type: "chore/add", chore: { id: uid(), name: f.name.trim(), recurrence: f.recurrence, day: f.day, minutes, assignees, done: [], ...(cmode === "slot" ? { time: f.time } : {}) } }); setF({ ...f, name: "" }); toast(state.settings.roommates.length ? "Corvée ajoutée à la rotation" : "Corvée ajoutée"); }}>
            <Field label="Corvée" htmlFor="ch-name" className="col-span-2"><Input id="ch-name" placeholder="Ex. Nettoyer la plaque" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Récurrence" htmlFor="ch-rec"><Select id="ch-rec" value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as Recurrence })}>{(Object.keys(REC_LABEL) as Recurrence[]).map((r) => <option key={r} value={r}>{REC_LABEL[r]}</option>)}</Select></Field>
            <Field label="Jour" htmlFor="ch-day"><Select id="ch-day" value={f.day} disabled={f.recurrence === "daily"} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>{DAYS_LONG.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
            <TimeMode id="ch-mode" value={cmode} onChange={setCmode} className="col-span-2" />
            {cmode === "duration"
              ? <Field label="Durée (min)" htmlFor="ch-min" className="col-span-2"><Input id="ch-min" type="number" min={5} step={5} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /></Field>
              : <><Field label="Début" htmlFor="ch-time"><Input id="ch-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
                <Field label="Fin" htmlFor="ch-end"><Input id="ch-end" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field></>}
            {state.settings.roommates.length > 0 && <Field label="Rotation (séparée par des virgules)" htmlFor="ch-who" className="col-span-2"><Input id="ch-who" placeholder="Moi, Inès" value={f.assignees} onChange={(e) => setF({ ...f, assignees: e.target.value })} /></Field>}
            <p className="col-span-2 text-[11px] text-muted">{cmode === "duration" ? "La corvée est placée dans un créneau libre de votre planning." : "La corvée apparaît à cet horaire dans votre planning."}{!state.settings.roommates.length && " Ajoutez des colocataires dans Réglages pour activer la rotation."}</p>
            <Btn type="submit" variant="primary" className="col-span-2"><Plus size={14} />Ajouter</Btn>
          </form>
        </Card>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- Module : Sommeil
const Sleep: React.FC = () => {
  const { state, dispatch, toast, undoable } = useStore();
  const s = state.settings;
  const tomorrow = addDays(new Date(), 1);
  const firstClass = state.classes.filter((c) => c.day === weekday(tomorrow)).sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  const [manualWake, setManualWake] = useState("");
  const autoWake = firstClass ? toMin(firstClass.start) - s.prepMinutes : toMin(s.wakeDefault) + 60;
  const wake = manualWake ? toMin(manualWake) : autoWake;
  const opts = bedtimeOptions(wake, s.fallAsleep);
  const [log, setLog] = useState<SleepLog>({ date: todayISO(), bed: "23:30", wake: "07:30", quality: 3 });
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
    dispatch({ type: "sleep/upsert", log });
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
      <Card title="Enregistrer une nuit" className="md:col-span-2">
        <form className="flex flex-wrap items-end gap-3" onSubmit={save}>
          <Field label="Nuit se terminant le" htmlFor="sl-date"><Input id="sl-date" type="date" value={log.date} max={todayISO()} onChange={(e) => setLog({ ...log, date: e.target.value })} /></Field>
          <Field label="Coucher" htmlFor="sl-bed"><Input id="sl-bed" type="time" value={log.bed} onChange={(e) => setLog({ ...log, bed: e.target.value })} /></Field>
          <Field label="Réveil" htmlFor="sl-wk"><Input id="sl-wk" type="time" value={log.wake} onChange={(e) => setLog({ ...log, wake: e.target.value })} /></Field>
          <Field label="Qualité" htmlFor="sl-q"><Select id="sl-q" value={log.quality} onChange={(e) => setLog({ ...log, quality: Number(e.target.value) as SleepLog["quality"] })}>{[1, 2, 3, 4, 5].map((q) => <option key={q} value={q}>{"★".repeat(q)}</option>)}</Select></Field>
          <span className="pb-2 font-mono text-sm tabular-nums text-muted">= {fmtDur(dur)}{toMin(log.wake) <= toMin(log.bed) ? " (passage de minuit)" : ""}</span>
          <Btn type="submit" variant="primary"><Moon size={14} />{existing ? "Remplacer" : "Enregistrer"}</Btn>
          {existing && <span className="pb-2 text-xs text-warn">Une nuit existe déjà à cette date ({existing.bed} → {existing.wake}).</span>}
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]"><thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Coucher</th><th className="pb-2 font-medium">Réveil</th><th className="pb-2 font-medium">Durée</th><th className="pb-2 font-medium">Écart objectif</th><th className="pb-2 font-medium">Qualité</th><th /></tr></thead>
            <tbody className="divide-y divide-line">{[...state.sleep].reverse().slice(0, 10).map((l) => { const m = sleepMinutes(l.bed, l.wake); const diff = m - s.sleepGoal * 60; return (
              <tr key={l.date} className="group"><td className="py-1.5">{fmtDate(l.date)}</td><td className="font-mono tabular-nums">{l.bed}</td><td className="font-mono tabular-nums">{l.wake}</td><td className="font-mono tabular-nums">{fmtDur(m)}</td>
                <td className={cx("font-mono tabular-nums", diff < -60 ? "text-bad" : diff < 0 ? "text-warn" : "text-ok")}>{diff >= 0 ? "+" : "−"}{fmtDur(Math.abs(diff))}</td><td className="text-warn">{"★".repeat(l.quality)}</td>
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
    <Card title={<span className="flex items-center gap-2"><Palette size={15} />Personnalisation</span>} className="md:col-span-2 lg:col-span-2">
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
            <Select aria-label="Catégorie" className="h-8 text-xs" value={q.category} onChange={(e) => setQ({ ...q, category: e.target.value as ExpenseCat })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
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
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 72px)", right: "max(16px, env(safe-area-inset-right, 0px))", maxHeight: "calc(100dvh - 90px - env(safe-area-inset-top, 0px))" }}>
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
      icon: t.status === "done" ? <Check size={14} /> : <ListChecks size={14} />, hint: t.status === "done" ? undefined : fmtDate(t.deadline), run: () => setEditTask(t.id) })),
  ];
  const hour = new Date().getHours();
  const greet = hour < 6 ? "Bonne nuit" : hour < 18 ? "Bonjour" : "Bonsoir";
  const current = NAV.find((n) => n.key === view)!;
  const [headerRef, headerH] = useFixedHeader();
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
        <aside className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col overflow-y-auto p-3 md:flex lg:w-60 2xl:w-64">
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
          <div aria-hidden className="md:hidden" style={{ height: headerH }} />
          <header ref={headerRef} className="fixed inset-x-0 top-0 z-30 border-b-2 border-dashed border-line bg-bg/85 backdrop-blur-md md:sticky md:inset-x-auto md:z-20" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="mx-auto flex max-w-6xl 2xl:max-w-[1560px] min-[2200px]:max-w-[1880px] items-center gap-3 py-3 px-4 sm:px-6">
              <div className="min-w-0 flex-1"><p className="truncate text-xs text-muted">{greet} {state.settings.name}<span className="hidden min-[400px]:inline"> · {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span></p>
                <h1 className="truncate pb-0.5 font-display text-[19px] min-[400px]:text-[21px] sm:text-[26px] font-extrabold leading-tight tracking-tight"><span key={override?.key ?? view} className="marker">{override?.title ?? current.label}<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden><path d="M2 12 C 40 6, 80 16, 120 9 S 180 6, 198 11" /></svg></span></h1></div>
              {headerExtra}
              <span className="hidden lg:inline-flex"><Pill tone={levelTone(plan.level)}>Journée {plan.level}</Pill></span>
              <Btn variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setHelp(true)} aria-label="Raccourcis"><Keyboard size={15} /></Btn>
              <Btn variant="ghost" size="sm" onClick={toggleTheme} aria-label="Changer de thème" className="hidden min-[400px]:inline-flex">{isDark ? <Sun size={15} /> : <Moon size={15} />}</Btn>
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
            {view === "sleep" && <Sleep />}
            {view === "settings" && <SettingsView />}
            </>}
          </main>
        </div>
      </div>

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
