import { api } from './api.js';
import { ctx } from './ctx.js';
import { ic, LOGO_SVG } from './icons.js';
import { openModal, confirmDialog, toast } from './components.js';
import {
  state,
  ACTIONS,
  TYPES,
  WEEK_CN,
  esc,
  fmtClock,
  fmtDateCN,
  fmtDT,
  todayStr,
  taskNextAt,
  isExpired,
  scheduleText,
  fmtDur,
  fmtDurCN,
} from './util.js';

const LV = {
  info: { bg: '#eff4ff', fg: '#3538cd', label: '信息' },
  success: { bg: '#ecfdf3', fg: '#067647', label: '成功' },
  warn: { bg: '#fffaeb', fg: '#b54708', label: '提醒' },
  error: { bg: '#fef2f2', fg: '#b42318', label: '错误' },
};

function emptyHtml(text, icon = 'schedule') {
  return `<div class="empty"><div class="e-icon">${ic(icon, 28)}</div><p>${esc(text)}</p></div>`;
}

function actionBadge(a) {
  return `<span class="badge" style="background:${ACTIONS[a].bg};color:${ACTIONS[a].color}"><span class="dot"></span>${ACTIONS[a].label}</span>`;
}

/** 管理密码校验门禁 */
export function requireAuth(then) {
  const s = state.boot?.config?.settings;
  if (!s?.passwordEnabled || state.unlocked) return Promise.resolve(then());
  return new Promise((resolve) => {
    openModal({
      title: '身份验证',
      width: 400,
      okText: '验证',
      body: `<div class="field"><label>请输入管理密码</label><input class="input" id="pwd-input" type="password" placeholder="教务管理密码"></div>
      <div class="form-tip" style="background:#f0f7ff;border-color:#bfdbfe;color:#1d4ed8">该操作受密码保护，请输入教务管理密码后继续。</div>`,
      onOk: async () => {
        const pwd = document.getElementById('pwd-input')?.value || '';
        if (!pwd) {
          toast('请输入密码', 'warn');
          return false;
        }
        let ok = false;
        try {
          ok = await api.verifyPassword(pwd);
        } catch (e) {
          toast(String(e), 'error');
          return false;
        }
        if (!ok) {
          toast('密码错误', 'error');
          return false;
        }
        state.unlocked = true;
        await then();
        resolve();
      },
    });
  });
}

/* ============================================================
   任务条目
   ============================================================ */
export function taskItemHtml(t) {
  const a = ACTIONS[t.action];
  const next = taskNextAt(t);
  const expired = isExpired(t);
  return `<div class="task-item ${t.enabled ? '' : 'off'}" data-id="${t.id}">
    <div class="task-bar" style="background:${a.color}"></div>
    <div class="task-icon" style="background:${a.bg};color:${a.color}">${ic(a.icon, 21)}</div>
    <div class="task-main">
      <div class="task-name">${esc(t.name)} ${actionBadge(t.action)}
        ${expired ? '<span class="badge" style="background:#fef2f2;color:#b42318">已过期</span>' : ''}
      </div>
      <div class="task-meta"><span>${esc(scheduleText(t))}</span>${next && !expired ? `<span>· 下次 ${fmtDT(next)}</span>` : ''}</div>
    </div>
    <div class="task-time">${esc(t.time)}</div>
    <div class="task-ops">
      <button class="icon-btn play" data-act="run" title="立即执行">${ic('play', 15)}</button>
      <button class="icon-btn" data-act="edit" title="编辑">${ic('edit', 15)}</button>
      <button class="icon-btn danger" data-act="del" title="删除">${ic('trash', 15)}</button>
      <label class="toggle" title="${t.enabled ? '点击停用' : '点击启用'}"><input type="checkbox" data-act="toggle" ${t.enabled ? 'checked' : ''}><span></span></label>
    </div>
  </div>`;
}

/* ============================================================
   新建 / 编辑计划弹窗
   ============================================================ */
export function openTaskModal(task, presetAction) {
  const isEdit = !!task;
  const t = task || {
    name: '',
    action: presetAction || 'shutdown',
    type: 'daily',
    time: '22:00',
    date: todayStr(),
    days: [1, 2, 3, 4, 5],
    enabled: true,
  };
  const daysSet = new Set(t.days || []);
  const actionOptions = Object.entries(ACTIONS)
    .map(([k, a]) => `<option value="${k}" ${t.action === k ? 'selected' : ''}>${a.label} · ${a.desc}</option>`)
    .join('');
  const typeSeg = Object.entries(TYPES)
    .map(([k, l]) => `<button type="button" data-type="${k}" class="${t.type === k ? 'active' : ''}">${l}</button>`)
    .join('');
  const tips = {
    wake: '定时开机：到点自动唤醒处于<b>睡眠 / 休眠</b>状态的电脑。若电脑完全关机，需在 BIOS 中开启「RTC 唤醒 / 定时开机」功能（详见「定时开机」页面）。',
    lock: '锁定任务需以当前登录用户身份执行，电脑未登录时不会生效。',
    sleep: '睡眠通过系统电源接口实现，关闭本程序后依然生效。',
    hibernate: '休眠前请确认系统已开启休眠功能（可在「定时开机」页面一键开启）。',
    shutdown: '关机前请确认无人使用电脑，避免丢失未保存的工作内容。',
    restart: '重启前请确认无人使用电脑，避免丢失未保存的工作内容。',
  };
  const body = `
    <div class="field"><label>任务名称</label><input class="input" id="f-name" maxlength="30" placeholder="例如：晚自习后关机" value="${esc(t.name)}"></div>
    <div class="field-row">
      <div class="field"><label>执行动作</label><select class="select" id="f-action">${actionOptions}</select></div>
      <div class="field"><label>执行时间</label><input class="input" id="f-time" type="time" value="${esc(t.time)}"></div>
    </div>
    <div class="field"><label>重复方式</label><div class="segmented" id="f-type">${typeSeg}</div></div>
    <div class="field" id="row-date" style="display:none"><label>执行日期</label><input class="input" id="f-date" type="date" value="${esc(t.date || todayStr())}" min="${todayStr()}"></div>
    <div class="field" id="row-days" style="display:none"><label>重复星期（可多选）</label><div class="day-picker" id="f-days">${WEEK_CN.map(
      (w, i) => `<button type="button" data-day="${i + 1}" class="${daysSet.has(i + 1) ? 'active' : ''}">${w}</button>`
    ).join('')}</div></div>
    <div class="form-tip" id="f-tip"></div>
    <div class="set-row" style="border:none;padding-bottom:2px">
      <div class="sr-main"><div class="sr-title">启用此计划</div><div class="sr-sub">停用后系统任务被禁用，不会自动执行</div></div>
      <div class="sr-side"><label class="toggle"><input type="checkbox" id="f-enabled" ${t.enabled ? 'checked' : ''}><span></span></label></div>
    </div>`;

  const m = openModal({
    title: isEdit ? '编辑定时计划' : '新建定时计划',
    body,
    okText: isEdit ? '保存修改' : '创建计划',
    width: 560,
    onOk: async () => {
      const ov = m.overlay;
      const name = ov.querySelector('#f-name').value.trim();
      const action = ov.querySelector('#f-action').value;
      const type = ov.querySelector('#f-type .active')?.dataset.type || 'daily';
      const time = ov.querySelector('#f-time').value;
      const date = ov.querySelector('#f-date').value || null;
      const days = [...ov.querySelectorAll('#f-days .active')].map((b) => +b.dataset.day);
      const enabled = ov.querySelector('#f-enabled').checked;
      if (!name) return (toast('请输入任务名称', 'warn'), false);
      if (!/^\d{2}:\d{2}$/.test(time)) return (toast('请设置执行时间', 'warn'), false);
      if (type === 'once' && !date) return (toast('请选择执行日期', 'warn'), false);
      if (type === 'weekly' && !days.length) return (toast('请至少选择一个星期', 'warn'), false);
      try {
        const payload = {
          name,
          action,
          type,
          time,
          date: type === 'once' ? date : null,
          days: type === 'weekly' ? days : null,
          enabled,
        };
        if (isEdit) await api.updateTask(task.id, payload);
        else await api.createTask(payload);
        toast(isEdit ? '计划已保存' : '计划创建成功，已在「定时计划」中列出');
        // 强制定位到定时计划页并清除筛选，确保用户能立即看到新计划
        if (ctx.refreshToTasks) await ctx.refreshToTasks();
        else await ctx.refresh();
      } catch (e) {
        toast(String(e), 'error');
        return false;
      }
    },
  });

  // 交互绑定
  const ov = m.overlay;
  const syncRows = () => {
    const type = ov.querySelector('#f-type .active')?.dataset.type;
    ov.querySelector('#row-date').style.display = type === 'once' ? '' : 'none';
    ov.querySelector('#row-days').style.display = type === 'weekly' ? '' : 'none';
  };
  const syncTip = () => {
    const action = ov.querySelector('#f-action').value;
    ov.querySelector('#f-tip').innerHTML = tips[action] || '';
  };
  ov.querySelector('#f-type').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    ov.querySelectorAll('#f-type button').forEach((b) => b.classList.toggle('active', b === btn));
    syncRows();
  });
  ov.querySelector('#f-action').addEventListener('change', syncTip);
  ov.querySelector('#f-days').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-day]');
    if (btn) btn.classList.toggle('active');
  });
  syncRows();
  syncTip();
}

/* ============================================================
   倒计时卡片
   ============================================================ */
export function countdownCardHtml() {
  const cd = state.boot?.config?.countdown;
  if (!cd) return '';
  const a = ACTIONS[cd.action];
  const remain = Math.max(0, cd.endsAt - Math.floor(Date.now() / 1000));
  const total = state.cdTotal || remain || 1;
  const pct = Math.min(100, Math.max(0, (1 - remain / total) * 100));
  const C = 2 * Math.PI * 46;
  return `<div class="cd-card">
    <div class="cd-ring">
      <svg width="108" height="108">
        <circle cx="54" cy="54" r="46" stroke="#eef1f7" stroke-width="9" fill="none"/>
        <circle id="cd-arc" cx="54" cy="54" r="46" stroke="${a.color}" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
      </svg>
      <div class="cd-num" id="cd-remain">${fmtDur(remain)}</div>
    </div>
    <div class="cd-info">
      <div class="cd-title">${actionBadge(cd.action)}倒计时进行中</div>
      <div class="cd-sub">${cd.mode === 'system'
        ? '系统级倒计时：由 Windows 接管，关闭或退出本程序后仍会执行。'
        : '应用级倒计时：由本程序执行，请保持程序运行（可最小化到托盘），退出程序将取消倒计时。'}</div>
      <div class="cd-actions">
        <button class="btn btn-danger" id="cd-cancel">${ic('close', 15)}取消倒计时</button>
        <button class="btn btn-secondary" id="cd-runnow">${ic('play', 15)}立即执行</button>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   页面一：仪表盘
   ============================================================ */
function pickNext() {
  const list = state.boot.config.tasks
    .filter((t) => t.enabled)
    .map((t) => ({ t, at: taskNextAt(t) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at);
  return list[0] || null;
}

function quickTiles() {
  return ['shutdown', 'restart', 'sleep', 'hibernate', 'lock']
    .map((k) => {
      const a = ACTIONS[k];
      return `<button class="tile" data-imm="${k}">
        <div class="t-icon" style="background:${a.bg};color:${a.color}">${ic(a.icon, 23)}</div>
        <div class="t-label">${a.label}</div>
        <div class="t-desc">${a.desc}</div>
      </button>`;
    })
    .join('');
}

function renderDashboard() {
  const boot = state.boot;
  const tasks = boot.config.tasks;
  const enabled = tasks.filter((t) => t.enabled);
  const next = pickNext();
  state._nextAt = next ? next.at : null;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const todays = enabled
    .map((t) => ({ t, at: taskNextAt(t) }))
    .filter((x) => x.at && x.at >= todayStart && x.at < todayEnd)
    .sort((a, b) => a.at - b.at);
  const cd = boot.config.countdown;

  const nextBar = next
    ? `<div class="next-bar">
        <div class="nb-icon">${ic('clock', 20)}</div>
        <div class="nb-text">
          <div class="nb-title">下次执行：${esc(next.t.name)} ${actionBadge(next.t.action)}</div>
          <div class="nb-sub">${esc(scheduleText(next.t))} · ${fmtDT(next.at)}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div class="nb-count" id="next-remaining">${fmtDurCN(Math.max(0, (next.at - state.now) / 1000))}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:2px">后执行</div>
        </div>
      </div>`
    : `<div class="next-bar"><div class="nb-icon">${ic('info', 20)}</div>
        <div class="nb-text"><div class="nb-title">暂无启用的计划</div>
        <div class="nb-sub">前往「定时计划」创建关机 / 开机计划，或使用下方快捷操作</div></div>
        <button class="btn btn-primary" data-goto="schedules">去创建</button></div>`;

  return `<div class="page">
    <section class="hero">
      <div class="hero-left">
        <div class="hero-badge">${ic('shield', 13)} 定时开关机 · 无人值守</div>
        <h1>智能电源管理</h1>
        <div class="hero-sub">定时开关机 · 计划由 Windows 任务计划程序执行，关闭本程序后依然生效</div>
        <div class="hero-chips">
          <span class="chip">计划任务 ${tasks.length} 项</span>
          <span class="chip">已启用 ${enabled.length} 项</span>
          <span class="chip">${boot.isAdmin ? '管理员模式' : '标准模式'}</span>
        </div>
      </div>
      <div class="hero-right">
        <div class="hero-clock" id="hero-clock">${fmtClock(state.now)}</div>
        <div class="hero-date" id="hero-date">${fmtDateCN(state.now)}</div>
      </div>
    </section>
    ${nextBar}
    <div class="tile-grid">${quickTiles()}</div>
    ${cd ? `<section class="card"><div class="card-head"><div><div class="card-title">${ic('clock', 17)}进行中的倒计时</div></div><button class="btn btn-ghost" data-goto="actions">管理${ic('ext', 13)}</button></div>${countdownCardHtml()}</section>` : ''}
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('calendar', 17)}今日安排</div><div class="card-desc">今天即将执行的计划任务</div></div>
        <button class="btn btn-ghost" data-goto="schedules">查看全部${ic('ext', 13)}</button></div>
      ${todays.length
        ? todays.map((x) => {
            const a = ACTIONS[x.t.action];
            return `<div class="set-row">
              <div class="sr-icon" style="background:${a.bg};color:${a.color}">${ic(a.icon, 17)}</div>
              <div class="sr-main"><div class="sr-title">${esc(x.t.name)}</div><div class="sr-sub">${esc(scheduleText(x.t))} · ${a.label}</div></div>
              <div class="sr-side" style="font-size:19px;font-weight:800;font-variant-numeric:tabular-nums">${esc(x.t.time)}</div>
            </div>`;
          }).join('')
        : emptyHtml('今天没有安排任务', 'calendar')}
    </section>
    ${!boot.isAdmin
      ? `<div class="banner warn"><div class="b-icon">${ic('warn', 18)}</div>
          <div><b>当前为标准用户模式。</b>计划任务以当前用户身份执行，电脑处于未登录状态（如登录界面）时定时任务不会触发。建议以管理员身份运行本程序，使计划在未登录时同样生效。</div>
          <div class="b-actions"><button class="btn btn-primary" data-act="elevate">${ic('ext', 14)}以管理员身份重启</button></div></div>`
      : ''}
    <div class="banner info"><div class="b-icon">${ic('info', 18)}</div>
      <div><b>定时开机提示：</b>电脑完全关机（S5）状态下自动开机，需要主板 BIOS 开启「RTC 唤醒」功能；睡眠 / 休眠状态下可直接由本软件唤醒。详见「定时开机」页面的设置指引。</div>
      <div class="b-actions"><button class="btn btn-secondary" data-goto="wake">查看指引</button></div></div>
  </div>`;
}

function bindDashboard(view) {
  view.querySelectorAll('[data-imm]').forEach((el) =>
    el.addEventListener('click', () => confirmImmediate(el.dataset.imm))
  );
  view.querySelectorAll('[data-goto]').forEach((el) =>
    el.addEventListener('click', () => ctx.navigate(el.dataset.goto))
  );
  view.querySelector('[data-act="elevate"]')?.addEventListener('click', () => doElevate());
}

/* ============================================================
   页面二：定时计划
   ============================================================ */
function renderSchedules() {
  const all = state.boot.config.tasks.slice().sort((a, b) => a.time.localeCompare(b.time));
  const filters = [['all', '全部'], ...Object.keys(ACTIONS).map((k) => [k, ACTIONS[k].label])];
  const list = state.filter === 'all' ? all : all.filter((t) => t.action === state.filter);
  return `<div class="page">
    <div class="page-head">
      <div><h2>定时计划</h2><p>计划由 Windows 任务计划程序执行，关闭本程序后依然生效</p></div>
      <div class="ops">
        <button class="btn btn-secondary" id="btn-refresh">${ic('refresh', 15)}刷新状态</button>
        <button class="btn btn-primary" id="btn-new-task">${ic('plus', 15)}新建计划</button>
      </div>
    </div>
    <div class="segmented" id="task-filter" style="margin-bottom:16px">
      ${filters.map(([k, l]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    <div class="task-list">${list.length ? list.map(taskItemHtml).join('') : emptyHtml('暂无计划，点击右上角「新建计划」开始创建')}</div>
  </div>`;
}

function bindSchedules(view) {
  view.querySelector('#btn-new-task')?.addEventListener('click', () =>
    requireAuth(() => openTaskModal(null))
  );
  view.querySelector('#btn-refresh')?.addEventListener('click', async () => {
    toast('正在同步计划状态…', 'info');
    await ctx.refresh();
  });
  view.querySelector('#task-filter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    ctx.navigate('schedules');
  });
  view.querySelectorAll('.task-item').forEach((item) => {
    const id = item.dataset.id;
    item.querySelector('[data-act="toggle"]')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      requireAuth(async () => {
        try {
          await api.setTaskEnabled(id, enabled);
          await ctx.refresh();
        } catch (err) {
          toast(String(err), 'error');
          ctx.refresh();
        }
      });
    });
    item.querySelector('[data-act="run"]')?.addEventListener('click', () =>
      requireAuth(async () => {
        try {
          await api.runTaskNow(id);
          toast('已触发执行');
        } catch (e) {
          toast(String(e), 'error');
        }
      })
    );
    item.querySelector('[data-act="edit"]')?.addEventListener('click', () =>
      requireAuth(() => {
        const t = state.boot.config.tasks.find((x) => x.id === id);
        if (t) openTaskModal(t);
      })
    );
    item.querySelector('[data-act="del"]')?.addEventListener('click', () =>
      requireAuth(async () => {
        const t = state.boot.config.tasks.find((x) => x.id === id);
        const ok = await confirmDialog({
          title: '删除计划',
          message: `确定删除计划「${esc(t?.name || '')}」？<br>删除后该计划将从 Windows 任务计划程序中移除。`,
          okText: '删除',
        });
        if (!ok) return;
        try {
          await api.deleteTask(id);
          toast('计划已删除');
          await ctx.refresh();
        } catch (e) {
          toast(String(e), 'error');
        }
      })
    );
  });
}

/* ============================================================
   页面三：立即操作
   ============================================================ */
function immButtons() {
  return ['shutdown', 'restart', 'sleep', 'hibernate', 'lock']
    .map((k) => {
      const a = ACTIONS[k];
      return `<button class="imm-btn" data-imm="${k}">
        <div class="i-icon" style="background:${a.bg};color:${a.color}">${ic(a.icon, 25)}</div>
        <div class="i-label">${a.label}</div>
      </button>`;
    })
    .join('');
}

export function confirmImmediate(action) {
  const a = ACTIONS[action];
  let left = 5;
  let fired = false;
  let timer = null;
  const fire = async () => {
    if (fired) return;
    fired = true;
    try {
      await api.immediateAction(action);
      toast(`已执行「${a.label}」`);
    } catch (e) {
      toast(String(e), 'error');
    }
    ctx.refresh();
  };
  const m = openModal({
    title: `确认立即${a.label}`,
    width: 420,
    danger: true,
    okText: `立即${a.label}`,
    body: `<div class="confirm-body">
      <div class="c-icon" style="background:${a.bg};color:${a.color}">${ic(a.icon, 30)}</div>
      <p>即将${a.label}，请确认已保存好所有工作内容。<br><span class="imm-num" id="imm-num">5</span> 秒后自动执行，点击「取消」可中止。</p>
    </div>`,
    onOk: async () => {
      clearInterval(timer);
      await fire();
    },
    onCancel: () => clearInterval(timer),
  });
  timer = setInterval(() => {
    left--;
    const el = m.overlay.querySelector('#imm-num');
    if (el) el.textContent = String(Math.max(0, left));
    if (left <= 0) {
      clearInterval(timer);
      m.close();
      fire();
    }
  }, 1000);
}

function renderActions() {
  const cd = state.boot.config.countdown;
  const cdActions = ['shutdown', 'restart', 'sleep', 'hibernate', 'lock'];
  return `<div class="page">
    <div class="page-head"><div><h2>立即操作</h2><p>立即执行电源动作，或设置倒计时后自动执行</p></div></div>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('bolt', 17)}立即执行</div><div class="card-desc">点击后有 5 秒确认倒计时，请提前保存好工作内容</div></div></div>
      <div class="imm-grid">${immButtons()}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('clock', 17)}倒计时执行</div><div class="card-desc">关机 / 重启由系统接管（退出程序仍生效）；睡眠 / 休眠 / 锁定需保持程序运行（可最小化到托盘）</div></div></div>
      <div class="field-row">
        <div class="field"><label>执行动作</label><select class="select" id="cd-action">${cdActions
          .map((k) => `<option value="${k}">${ACTIONS[k].label} · ${ACTIONS[k].desc}</option>`)
          .join('')}</select></div>
        <div class="field"><label>倒计时时长（分钟）</label><input class="input" id="cd-minutes" type="number" min="1" max="1440" value="30"></div>
      </div>
      <div class="min-chips">${[5, 10, 15, 30, 60, 90, 120]
        .map((mm) => `<button type="button" class="min-chip" data-min="${mm}">${mm} 分钟</button>`)
        .join('')}</div>
      <button class="btn btn-primary btn-block" id="cd-start" style="margin-top:16px;height:42px">${ic('clock', 15)}开始倒计时</button>
    </section>
    ${cd ? `<section class="card"><div class="card-head"><div><div class="card-title">${ic('clock', 17)}当前倒计时</div></div></div>${countdownCardHtml()}</section>` : ''}
  </div>`;
}

function bindActions(view) {
  view.querySelectorAll('[data-imm]').forEach((el) =>
    el.addEventListener('click', () => requireAuth(() => confirmImmediate(el.dataset.imm)))
  );
  const minutesInput = view.querySelector('#cd-minutes');
  view.querySelectorAll('.min-chip').forEach((chip) =>
    chip.addEventListener('click', () => {
      view.querySelectorAll('.min-chip').forEach((c) => c.classList.toggle('active', c === chip));
      if (minutesInput) minutesInput.value = chip.dataset.min;
    })
  );
  view.querySelector('#cd-start')?.addEventListener('click', () =>
    requireAuth(async () => {
      const action = view.querySelector('#cd-action').value;
      const minutes = Math.floor(Number(minutesInput?.value || 0));
      if (!minutes || minutes < 1 || minutes > 1440) {
        toast('请输入 1 ~ 1440 之间的分钟数', 'warn');
        return;
      }
      try {
        const cd = await api.startCountdown(action, minutes);
        state.cdTotal = minutes * 60;
        toast(`已开始 ${minutes} 分钟「${ACTIONS[action].label}」倒计时`);
        state.boot.config.countdown = cd;
        ctx.navigate('actions');
      } catch (e) {
        toast(String(e), 'error');
      }
    })
  );
  view.querySelector('#cd-cancel')?.addEventListener('click', () =>
    requireAuth(async () => {
      const ok = await confirmDialog({
        title: '取消倒计时',
        message: '确定取消当前倒计时吗？',
        okText: '取消倒计时',
      });
      if (!ok) return;
      try {
        await api.cancelCountdown();
        state.cdTotal = null;
        toast('倒计时已取消');
        await ctx.refresh();
      } catch (e) {
        toast(String(e), 'error');
      }
    })
  );
  view.querySelector('#cd-runnow')?.addEventListener('click', () =>
    requireAuth(async () => {
      const action = state.boot.config.countdown?.action;
      if (!action) return;
      try {
        await api.immediateAction(action);
        toast(`已执行「${ACTIONS[action].label}」`);
        await ctx.refresh();
      } catch (e) {
        toast(String(e), 'error');
      }
    })
  );
}

/* ============================================================
   页面四：定时开机
   ============================================================ */
function renderWake() {
  const caps = state.boot.powerCaps;
  const wakeTasks = state.boot.config.tasks.filter((t) => t.action === 'wake');
  const capBadge = (ok, label) =>
    `<span class="badge" style="background:${ok ? '#ecfdf3' : '#fef2f2'};color:${ok ? '#067647' : '#b42318'};padding:6px 12px;font-size:12px"><span class="dot"></span>${label} ${ok ? '可用' : '不可用'}</span>`;
  return `<div class="page">
    <div class="page-head">
      <div><h2>定时开机</h2><p>让电脑在预定时间自动从睡眠 / 休眠中唤醒开机</p></div>
      <div class="ops"><button class="btn btn-primary" id="btn-new-wake">${ic('plus', 15)}新建唤醒计划</button></div>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><div><div class="card-title">${ic('info', 17)}工作原理</div></div></div>
        <div class="step-list">
          <div class="step-item"><div class="s-num">1</div><div class="s-text">电脑处于<b>睡眠（S3）</b>或<b>休眠（S4）</b>状态时，Windows 可在预定时间自动唤醒（Wake To Run）。</div></div>
          <div class="step-item"><div class="s-num">2</div><div class="s-text">若电脑<b>完全关机（S5）</b>，需要主板 BIOS 支持并开启 <b>RTC 唤醒 / 定时开机</b>（Resume by RTC Alarm）。</div></div>
          <div class="step-item"><div class="s-num">3</div><div class="s-text">建议放学后让电脑<b>休眠</b>而非关机，次日即可按计划自动唤醒开机。</div></div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><div class="card-title">${ic('cpu', 17)}BIOS 设置指引</div><div class="card-desc">不同品牌主板菜单名称略有差异</div></div></div>
        <div class="step-list">
          <div class="step-item"><div class="s-num">1</div><div class="s-text">开机时连续按 <b>Del / F2 / F10</b>（部分品牌为 F1 / Esc）进入 BIOS 设置。</div></div>
          <div class="step-item"><div class="s-num">2</div><div class="s-text">找到 <b>Power Management（电源管理）</b>→ <b>Resume by RTC Alarm / Power On By Alarm / RTC Power On</b>。</div></div>
          <div class="step-item"><div class="s-num">3</div><div class="s-text">设为 <b>Enabled</b>，闹钟时间设置为每天首次上课前（例如 07:00），保存退出（通常为 F10）。</div></div>
        </div>
        <div class="brand-tags">
          ${['联想 Lenovo', '惠普 HP', '戴尔 DELL', '华硕 ASUS', '宏碁 Acer', '同方 / 清华同方'].map((b) => `<span class="brand-tag">${b}</span>`).join('')}
        </div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('power2', 17)}本机电源能力检测</div><div class="card-desc">定时开机唤醒依赖睡眠 / 休眠功能</div></div>
        <button class="btn btn-secondary" id="btn-caps">${ic('refresh', 15)}重新检测</button></div>
      <div class="cap-rows">
        ${capBadge(caps.sleepAvailable, '睡眠')}
        ${capBadge(caps.hibernateAvailable, '休眠')}
        ${!caps.hibernateAvailable ? `<button class="btn btn-primary" id="btn-hib" style="height:32px">${ic('check', 14)}开启休眠功能</button>` : ''}
      </div>
      <div class="powercap-pre">${esc(caps.raw || '（无输出，请以管理员身份运行后重试）')}</div>
    </section>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('wake', 17)}唤醒计划</div><div class="card-desc">共 ${wakeTasks.length} 项</div></div></div>
      <div class="task-list">${wakeTasks.length ? wakeTasks.map(taskItemHtml).join('') : emptyHtml('还没有唤醒计划，点击右上角「新建唤醒计划」创建', 'wake')}</div>
    </section>
  </div>`;
}

function bindWake(view) {
  view.querySelector('#btn-new-wake')?.addEventListener('click', () =>
    requireAuth(() => openTaskModal(null, 'wake'))
  );
  view.querySelector('#btn-caps')?.addEventListener('click', async () => {
    toast('正在重新检测电源能力…', 'info');
    await ctx.refresh();
  });
  view.querySelector('#btn-hib')?.addEventListener('click', () =>
    requireAuth(async () => {
      try {
        const caps = await api.enableHibernate();
        state.boot.powerCaps = caps;
        toast('休眠功能已开启');
        ctx.navigate('wake');
      } catch (e) {
        toast(String(e), 'error');
      }
    })
  );
  bindTaskItems(view);
}

/* ============================================================
   页面五：系统设置
   ============================================================ */
function pwdModal(mode) {
  const s = state.boot.config.settings;
  const hasOld = mode === 'change' || mode === 'clear';
  const body = `
    ${hasOld ? '<div class="field"><label>原密码</label><input class="input" id="p-old" type="password" placeholder="请输入原密码"></div>' : ''}
    ${mode !== 'clear' ? `<div class="field"><label>新密码（至少 4 位）</label><input class="input" id="p-new" type="password" placeholder="请输入新密码"></div>
    <div class="field"><label>确认新密码</label><input class="input" id="p-new2" type="password" placeholder="请再次输入新密码"></div>` : ''}
    <div class="form-tip">密码用于保护计划与设置的修改，防止学生误操作。请牢记密码，遗忘后需删除数据目录下的 config.json。</div>`;
  const titles = { set: '设置管理密码', change: '修改管理密码', clear: '移除管理密码' };
  openModal({
    title: titles[mode],
    width: 440,
    danger: mode === 'clear',
    okText: mode === 'clear' ? '移除密码' : '保存',
    body,
    onOk: async () => {
      const old = document.getElementById('p-old')?.value || '';
      const nw = document.getElementById('p-new')?.value || '';
      const nw2 = document.getElementById('p-new2')?.value || '';
      if (hasOld && !old) return (toast('请输入原密码', 'warn'), false);
      if (mode !== 'clear') {
        if (nw.length < 4) return (toast('新密码至少 4 个字符', 'warn'), false);
        if (nw !== nw2) return (toast('两次输入的新密码不一致', 'warn'), false);
      }
      try {
        if (mode === 'clear') await api.clearPassword(old);
        else await api.setPassword(old || null, nw);
        toast(mode === 'clear' ? '管理密码已移除' : '管理密码已保存');
        state.unlocked = false;
        await ctx.refresh();
      } catch (e) {
        toast(String(e), 'error');
        return false;
      }
    },
  });
}

async function doElevate() {
  const ok = await confirmDialog({
    title: '以管理员身份重启',
    message: '将以管理员权限重新启动本程序，使计划任务在电脑未登录时也能执行。是否继续？',
    okText: '重启',
  });
  if (!ok) return;
  try {
    await api.relaunchElevated();
  } catch (e) {
    toast(String(e), 'error');
  }
}

function renderSettings() {
  const s = state.boot.config.settings;
  const isAdmin = state.boot.isAdmin;
  return `<div class="page">
    <div class="page-head"><div><h2>系统设置</h2><p>个性化与安全设置</p></div></div>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('sliders', 17)}常规设置</div></div></div>
      <div class="set-row">
        <div class="sr-icon">${ic('power', 18)}</div>
        <div class="sr-main"><div class="sr-title">开机自动启动</div><div class="sr-sub">登录 Windows 后自动运行本程序并驻留托盘；计划任务本身不依赖本程序运行</div></div>
        <div class="sr-side"><label class="toggle"><input type="checkbox" id="set-autostart" ${s.autostart ? 'checked' : ''}><span></span></label></div>
      </div>
      <div class="set-row">
        <div class="sr-icon">${ic('eye', 18)}</div>
        <div class="sr-main"><div class="sr-title">关闭窗口时最小化到托盘</div><div class="sr-sub">开启后点击关闭按钮将隐藏到系统托盘，程序继续在后台运行</div></div>
        <div class="sr-side"><label class="toggle"><input type="checkbox" id="set-tray" ${s.minimizeToTray ? 'checked' : ''}><span></span></label></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('key', 17)}管理密码</div><div class="card-desc">设置后，新建 / 修改 / 删除计划与修改设置需要验证密码</div></div></div>
      <div class="set-row">
        <div class="sr-icon">${ic('lock', 18)}</div>
        <div class="sr-main"><div class="sr-title">密码保护</div><div class="sr-sub">${s.passwordEnabled ? '已开启，敏感操作需要验证密码' : '未开启，所有操作均可直接执行'}</div></div>
        <div class="sr-side">
          ${s.passwordEnabled
            ? `<button class="btn btn-secondary" id="btn-pwd-change">修改密码</button><button class="btn btn-danger" id="btn-pwd-clear">移除</button>`
            : `<button class="btn btn-primary" id="btn-pwd-set">设置密码</button>`}
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div><div class="card-title">${ic('shield', 17)}运行权限</div></div></div>
      <div class="set-row">
        <div class="sr-icon">${ic('shield', 18)}</div>
        <div class="sr-main"><div class="sr-title">当前权限模式</div><div class="sr-sub">${isAdmin ? '管理员模式：计划以 SYSTEM 账户执行，电脑未登录时也能生效' : '标准模式：计划以当前用户身份执行；如需未登录时生效，请以管理员身份运行'}</div></div>
        <div class="sr-side">
          <span class="badge" style="background:${isAdmin ? '#ecfdf3' : '#fffaeb'};color:${isAdmin ? '#067647' : '#b54708'};padding:6px 12px">${isAdmin ? '管理员' : '标准用户'}</span>
          ${isAdmin ? '' : `<button class="btn btn-primary" id="btn-elevate">${ic('ext', 14)}以管理员身份重启</button>`}
        </div>
      </div>
      <div class="set-row">
        <div class="sr-icon">${ic('folder', 18)}</div>
        <div class="sr-main"><div class="sr-title">数据目录</div><div class="sr-sub" style="word-break:break-all;user-select:text">${esc(state.boot.dataDir || '')}</div></div>
        <div class="sr-side"><button class="btn btn-secondary" id="btn-datadir">打开文件夹</button></div>
      </div>
    </section>
    <section class="card about">
      <div class="a-logo" style="color:#fff">${ic('power', 36)}</div>
      <h3>智能电源管理</h3>
      <div class="a-ver">版本 ${esc(state.boot.version)} · 适用于 Windows 10 / 11</div>
      <div class="a-org">开发者：大先生</div>
      <div class="a-copy">© 2025 大先生<br>计划任务基于 Windows 任务计划程序实现</div>
    </section>
  </div>`;
}

function bindSettings(view) {
  view.querySelector('#set-autostart')?.addEventListener('change', (e) =>
    requireAuth(async () => {
      const enabled = e.target.checked;
      try {
        await api.setAutostart(enabled);
        toast(enabled ? '已开启开机自动启动' : '已关闭开机自动启动');
        await ctx.refresh();
      } catch (err) {
        toast(String(err), 'error');
        ctx.refresh();
      }
    })
  );
  view.querySelector('#set-tray')?.addEventListener('change', async (e) => {
    try {
      await api.setMinimizeToTray(e.target.checked);
      toast(e.target.checked ? '关闭时将最小化到托盘' : '关闭时将直接退出程序');
    } catch (err) {
      toast(String(err), 'error');
    }
  });
  view.querySelector('#btn-pwd-set')?.addEventListener('click', () => pwdModal('set'));
  view.querySelector('#btn-pwd-change')?.addEventListener('click', () => pwdModal('change'));
  view.querySelector('#btn-pwd-clear')?.addEventListener('click', () => pwdModal('clear'));
  view.querySelector('#btn-elevate')?.addEventListener('click', doElevate);
  view.querySelector('#btn-datadir')?.addEventListener('click', () =>
    api.openDataDir().catch((e) => toast(String(e), 'error'))
  );
}

/* ============================================================
   页面六：运行日志
   ============================================================ */
function renderLogs() {
  const logs = state.boot.config.logs;
  return `<div class="page">
    <div class="page-head"><div><h2>运行日志</h2><p>记录计划创建、执行与系统操作，最近 ${logs.length} 条</p></div>
      <div class="ops"><button class="btn btn-danger" id="btn-clear-logs">${ic('trash', 15)}清空日志</button></div></div>
    <section class="card" style="padding:8px 14px">
      ${logs.length
        ? `<table class="table"><thead><tr><th style="width:175px">时间</th><th style="width:72px">级别</th><th>内容</th></tr></thead><tbody>${logs
            .map(
              (l) => `<tr><td class="log-time">${esc(l.time)}</td><td><span class="log-lv" style="background:${LV[l.level]?.bg || LV.info.bg};color:${LV[l.level]?.fg || LV.info.fg}">${LV[l.level]?.label || '信息'}</span></td><td>${esc(l.message)}</td></tr>`
            )
            .join('')}</tbody></table>`
        : emptyHtml('暂无日志记录', 'logs')}
    </section>
  </div>`;
}

function bindLogs(view) {
  view.querySelector('#btn-clear-logs')?.addEventListener('click', () =>
    requireAuth(async () => {
      const ok = await confirmDialog({
        title: '清空日志',
        message: '确定清空全部运行日志吗？',
        okText: '清空',
      });
      if (!ok) return;
      try {
        await api.clearLogs();
        toast('日志已清空');
        await ctx.refresh();
      } catch (e) {
        toast(String(e), 'error');
      }
    })
  );
}

/* ============================================================
   任务条目事件（唤醒页复用）
   ============================================================ */
function bindTaskItems(view) {
  view.querySelectorAll('.task-item').forEach((item) => {
    const id = item.dataset.id;
    item.querySelector('[data-act="toggle"]')?.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      requireAuth(async () => {
        try {
          await api.setTaskEnabled(id, enabled);
          await ctx.refresh();
        } catch (err) {
          toast(String(err), 'error');
          ctx.refresh();
        }
      });
    });
    item.querySelector('[data-act="run"]')?.addEventListener('click', () =>
      requireAuth(async () => {
        try {
          await api.runTaskNow(id);
          toast('已触发执行');
        } catch (e) {
          toast(String(e), 'error');
        }
      })
    );
    item.querySelector('[data-act="edit"]')?.addEventListener('click', () =>
      requireAuth(() => {
        const t = state.boot.config.tasks.find((x) => x.id === id);
        if (t) openTaskModal(t);
      })
    );
    item.querySelector('[data-act="del"]')?.addEventListener('click', () =>
      requireAuth(async () => {
        const t = state.boot.config.tasks.find((x) => x.id === id);
        const ok = await confirmDialog({
          title: '删除计划',
          message: `确定删除计划「${esc(t?.name || '')}」？`,
          okText: '删除',
        });
        if (!ok) return;
        try {
          await api.deleteTask(id);
          toast('计划已删除');
          await ctx.refresh();
        } catch (e) {
          toast(String(e), 'error');
        }
      })
    );
  });
}

/* ============================================================
   页面注册表
   ============================================================ */
export const PAGES = {
  dashboard: { render: renderDashboard, bind: bindDashboard },
  schedules: { render: renderSchedules, bind: bindSchedules },
  actions: { render: renderActions, bind: bindActions },
  wake: { render: renderWake, bind: bindWake },
  settings: { render: renderSettings, bind: bindSettings },
  logs: { render: renderLogs, bind: bindLogs },
};
