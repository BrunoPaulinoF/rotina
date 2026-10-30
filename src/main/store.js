'use strict';
/** Persistência local em JSON (gravação atômica) e normalização/validação da configuração. */

const fs = require('fs');
const path = require('path');
const { parseHM } = require('../shared/engine');
const { createDefaultConfig, createDefaultState } = require('./defaults');

class JsonStore {
  constructor(file) {
    this.file = file;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return null;
      // Remove o BOM que editores como o Bloco de Notas podem gravar.
      return JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      // Arquivo corrompido: guarda uma cópia para análise e recomeça dos padrões.
      try {
        fs.renameSync(this.file, this.file + '.corrompido-' + Date.now());
      } catch (_) { /* ignora */ }
      return null;
    }
  }

  save(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => String(v == null ? '' : v).slice(0, max || 300);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v, d, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
};
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FLOAT_POSITIONS = ['top-center', 'bottom-center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function slug(text) {
  return str(text, 40)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function uniqueId(base, used) {
  let id = slug(base);
  let n = 2;
  while (used.has(id)) id = slug(base) + '-' + n++;
  used.add(id);
  return id;
}

function normalizeActivity(a, catIds, used, isExtra) {
  if (!isObj(a)) return null;
  const start = parseHM(a.start);
  if (start == null) return null;
  const id = a.id && !used.has(String(a.id)) ? (used.add(String(a.id)), String(a.id)) : uniqueId(a.title || 'atividade', used);
  const days = Array.isArray(a.days) ? Array.from(new Set(a.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort() : [];
  const out = {
    id,
    title: str(a.title, 120).trim() || 'Atividade',
    subtitle: str(a.subtitle, 240).trim(),
    start: String(a.start).trim().padStart(5, '0'),
    duration: Math.round(num(a.duration, 30, 1, 1440)),
    days,
    category: catIds.has(a.category) ? a.category : 'basico',
    icon: str(a.icon, 30) || 'dot',
    priority: Math.round(num(a.priority, 0, 0, 100)),
    alertStart: bool(a.alertStart, true),
    alertAdvance: bool(a.alertAdvance, true),
    enabled: bool(a.enabled, true)
  };
  if (isExtra) delete out.days;
  else if (!out.days.length) return null;
  return out;
}

function normalizeConfig(input) {
  const def = createDefaultConfig();
  const src = isObj(input) ? input : {};

  const usedCat = new Set();
  let categories = Array.isArray(src.categories)
    ? src.categories.filter(isObj).map((c) => ({
      id: c.id && !usedCat.has(String(c.id)) ? (usedCat.add(String(c.id)), String(c.id)) : uniqueId(c.name || 'categoria', usedCat),
      name: str(c.name, 60).trim() || 'Categoria',
      color: COLOR_RE.test(c.color) ? c.color : '#7E93A8',
      icon: str(c.icon, 30) || 'dot'
    }))
    : def.categories;
  if (!categories.some((c) => c.id === 'basico')) categories.push(def.categories.find((c) => c.id === 'basico'));
  const catIds = new Set(categories.map((c) => c.id));

  const used = new Set();
  const activities = (Array.isArray(src.activities) ? src.activities : def.activities)
    .map((a) => normalizeActivity(a, catIds, used, false))
    .filter(Boolean);

  const weekly = [];
  for (let d = 0; d < 7; d++) {
    const w = (Array.isArray(src.weekly) && isObj(src.weekly[d])) ? src.weekly[d] : def.weekly[d];
    weekly.push({ casa: str(w.casa, 120), nota: str(w.nota, 160), projeto: str(w.projeto, 120) });
  }

  const seenDates = new Set();
  const exceptions = (Array.isArray(src.exceptions) ? src.exceptions : [])
    .filter((e) => isObj(e) && DATE_RE.test(e.date) && !seenDates.has(e.date) && seenDates.add(e.date))
    .map((e) => {
      const usedExtra = new Set(activities.map((a) => a.id));
      return {
        date: e.date,
        note: str(e.note, 160),
        off: bool(e.off, false),
        baseDay: Number.isInteger(e.baseDay) && e.baseDay >= 0 && e.baseDay <= 6 ? e.baseDay : null,
        removedIds: Array.isArray(e.removedIds) ? e.removedIds.map(String) : [],
        extra: (Array.isArray(e.extra) ? e.extra : []).map((a) => normalizeActivity(a, catIds, usedExtra, true)).filter(Boolean)
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const lists = {};
  for (const k of Object.keys(def.lists)) {
    const l = isObj(src.lists) && Array.isArray(src.lists[k]) ? src.lists[k] : def.lists[k];
    lists[k] = l.map((x) => str(x, 200).trim()).filter(Boolean);
  }

  const s = isObj(src.settings) ? src.settings : {};
  const sa = isObj(s.alerts) ? s.alerts : {};
  const sf = isObj(s.floating) ? s.floating : {};
  const sg = isObj(s.general) ? s.general : {};
  const da = def.settings.alerts;
  const df = def.settings.floating;
  const dg = def.settings.general;

  return {
    version: 1,
    categories,
    activities,
    weekly,
    exceptions,
    lists,
    meta: str(src.meta != null ? src.meta : def.meta, 80),
    settings: {
      alerts: {
        enabled: bool(sa.enabled, da.enabled),
        soundStart: str(sa.soundStart || da.soundStart, 30),
        soundAdvance: str(sa.soundAdvance || da.soundAdvance, 30),
        customSound: str(sa.customSound, 500),
        volume: num(sa.volume, da.volume, 0, 1),
        advanceEnabled: bool(sa.advanceEnabled, da.advanceEnabled),
        advanceMinutes: Math.round(num(sa.advanceMinutes, da.advanceMinutes, 1, 120)),
        windowsNotification: bool(sa.windowsNotification, da.windowsNotification),
        popup: bool(sa.popup, da.popup),
        popupSeconds: Math.round(num(sa.popupSeconds, da.popupSeconds, 5, 300)),
        snoozeMinutes: Math.round(num(sa.snoozeMinutes, da.snoozeMinutes, 1, 120))
      },
      floating: {
        enabled: bool(sf.enabled, df.enabled),
        position: FLOAT_POSITIONS.includes(sf.position) ? sf.position : df.position,
        opacity: num(sf.opacity, df.opacity, 0.4, 1)
      },
      general: {
        startWithWindows: bool(sg.startWithWindows, dg.startWithWindows),
        closeToTray: bool(sg.closeToTray, dg.closeToTray),
        autoUpdateCheck: bool(sg.autoUpdateCheck, dg.autoUpdateCheck)
      }
    }
  };
}

function normalizeState(input) {
  const def = createDefaultState();
  const src = isObj(input) ? input : {};
  const bounds = (b) => (isObj(b) && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) ? { x: b.x, y: b.y, width: b.width, height: b.height } : null);
  return {
    paused: bool(src.paused, def.paused),
    muteUntil: Number.isFinite(src.muteUntil) ? src.muteUntil : 0,
    snoozes: Array.isArray(src.snoozes) ? src.snoozes.filter((x) => isObj(x) && Number.isFinite(x.at) && isObj(x.alert)) : [],
    lastAlert: isObj(src.lastAlert) ? src.lastAlert : null,
    trayHintShown: bool(src.trayHintShown, false),
    mainBounds: bounds(src.mainBounds),
    mainMaximized: bool(src.mainMaximized, false),
    floatingBounds: bounds(src.floatingBounds)
  };
}

module.exports = { JsonStore, normalizeConfig, normalizeState, slug, FLOAT_POSITIONS };
