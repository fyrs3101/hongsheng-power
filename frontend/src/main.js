import './styles.css';
import { api } from './api.js';
import { state, fmtClock, fmtDateCN, fmtDur, fmtDurCN } from './util.js';
import { ic, LOGO_SVG } from './icons.js';
import { toast } from './components.js';
import { PAGES } from './pages.js';
import { ctx } from './ctx.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

const app = document.getElementById('app');

const NAV = [
  ['dashboard', '仪表盘', 'dashboard'],
  ['schedules', '定时计划', 'schedule'],
  ['actions', '立即操作', 'bolt'],
  ['wake', '定时开机', 'wake'],
  ['settings', '系统设置', 'sliders'],
  ['logs', '运行日志', 'logs'],
];

// 单实例冲突提示：双击新版 exe 但旧版仍在运行时触发
listen('instance-already-running', () => {
  toast(
    '程序已在运行中。如果您刚更新了版本：请右键屏幕右下角托盘中的电源图标 →「退出程序」，然后再启动新版。',
    'warn',
    12000
  );
});

async function boot() {
  try {
    state.boot = await api.bootstrap();
  } catch (e) {
    toast('初始化失败: ' + e, 'error');
  }
  renderShell();
  navigate('dashboard');
  setInterval(tick, 1000);
  // 标记启动成功，避免误显示加载失败降级界面
  window.__APP_BOOTED__ = true;
}

function renderShell() {
  app.innerHTML = `
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-logo">${LOGO_SVG}</div>
      <div class="brand-text"><b>鸿升中学</b><span>智能电源管理</span></div>
    </div>
    <nav class="nav">
      ${NAV.map(
        ([id, label, icon]) =>
          `<button class="nav-item" data-page="${id}">${ic(icon, 18)}<span>${label}</span></button>`
      ).join('')}
    </nav>
    <div class="side-foot">
      <div class="side-ver">v${state.boot?.version || '1.0.0'}</div>
      <div class="side-org">鸿升中学 · 教务处</div>
    </div>
  </aside>
  <div class="main">
    <header class="titlebar" data-tauri-drag-region>
      <div class="tb-left">${ic('shield', 15)}<span>鸿升中学 · 智能电源管理</span></div>
      <div class="tb-right">
        <button class="tb-btn" id="tb-min" title="最小化" aria-label="最小化">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5.5h10" /></svg>
        </button>
        <button class="tb-btn" id="tb-max" title="最大化" aria-label="最大化">
          <svg class="ic-max" viewBox="0 0 10 10" width="10" height="10"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
          <svg class="ic-restore" viewBox="0 0 10 10" width="10" height="10" style="display:none">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5h7v7h-2" fill="none" />
          </svg>
        </button>
        <button class="tb-btn tb-close" id="tb-close" title="关闭" aria-label="关闭">
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0 10 10" /><path d="M10 0 0 10" /></svg>
        </button>
      </div>
    </header>
    <div class="view" id="view"></div>
  </div>`;

  app.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => navigate(b.dataset.page))
  );

  const win = getCurrentWindow();
  const maxBtn = document.getElementById('tb-max');
  const icMax = maxBtn.querySelector('.ic-max');
  const icRestore = maxBtn.querySelector('.ic-restore');
  const syncMaxIcon = async () => {
    const maximized = await win.isMaximized();
    icMax.style.display = maximized ? 'none' : '';
    icRestore.style.display = maximized ? '' : 'none';
    maxBtn.title = maximized ? '向下还原' : '最大化';
  };
  document.getElementById('tb-min').onclick = () => win.minimize();
  maxBtn.onclick = () => win.toggleMaximize();
  document.getElementById('tb-close').onclick = () => win.close();
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) win.toggleMaximize();
  });
  syncMaxIcon();
  win.onResized(syncMaxIcon);
}

function navigate(page) {
  if (!PAGES[page]) page = 'dashboard';
  state.page = page;
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.page === page)
  );
  const view = document.getElementById('view');
  const p = PAGES[page];
  view.innerHTML = p.render();
  p.bind(view);
  view.scrollTop = 0;
}

async function refresh() {
  try {
    const boot = await api.bootstrap();
    if (boot && boot.config) state.boot = boot;
  } catch (e) {
    toast('刷新数据失败: ' + e, 'error');
  }
  navigate(state.page);
}

/** 创建/修改计划后强制刷新到定时计划页，避免因筛选条件看不到新建的计划 */
ctx.refreshToTasks = async () => {
  state.filter = 'all';
  await refresh();
  if (state.page !== 'schedules') navigate('schedules');
};

ctx.refresh = refresh;
ctx.navigate = navigate;
ctx.toast = toast;

/** 每秒刷新：时钟 / 下次执行倒计时 / 倒计时进度 / 到期检测 */
function tick() {
  state.now = new Date();
  const c1 = document.getElementById('hero-clock');
  if (c1) c1.textContent = fmtClock(state.now);
  const c2 = document.getElementById('hero-date');
  if (c2) c2.textContent = fmtDateCN(state.now);

  if (state._nextAt) {
    const nr = document.getElementById('next-remaining');
    if (nr) nr.textContent = fmtDurCN(Math.max(0, (state._nextAt - state.now) / 1000));
  }

  const cd = state.boot?.config?.countdown;
  if (cd) {
    const remain = Math.max(0, cd.endsAt - Math.floor(Date.now() / 1000));
    const cr = document.getElementById('cd-remain');
    if (cr) cr.textContent = fmtDur(remain);
    const arc = document.getElementById('cd-arc');
    if (arc) {
      const total = state.cdTotal || remain || 1;
      const pct = Math.min(100, Math.max(0, (1 - remain / total) * 100));
      arc.setAttribute('stroke-dashoffset', String(2 * Math.PI * 46 * (1 - pct / 100)));
    }
    if (remain <= 0 && cd.mode === 'app') {
      // 应用级倒计时已结束，刷新界面
      setTimeout(() => refresh(), 800);
    }
  }
}

boot();
