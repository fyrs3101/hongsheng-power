import { invoke } from '@tauri-apps/api/core';

export const api = {
  bootstrap: () => invoke('get_bootstrap'),
  createTask: (payload) => invoke('create_task', { payload }),
  updateTask: (id, payload) => invoke('update_task', { id, payload }),
  deleteTask: (id) => invoke('delete_task', { id }),
  setTaskEnabled: (id, enabled) => invoke('set_task_enabled', { id, enabled }),
  runTaskNow: (id) => invoke('run_task_now', { id }),
  syncTasks: () => invoke('sync_tasks'),
  immediateAction: (action) => invoke('immediate_action', { action }),
  startCountdown: (action, minutes) => invoke('start_countdown', { action, minutes }),
  cancelCountdown: () => invoke('cancel_countdown'),
  setAutostart: (enabled) => invoke('set_autostart', { enabled }),
  setMinimizeToTray: (enabled) => invoke('set_minimize_to_tray', { enabled }),
  verifyPassword: (password) => invoke('verify_password', { password }),
  setPassword: (oldPassword, newPassword) =>
    invoke('set_password', { oldPassword: oldPassword || null, newPassword }),
  clearPassword: (oldPassword) => invoke('clear_password', { oldPassword }),
  relaunchElevated: () => invoke('relaunch_elevated'),
  enableHibernate: () => invoke('enable_hibernate'),
  openDataDir: () => invoke('open_data_dir'),
  getLogs: () => invoke('get_logs'),
  clearLogs: () => invoke('clear_logs'),
};
