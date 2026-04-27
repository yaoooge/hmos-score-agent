import { UserInfo } from 'atomicservice_login';
import { stores, NormalizedError, Logger, AuthStatus, CommonConst, SignOutReason } from 'foundation';
import { AccountService, UserService } from 'network';

@ObservedV2
export class MineTabVM {

  @Computed
  public get userInfo(): UserInfo {
    const info: UserInfo = new UserInfo();
    info.avatar = stores.ui.avatar || CommonConst.DEFAULT_AVATAR;
    info.userName = stores.ui.nickname || CommonConst.DEFAULT_NICKNAME;
    info.phoneNumber = stores.ui.anonymousPhone;
    return info;
  }

  public async bindPhone(code: string | undefined): Promise<void> {
    if (stores.cache.authStatus !== AuthStatus.SignedOut) {
      return;
    }
    stores.cache.authStatus = AuthStatus.Unknown;
    try {
      if (!code) {
        throw new Error('AuthorizationCode 不存在');
      }
      if (!await AccountService.bindPhoneAndSignIn(code)) {
        throw new Error('账号关联失败');
      }
      await UserService.refreshUserInfo();
      if (!stores.ui.hasPhoneBinding) {
        throw new Error('用户信息刷新失败');
      }
      stores.cache.authStatus = AuthStatus.SignedIn;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      AccountService.signOut(SignOutReason.None);
    }
  }

  public async unBindPhone(): Promise<void> {
    AccountService.signOut(SignOutReason.UserInitiated);
  }
}
