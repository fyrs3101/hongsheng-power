import { ic } from './icons.js';
import { esc } from './util.js';

/* ================= Toast 通知 ================= */
let toastWrap = null;
export function toast(msg, type = 'success', duration) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    document.body.appendChild(toastWrap);
  }
  // 错误信息通常较长且需要用户阅读/操作，默认停留 10 秒；可点击关闭
  const dur = duration ?? (type === 'error' ? 10000 : 2600);
  const iconMap = { success: 'check', error: 'close', info: 'info', warn: 'warn' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.title = '点击关闭';
  el.innerHTML = `${ic(iconMap[type] || 'info', 16)}<span>${esc(msg)}</span>`;
  el.addEventListener('click', () => el.remove());
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, dur);
}

/* ================= 模态弹窗 ================= */
let modalSeq = 0;

/**
 * 打开模态框
 * @param {Object} opt { title, body, okText, cancelText, danger, showCancel, onOk, onCancel, width }
 * onOk 返回 false 时保持打开
 */
export function openModal(opt) {
  const id = ++modalSeq;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.modalId = id;
  overlay.innerHTML = `
    <div class="modal" style="${opt.width ? `width:${opt.width}px` : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${esc(opt.title || '')}</h3>
        <button class="modal-x" data-role="x" title="关闭">${ic('close', 15)}</button>
      </div>
      <div class="modal-body">${opt.body || ''}</div>
      <div class="modal-foot">
        ${opt.showCancel === false ? '' : `<button class="btn btn-secondary" data-role="cancel">${esc(opt.cancelText || '取消')}</button>`}
        <button class="btn ${opt.danger ? 'btn-danger' : 'btn-primary'}" data-role="ok">${esc(opt.okText || '确定')}</button>
      </div>
    </div>`;

  const close = (result) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      opt.onCancel?.();
      close();
    }
    if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON' && e.target?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      okBtn.click();
    }
  };

  const okBtn = overlay.querySelector('[data-role="ok"]');
  const cancelBtn = overlay.querySelector('[data-role="cancel"]');
  const xBtn = overlay.querySelector('[data-role="x"]');

  okBtn.addEventListener('click', async () => {
    if (okBtn.disabled) return;
    if (!opt.onOk) {
      close();
      return;
    }
    // 执行期间禁用按钮并显示处理中，避免用户重复点击，
    // 同时让耗时操作（如注册系统计划任务）有明确反馈
    const label = okBtn.textContent;
    okBtn.disabled = true;
    okBtn.classList.add('is-busy');
    okBtn.textContent = opt.loadingText || '处理中…';
    let r;
    try {
      r = await opt.onOk();
    } catch (e) {
      okBtn.disabled = false;
      okBtn.classList.remove('is-busy');
      okBtn.textContent = label;
      throw e;
    }
    if (r === false) {
      okBtn.disabled = false;
      okBtn.classList.remove('is-busy');
      okBtn.textContent = label;
      return;
    }
    close();
  });
  cancelBtn?.addEventListener('click', () => {
    opt.onCancel?.();
    close();
  });
  xBtn.addEventListener('click', () => {
    opt.onCancel?.();
    close();
  });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      opt.onCancel?.();
      close();
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  setTimeout(() => overlay.querySelector('input,select,textarea')?.focus(), 60);
  return { close, overlay };
}

/* ================= 确认框 ================= */
export function confirmDialog({ title, message, okText = '确定', danger = true }) {
  return new Promise((resolve) => {
    const iconMap = { shutdown: 'power', restart: 'restart', sleep: 'moon', hibernate: 'hib', lock: 'lock' };
    openModal({
      title,
      width: 420,
      okText,
      danger,
      body: `<div class="confirm-body">
        <div class="c-icon" style="background:${danger ? '#fef2f2' : '#eef3ff'};color:${danger ? '#f04438' : '#2e5bff'}">${ic('warn', 30)}</div>
        <p>${message}</p>
      </div>`,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}
