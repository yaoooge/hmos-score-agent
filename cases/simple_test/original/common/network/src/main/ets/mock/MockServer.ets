import { stores, Logger } from 'foundation';
import AxiosMockAdapter from '@hw-agconnect/axios-mock-adapter';
import { AxiosRequestConfig, HttpStatusCode, AxiosInstance } from '@ohos/axios';

import * as Api from '../models/ApiModels';

const PREF_MOCK_SESSION_TOKEN: string = 'MOCK_SESSION_TOKEN';

export class MockServer {

  private adapter: AxiosMockAdapter;

  public start(): void {
    /**
     * 静默登录。
     *
     * @see - https://developer.huawei.com/consumer/cn/doc/harmonyos-references/account-api-obtain-user-token
     * @see - https://developer.huawei.com/consumer/cn/doc/harmonyos-references/account-api-get-token-info
     */
    this.adapter.onPost('/auth/silent').reply(async (config: AxiosRequestConfig) => {
      /*
       * Skip:
       * 1. 使用 authorizationCode 获取用户级凭证，即 AccessToken/RefreshToken。
       * 2. 使用 AccessToken 获取 UnionID。
       * 3. 查询 UnionID 当前是否存在有效的手机号关联。
       */
      const req: Api.AuthSilentSignInRequest = JSON.parse(config.data);
      this.log('[POST] [auth.silent] authorizationCode -> ' + req.authorizationCode);
      /*
       * 模拟登录失败结果并响应。
       */
      const resp: Api.AuthSilentSignInResponse = {
        code: -1,
        message: '当前 UnionID 不存在有效的手机号关联'
      };
      return [HttpStatusCode.Ok, resp]; // 也可直接使用 HttpStatusCode.Unauthorized，无需传递 resp
    });
    /**
     * 关联手机号登录。通过 authorizationCode 获取手机号进行关联；使用客户端提供的手机号+短信验证码进行关联。
     *
     * @see - https://developer.huawei.com/consumer/cn/doc/harmonyos-references/account-api-get-user-info-get-phone
     */
    this.adapter.onPost('/auth/phone/bind').reply(async (config: AxiosRequestConfig) => {
      /*
       * Skip:
       * 1. 使用 authorizationCode 获取用户级凭证，即 AccessToken/RefreshToken。
       * 2. 使用 AccessToken 获取 UnionID 以及可能存在的手机号。
       */
      const req: Api.AuthBindPhoneRequest = JSON.parse(config.data);
      this.log('[POST] [auth.phone.bind] authorizationCode -> ' + req.authorizationCode);
      /*
       * Skip:
       * 1. 如果客户端请求中携带了手机号+验证码，优先使用该手机号执行关联流程。
       * 2. 如果手机号验证失败，响应失败结果。
       * 3. 如果手机号验证成功，关联 UnionID，响应 SessionToken。
       */
      this.log('[POST] [auth.phone.bind] phone -> ' + req.phoneNumber);
      this.log('[POST] [auth.phone.bind] sms -> ' + req.smsCode);
      /*
       * Skip:
       * 1. 如果 AccessToken 未能获取手机号，响应失败结果。
       * 2. 如果 AccessToken 成功获取手机号，关联 UnionID，响应 SessionToken。
       */
      const token: string = 'mock_session_token_' + Date.now();
      stores.pref.setValue(PREF_MOCK_SESSION_TOKEN, token);
      stores.pref.flushSync();
      /*
       * 模拟登录成功结果并响应。
       */
      const resp: Api.AuthBindPhoneResponse = {
        code: 0,
        message: 'success',
        sessionToken: token
      };
      return [HttpStatusCode.Ok, resp];
    });
    /**
     * 解除关联手机号。
     */
    this.adapter.onPost('/auth/phone/unlink').reply(async (config: AxiosRequestConfig) => {
      /*
       * Skip:
       * 1. 尝试从请求头的 Authorization 中获取 SessionToken。
       * 2. 根据 Token 结合自身业务逻辑与数据，执行解除关联相关操作。
       */
      this.log('[POST] [auth.phone.unlink] Headers: Authorization -> ' + config.headers?.Authorization);
      /*
       * 客户端仅做通知，不关心服务端解除关联结果，接口默认响应成功。
       */
      return [HttpStatusCode.Ok];
    });
    /**
     * 发送短信验证码。
     */
    this.adapter.onPost('/auth/sms/send-code').reply(async (config: AxiosRequestConfig) => {
      /*
       * Skip:
       * 根据手机号及验证码使用场景，结合自身业务逻辑进行相关操作。
       */
      const req: Api.SendSmsCodeRequest = JSON.parse(config.data);
      this.log('[POST] [auth.sms.send-code] phone -> ' + req.phoneNumber);
      this.log('[POST] [auth.sms.send-code] scene -> ' + req.scene);
      /*
       * 模拟发送成功结果并响应。
       */
      const resp: Api.SendSmsCodeResponse = {
        code: 0,
        message: 'success',
        cooldownSeconds: 60
      };
      return [HttpStatusCode.Ok, resp];
    });
    /**
     * 获取用户信息。
     */
    this.adapter.onGet('/user/info').reply(async (config: AxiosRequestConfig) => {
      this.log('[GET] [user.info] Headers: Authorization -> ' + config.headers?.Authorization);
      /*
       * 模拟鉴权，当 Token 不存在或者与 Mock 缓存不一致时视为鉴权失败。
       */
      const token: string | undefined = config.headers?.Authorization || undefined;
      if (!token || token !== stores.pref.getValue(PREF_MOCK_SESSION_TOKEN, '')) {
        return [HttpStatusCode.Unauthorized];
      };
      /*
       * 模拟成功获取用户信息结果并响应。
       */
      const resp: Api.GetUserInfoResponse = {
        code: 0,
        message: 'success',
        nickname: '用户123',
        avatar: '',
        anonymousPhone: '17*******01'
      };
      return [HttpStatusCode.Ok, resp];
    });
  }

  private log(msg: string): void {
    Logger.debug('[MockServer] ' + msg);
  }

  constructor(axiosInstance: AxiosInstance) {
    this.adapter = new AxiosMockAdapter(axiosInstance, { delayResponse: 270 });
  }
}
