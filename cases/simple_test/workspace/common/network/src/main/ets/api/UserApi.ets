import { http } from '../HttpClient';
import { GetUserInfoResponse } from '../models/ApiModels';
import { UserInfoDTO } from '../models/dto/UserInfoDTO';

export class UserApi {

  public static async getUserInfo(): Promise<UserInfoDTO> {
    const resp: GetUserInfoResponse = await http.get('/user/info');
    return {
      nickname: resp.nickname ?? '',
      avatar: resp.avatar ?? '',
      anonymousPhone: resp.anonymousPhone ?? ''
    };
  }
}
