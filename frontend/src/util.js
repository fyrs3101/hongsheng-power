// 全局状态
export const state = {
  boot: null,
  page: 'dashboard',
  now: new Date(),
  unlocked: false, // 管理密码会话解锁
  cdTotal: null, // 本地倒计时总秒数（用于进度环）
  filter: 'all', // 定时计划筛选
  _nextAt: null, // 下次执行时间（仪表盘倒计时用）
};

export const ACTIONS = {
  shutdown: { label: '关机', color: '#f04438', bg: '#fef2f2', icon: 'power', desc: '关闭计算机' },
  restart: { label: '重启', color: '#f79009', bg: '#fffaeb', icon: 'restart', desc: '重新启动计算机' },
  sleep: { label: '睡眠', color: '#7a5af8', bg: '#f4f3ff', icon: 'moon', desc: '低功耗保持会话' },
  hibernate: { label: '休眠', color: '#0ba5ec', bg: '#f0f9ff', icon: 'hib', desc: '保存会话后断电' },
  lock: { label: '锁定', color: '#667085', bg: '#f2f4f7', icon: 'lock', desc: '锁定当前账户' },
  wake: { label: '定时开机', color: '#12b76a', bg: '#ecfdf3', icon: 'wake', desc: '唤醒睡眠中的电脑' },
};

export const TYPES = {
  once: '仅一次',
  daily: '每天',
  weekly: '每周',
  weekday: '工作日',
  weekend: '周末',
};

export const WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

export const pad = (n) => String(n).padStart(2, '0');

export const fmtClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export const fmtDateCN = (d) => {
  const w = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
};

export const fmtDT = (d) => `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseHM = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
};

/** 根据重复规则展开为星期数组（0=周日） */
export function daysOfType(t) {
  switch (t.type) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'weekday':
      return [1, 2, 3, 4, 5];
    case 'weekend':
      return [0, 6];
    case 'weekly':
      return (t.days || []).map((d) => d % 7); // 1..7(周一..周日) -> 1..6,0
    default:
      return [];
  }
}

/** 计算下次执行时间（Date 或 null） */
export function taskNextAt(t, from = new Date()) {
  if (!t.enabled) return null;
  if (t.type === 'once') {
    if (!t.date) return null;
    const d = new Date(`${t.date}T00:00:00`);
    if (isNaN(d)) return null;
    const { h, m } = parseHM(t.time);
    d.setHours(h, m, 0, 0);
    return d > from ? d : null;
  }
  const days = daysOfType(t);
  const { h, m } = parseHM(t.time);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (i === 0 && d <= from) continue;
    if (days.includes(d.getDay())) return d;
  }
  return null;
}

/** 计划是否已过期（仅一次且时间已过） */
export function isExpired(t, from = new Date()) {
  if (t.type !== 'once' || !t.date) return false;
  const d = new Date(`${t.date}T00:00:00`);
  if (isNaN(d)) return false;
  const { h, m } = parseHM(t.time);
  d.setHours(h, m, 0, 0);
  return d <= from;
}

/** 重复规则文字描述 */
export function scheduleText(t) {
  switch (t.type) {
    case 'once':
      return `仅一次 · ${t.date || ''}`;
    case 'daily':
      return '每天';
    case 'weekday':
      return '工作日 · 周一至周五';
    case 'weekend':
      return '周末 · 周六、周日';
    case 'weekly': {
      const ds = (t.days || []).slice().sort().map((d) => '周' + WEEK_CN[d - 1]);
      return `每周 · ${ds.join('、')}`;
    }
    default:
      return '';
  }
}

/** 秒数 -> 倒计时文字 */
export function fmtDur(secs) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 秒数 -> 中文时长 */
export function fmtDurCN(secs) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h} 小时 ${m} 分 ${s} 秒`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}
