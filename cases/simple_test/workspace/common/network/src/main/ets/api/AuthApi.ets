import { http } from '../HttpClient';
import {
  AuthSilentSignInRequest,
  AuthSilentSignInResponse,
  AuthBindPhoneRequest,
  AuthBindPhoneResponse,
  SendSmsCodeRequest,
  SendSmsCodeResponse
} from '../models/ApiModels';

export class AuthApi {

  public static async silentSignIn(code: string): Promise<string> {
    const payload: AuthSilentSignInRequest = {
      authorizationCode: code
    };
    const resp: AuthSilentSignInResponse = await http.post('/auth/silent', payload);
    return resp.sessionToken ?? '';
  }

  public static async bindPhoneAndSignIn(code: string, phone?: string, sms?: string): Promise<string> {
    const payload: AuthBindPhoneRequest = {
      authorizationCode: code,
      phoneNumber: phone,
      smsCode: sms
    };
    const resp: AuthBindPhoneResponse = await http.post('/auth/phone/bind', payload);
    return resp.sessionToken ?? '';
  }

  public static async unlink(): Promise<void> {
    await http.post('/auth/phone/unlink');
  }

  public static async sendSmsCode(phone: string, scene: string): Promise<number | undefined> {
    const payload: SendSmsCodeRequest = {
      phoneNumber: phone,
      scene: scene
    };
    const resp: SendSmsCodeResponse = await http.post('/auth/sms/send-code', payload);
    return resp.cooldownSeconds;
  }
}
