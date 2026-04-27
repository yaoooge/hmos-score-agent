import { stores, CommonConst, Logger, NormalizedError } from 'foundation';
import { UserApi } from '../api/UserApi';
import { UserInfoDTO } from '../models/dto/UserInfoDTO';

export class UserService {

  public static async refreshUserInfo(): Promise<void> {
    try {
      const dto: UserInfoDTO = await UserApi.getUserInfo();
      stores.ui.nickname = dto.nickname;
      stores.ui.avatar = dto.avatar;
      stores.ui.anonymousPhone = dto.anonymousPhone;
      stores.ui.hasPhoneBinding = true;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  public static clearUserInfo(): void {
    stores.ui.nickname = CommonConst.DEFAULT_NICKNAME;
    stores.ui.avatar = '';
    stores.ui.anonymousPhone = '';
    stores.ui.hasPhoneBinding = false;
  }
}
