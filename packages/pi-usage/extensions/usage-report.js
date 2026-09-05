import { fileURLToPath } from 'node:url';

export default function usageReport(pi) {
  let running;
  pi.on('session_shutdown', () => running?.abort());
  pi.registerCommand('usage-report', {
    description: '生成本地用量 HTML 报告：/usage-report [天数，默认 90]；不上传统计数据',
    handler: async (args, ctx) => {
      const days = args.trim() || '90';
      if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 3660) {
        ctx.ui.notify('用法：/usage-report [1–3660]；高级筛选与本地价格覆盖请使用 pi-usage --help。', 'error');
        return;
      }
      if (running) { ctx.ui.notify('报告正在生成，请等待完成。', 'warning'); return; }
      const controller = new AbortController();
      running = controller;
      ctx.ui.setStatus('pi-usage', '正在生成本地用量报告…');
      try {
        const result = await pi.exec(process.execPath, [fileURLToPath(new URL('../bin/pi-usage.js', import.meta.url)), '--days', days], {
          cwd: ctx.cwd, signal: controller.signal, timeout: 900_000,
        });
        if (result.code !== 0 || result.killed) throw new Error('报告生成失败或已取消；请运行 pi-usage 查看错误。');
        const file = result.stdout.trim().split('\n').at(-1);
        // UI only. Never send the report, data or costs to the conversation/model.
        ctx.ui.notify(`本地报告：${file}`, 'info');
        ctx.ui.setWidget('pi-usage-report', [`本地用量报告：${file}`]);
        if (result.stderr.includes('注意：')) ctx.ui.notify('部分数据源不完整，请查看报告内的数据源状态。', 'warning');
      } catch (error) {
        if (!controller.signal.aborted) ctx.ui.notify(error.message, 'error');
      } finally {
        if (running === controller) running = undefined;
        ctx.ui.setStatus('pi-usage', undefined);
      }
    },
  });
}
