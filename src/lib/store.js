/**
 * 应用状态与本地持久化（主题、筛选、收藏、对比）。
 * 单一 store，所有页面共享，通过订阅机制刷新视图。
 */

import { PERIODS } from "./data.js";

const KEYS = {
  theme: "gh_trends_theme",
  state: "gh_trends_ui_state",
  favorites: "gh_trends_favorites",
  compare: "gh_trends_compare",
};

function safeGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满：仅保留内存态 */
  }
}

/* ---------------- 主题 ---------------- */

export function getTheme() {
  const saved = safeGet(KEYS.theme, null);
  if (saved === "light" || saved === "dark") return saved;
  // 未手动设置时跟随系统偏好
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  safeSet(KEYS.theme, theme);
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

/* ---------------- 筛选状态 ---------------- */

const DEFAULT_STATE = {
  period: "week",
  language: "",
  topics: [],
  keyword: "",
  sort: "growth",
  direction: "desc",
  page: 1,
  pageSize: 20,
};

export function getState() {
  const saved = safeGet(KEYS.state, {});
  const merged = { ...DEFAULT_STATE, ...saved };
  // 周期 id 必须仍然有效，避免旧数据里存了已删除的周期
  if (!PERIODS.some((p) => p.id === merged.period)) merged.period = DEFAULT_STATE.period;
  return merged;
}

export function setState(patch) {
  const next = { ...getState(), ...patch };
  safeSet(KEYS.state, next);
  window.dispatchEvent(new CustomEvent("statechange", { detail: next }));
  return next;
}

export function resetState() {
  safeSet(KEYS.state, DEFAULT_STATE);
  window.dispatchEvent(new CustomEvent("statechange", { detail: DEFAULT_STATE }));
  return { ...DEFAULT_STATE };
}

/* ---------------- 收藏 ---------------- */

export function getFavorites() {
  const list = safeGet(KEYS.favorites, []);
  return Array.isArray(list) ? list : [];
}

export function toggleFavorite(fullName) {
  const list = getFavorites();
  const idx = list.indexOf(fullName);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(fullName);
  safeSet(KEYS.favorites, list);
  window.dispatchEvent(new CustomEvent("favoriteschange", { detail: list }));
  return idx < 0; // true 表示新增
}

export function isFavorite(fullName) {
  return getFavorites().includes(fullName);
}

/* ---------------- 对比 ---------------- */

export const COMPARE_LIMIT = 4;

export function getCompare() {
  const list = safeGet(KEYS.compare, []);
  return Array.isArray(list) ? list : [];
}

export function toggleCompare(fullName) {
  const list = getCompare();
  const idx = list.indexOf(fullName);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    if (list.length >= COMPARE_LIMIT) return { added: false, reason: "limit" };
    list.push(fullName);
  }
  safeSet(KEYS.compare, list);
  window.dispatchEvent(new CustomEvent("comparechange", { detail: list }));
  return { added: idx < 0, reason: null };
}

export function clearCompare() {
  safeSet(KEYS.compare, []);
  window.dispatchEvent(new CustomEvent("comparechange", { detail: [] }));
}
