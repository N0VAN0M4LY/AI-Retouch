// 统一使用 ui-core 的单一事件总线实例
// 重构后此文件作为透传层，避免与 ui-core 组件之间出现两个隔离的事件总线实例
export * from '@ai-retouch/ui-core/hooks/useDataEvents';
