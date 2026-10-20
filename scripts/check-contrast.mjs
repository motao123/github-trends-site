/**
 * 对比度自检。WCAG 2.1 相对亮度公式。
 * 用法：node scripts/check-contrast.mjs
 */

const srgb = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};

const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const LIGHT = {
  page: "#fcfcfd",
  card: "#ffffff",
  subtle: "#f7f7f9",
  inset: "#f0f0f3",
  primary: "#1c2024",
  secondary: "#60646c",
  tertiary: "#6f6f78",
  placeholder: "#b8b8c0",
  accent: "#3e63dd",
  accentOn: "#ffffff",
  accentText: "#2f4fb5",
  success: "#1a7f4b",
  warning: "#9a6206",
  danger: "#c53434",
  border: "#d9d9e0",
};

const DARK = {
  page: "#0e0f11",
  card: "#1c1d20",
  subtle: "#141517",
  inset: "#26272b",
  primary: "#eceef0",
  secondary: "#a3a7ae",
  tertiary: "#868a91",
  placeholder: "#4a4d53",
  accent: "#6280e8",
  accentOn: "#0e0f11",
  accentText: "#9db2f0",
  success: "#4bb07c",
  warning: "#d9a441",
  danger: "#e07070",
  border: "#33353a",
};

function check(theme, name) {
  console.log(`\n═══ ${name} ═══`);
  const checks = [
    ["主要文字 / 卡片底", theme.primary, theme.card, 4.5],
    ["主要文字 / 页面底", theme.primary, theme.page, 4.5],
    ["二级文字 / 卡片底", theme.secondary, theme.card, 4.5],
    ["二级文字 / 页面底", theme.secondary, theme.page, 4.5],
    ["三级文字 / 卡片底", theme.tertiary, theme.card, 4.5],
    ["主色文字 / 卡片底", theme.accentText, theme.card, 4.5],
    ["主色按钮 / 按钮文字", theme.accentOn, theme.accent, 4.5],
    ["成功色 / 卡片底", theme.success, theme.card, 4.5],
    ["警告色 / 卡片底", theme.warning, theme.card, 4.5],
    ["危险色 / 卡片底", theme.danger, theme.card, 4.5],
    ["边框 / 卡片底（装饰性，豁免）", theme.border, theme.card, 0],
    ["占位符 / 卡片底（WCAG 豁免）", theme.placeholder, theme.card, 0],
  ];

  let fail = 0;
  for (const [label, fg, bg, min] of checks) {
    const ratio = contrast(fg, bg);
    const pass = ratio >= min;
    if (!pass && min > 0) fail += 1;
    const mark = min === 0 ? (pass ? "·" : "○") : (pass ? "✓" : "✗");
    const req = min === 0 ? "参考" : `需 ≥${min}`;
    console.log(`  ${mark} ${label.padEnd(30)} ${ratio.toFixed(2)}:1  (${req})`);
  }
  return fail;
}

const failLight = check(LIGHT, "浅色主题");
const failDark = check(DARK, "深色主题");

console.log(`\n${failLight + failDark === 0 ? "全部通过" : `${failLight + failDark} 项未达标`}`);
process.exitCode = failLight + failDark === 0 ? 0 : 1;
