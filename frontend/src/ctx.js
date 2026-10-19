// 跨模块共享上下文（由 main.js 注入实现，避免循环依赖）
export const ctx = {
  refresh: async () => {},
  refreshToTasks: async () => {},
  navigate: () => {},
  toast: () => {},
};
