import { privacyManager } from '@kit.AppGalleryKit';
import { BusinessError, commonEventManager, deviceInfo } from '@kit.BasicServicesKit';
import { stores } from '../storage/Stores';
import { Logger } from './Logger';
import { NormalizedError } from './NormalizedError';

const PRIVACY_STATE_CHANGED_EVENT: string = 'usual.event.PRIVACY_STATE_CHANGED';

interface PrivacyStateChangedResult {
  resultType: privacyManager.AppPrivacyResultType;
  appIndex: number;
}

export class AppPrivacyUtils {

  private static _subscriber: commonEventManager.CommonEventSubscriber | undefined = undefined;

  public static refreshPrivacyPolicyAcceptance(): void {
    let accepted: boolean = true;
    if (deviceInfo.productModel !== 'emulator') {
      try {
        const results: privacyManager.AppPrivacyResult[] = privacyManager.getAppPrivacyResult();
        Logger.info(`AppPrivacyResultList: ${JSON.stringify(results, null, 2)}`);
        accepted =
          results.length > 0 &&
          results.every(v => v.result === privacyManager.AppPrivacyResultType.FULL_MODE_AGREED);
      } catch (e) {
        // todo: 隐私协议获取异常，为兼容本地调试和云调试场景，当前仍作同意处理
        Logger.error(NormalizedError.from(e).toLogLine());
      }
    }
    stores.cache.hasAcceptedPrivacyPolicy = accepted;
  }

  public static async subscribe(callback?: () => void): Promise<void> {
    Logger.info('正在订阅隐私协议状态变化事件...');
    const subscribeInfo: commonEventManager.CommonEventSubscribeInfo = {
      events: [
        PRIVACY_STATE_CHANGED_EVENT
      ]
    };
    try {
      AppPrivacyUtils._subscriber = await commonEventManager.createSubscriber(subscribeInfo);
      commonEventManager.subscribe(AppPrivacyUtils._subscriber,
        (e: BusinessError, data: commonEventManager.CommonEventData): void => {
          if (e) {
            Logger.error(NormalizedError.from(e).toLogLine());
            return;
          }
          const result = JSON.parse(data?.data ?? '{}') as PrivacyStateChangedResult;
          const agreeFlag: boolean = result?.resultType === privacyManager.AppPrivacyResultType.FULL_MODE_AGREED;
          Logger.info(`隐私协议状态发生变化，当前状态: ${agreeFlag ? '已同意' : '未同意'}`);
          stores.cache.hasAcceptedPrivacyPolicy = agreeFlag;
          callback && callback();
        }
      );
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  public static unsubscribe(): void {
    if (AppPrivacyUtils._subscriber) {
      commonEventManager.unsubscribe(AppPrivacyUtils._subscriber);
    }
  }
}
