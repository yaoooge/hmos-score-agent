import { UIBase } from '@hw-agconnect/ui-base';
import { stores, Toast, NormalizedError, Logger, ErrorCode, RouterConst, FileUtils } from 'foundation';
import { window } from '@kit.ArkUI';
import { UIAbility, ConfigurationConstant, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

export default class EntryAbility extends UIAbility {

  public onNewWant(want: Want): void {
    this.handleWant(want);
  }

  public onCreate(want: Want): void {
    this.handleWant(want);
    try {
      // 当前未适配深色模式，不跟随系统设置
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  public onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent(RouterConst.MAIN_ENTRY_PAGE_PATH, (e: BusinessError<void>) => {
      const err: NormalizedError = NormalizedError.from(e);
      if (err.code !== ErrorCode.NO_ERROR) {
        Logger.error(err.toLogLine());
        return;
      }
      UIBase.init(windowStage);
      stores.init(this.context);
      Toast.init(this.context);
      FileUtils.init(this.context);
    });
  }

  private handleWant(want: Want): void {
    if (typeof want.parameters?.intentTask === 'string') {
      stores.cache.intentTask = want.parameters.intentTask;
    }
  }
}
