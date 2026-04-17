import type { WorkflowLifecycleEvent } from "./types.js";

type BaseLogger = {
  info(message: string): Promise<void>;
  error(message: string): Promise<void>;
};

// WorkflowEventLogger 负责把统一事件翻译成中文节点日志。
export class WorkflowEventLogger {
  constructor(private readonly logger: BaseLogger) {}

  async log(event: WorkflowLifecycleEvent): Promise<void> {
    if (event.type === "node_started") {
      await this.logger.info(`节点开始 node=${event.nodeId} label=${event.label}`);
      return;
    }

    if (event.type === "node_completed") {
      await this.logger.info(
        `节点完成 node=${event.nodeId} label=${event.label} summary=${event.summary}`,
      );
      return;
    }

    await this.logger.error(
      `节点失败 node=${event.nodeId} label=${event.label} error=${event.errorMessage ?? "unknown"}`,
    );
  }
}
