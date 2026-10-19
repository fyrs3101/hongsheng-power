// 线性图标集（24x24，stroke 风格）
const P = {
  dashboard:
    '<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="12" width="7.5" height="9" rx="1.5"/><rect x="3" y="16" width="7.5" height="5" rx="1.5"/>',
  schedule:
    '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 2"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v4"/>',
  restart:
    '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  hib: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/>',
  lock:
    '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wake:
    '<path d="M12 8V3"/><path d="m4.9 9.9 2.1 2.1"/><path d="M2 15h2.5"/><path d="M19.5 15H22"/><path d="m17 12 2.1-2.1"/><path d="M22 20H2"/><path d="M16 15a4 4 0 0 0-8 0"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  edit:
    '<path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  play: '<path d="M6 4.5v15l13-7.5z"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v5h-5"/>',
  close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  sliders:
    '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1.5 14h5"/><path d="M9.5 8h5"/><path d="M17.5 16h5"/>',
  logs:
    '<path d="M5 4h14"/><path d="M5 9h14"/><path d="M5 14h9"/><path d="M5 19h5"/>',
  shield: '<path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  warn:
    '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar:
    '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4"/><path d="M8 2.5v4"/><path d="M3 10h18"/>',
  folder:
    '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2.5 3H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="m11.5 11.5 8-8"/><path d="M16 7l3 3"/>',
  power2:
    '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v4"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  lock2: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
};

/** 生成 SVG 图标 HTML（P 中的数据本身是完整的 SVG 子元素标记，直接插入） */
export function ic(name, size = 18, extra = '') {
  const d = P[name] || P.info;
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/** 品牌 Logo（电源 + 时钟） */
export const LOGO_SVG = `<svg width="26" height="26" viewBox="0 0 48 48" fill="none">
<circle cx="24" cy="26" r="11.5" stroke="#fff" stroke-width="3.2" opacity="0.95"/>
<path d="M24 8.5v6.5" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
<path d="M33.2 18.2A11.5 11.5 0 1 1 14.8 18.2" stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
<path d="M24 26V20.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
<path d="M24 26l4.2 2.8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
</svg>`;
