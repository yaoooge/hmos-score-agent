import {
  stores,
  routerStack,
  Toast,
  Logger,
  NormalizedError,
  AuthStatus,
  SignOutReason,
  MainTabId
} from 'foundation';
import { authentication as auth } from '@kit.AccountKit';
import { util } from '@kit.ArkTS';
import { UserService } from './UserService';
import { AuthApi } from '../api/AuthApi';

const huaweiIDProvider: auth.HuaweiIDProvider = new auth.HuaweiIDProvider();

export class AccountService {
  /**
   * 根据 AuthorizationCode 进行静默登录，由服务端确认当前是否具备有效的手机关联。
   *
   * @returns 登录结果；
   */
  public static async silentSignIn(): Promise<boolean> {
    try {
      const code: string = await AccountService.getAuthorizationCode();
      const sessionToken: string = await AuthApi.silentSignIn(code);
      if (sessionToken) {
        stores.pref.sessionToken = sessionToken;
        stores.pref.flushSync();
        return true;
      }
      return false;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      return false;
    }
  }
  /**
   * 根据 AuthorizationCode 进行手机关联登录，该 Code 需来自 FunctionalButton，确保其支持手机号获取。
   *
   * @returns 登录结果；
   */
  public static async bindPhoneAndSignIn(code: string): Promise<boolean> {
    try {
      const sessionToken: string = await AuthApi.bindPhoneAndSignIn(code);
      if (sessionToken) {
        stores.pref.sessionToken = sessionToken;
        stores.pref.flushSync();
        return true;
      }
      return false;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      return false;
    }
  }
  /**
   * 根据 AuthorizationCode 以及短信验证码进行手机关联登录。
   *
   * @returns 登录结果；
   */
  public static async bindPhoneBySmsAndSignIn(phone: string, sms: string): Promise<boolean> {
    try {
      const code: string = await AccountService.getAuthorizationCode();
      const sessionToken: string = await AuthApi.bindPhoneAndSignIn(code, phone, sms);
      if (sessionToken) {
        stores.pref.sessionToken = sessionToken;
        stores.pref.flushSync();
        return true;
      }
      return false;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      return false;
    }
  }
  /**
   * 退出登录。
   */
  public static async signOut(reason: SignOutReason = SignOutReason.None): Promise<void> {
    if (stores.cache.authStatus === AuthStatus.SignedOut) {
      return;
    }
    AccountService.clearSessionToken();
    AccountService.cancelAuthorization();
    UserService.clearUserInfo();
    let message: string = '';
    if (reason === SignOutReason.UserInitiated) {
      message = '解除关联成功';
    } else if (reason === SignOutReason.SessionInvalid) {
      if (routerStack.size() > 0) {
        stores.cache.activeMainTabId = MainTabId.Mine;
        routerStack.clear();
      }
      message = '关联状态已失效';
    }
    stores.cache.authStatus = AuthStatus.SignedOut;
    if (message) {
      Toast.showMsg(message);
    }
  }
  /**
   * 开发者服务端可根据该接口返回的 Code 从华为云侧获取 UnionID/OpenID 等字段 (无法获取手机号)。
   *
   * @returns AuthorizationCode；
   */
  public static async getAuthorizationCode(): Promise<string> {
    try {
      const req: auth.LoginWithHuaweiIDRequest = huaweiIDProvider.createLoginWithHuaweiIDRequest();
      req.forceLogin = true;
      req.state = util.generateRandomUUID(false);
      req.nonce = util.generateRandomUUID(false);
      const controller: auth.AuthenticationController = new auth.AuthenticationController();
      const resp: auth.LoginWithHuaweiIDResponse = await controller.executeRequest(req);
      if (resp.state !== req.state) {
        throw new Error(`请求与响应 state 不一致: reqState=${req.state} respState=${resp.state}`);
      }
      const credential: auth.LoginWithHuaweiIDCredential | undefined = resp.data;
      if (!credential) {
        throw new Error('Failed to obtain credential.');
      }
      if (!credential.authorizationCode) {
        throw new Error('Failed to obtain authorization code.');
      }
      return credential.authorizationCode;
    } catch (e) {
      throw NormalizedError.from(e);
    }
  }

  private static async cancelAuthorization(): Promise<void> {
    try {
      const req: auth.CancelAuthorizationRequest = huaweiIDProvider.createCancelAuthorizationRequest();
      const controller: auth.AuthenticationController = new auth.AuthenticationController();
      await controller.executeRequest(req);
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  private static async clearSessionToken(): Promise<void> {
    const token: string = stores.pref.sessionToken;
    if (!token) {
      return;
    }
    try {
      await AuthApi.unlink();
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    } finally {
      if (token === stores.pref.sessionToken) {
        stores.pref.sessionToken = null;
        stores.pref.flushSync();
      }
    }
  }
}
