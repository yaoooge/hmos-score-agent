import { window as windowMgr, PromptAction, UIContext } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { Logger } from './Logger';
import { NormalizedError } from './NormalizedError';

export class Toast {

  private static promptAction: PromptAction | undefined = undefined;

  public static init(ctx: UIContext | common.UIAbilityContext): void {
    try {
      if (ctx instanceof UIContext) {
        Toast.promptAction = ctx.getPromptAction();
        return;
      }
      const window: windowMgr.Window = ctx.windowStage.getMainWindowSync();
      Toast.promptAction = window.getUIContext().getPromptAction();
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  public static showMsg(msg: string): void {
    try {
      if (!Toast.promptAction) {
        throw new Error(`Toast is not initialized; skipping toast. msg=${msg}`);
      }
      Toast.promptAction.showToast({ message: msg });
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }
}
