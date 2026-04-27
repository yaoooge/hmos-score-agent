

export interface ApiResponseBase {
  code?: number;
  message?: string;
}

export interface AuthSilentSignInRequest {
  authorizationCode: string;
}

export interface AuthSilentSignInResponse extends ApiResponseBase {
  sessionToken?: string;
}

export interface AuthBindPhoneRequest {
  authorizationCode: string;
  phoneNumber?: string;
  smsCode?: string;
}

export interface AuthBindPhoneResponse extends ApiResponseBase {
  sessionToken?: string;
}

export interface SendSmsCodeRequest {
  phoneNumber: string;
  scene: string;
}

export interface SendSmsCodeResponse extends ApiResponseBase {
  cooldownSeconds?: number;
}

export interface GetUserInfoResponse extends ApiResponseBase {
  nickname?: string;
  avatar?: string;
  anonymousPhone?: string;
}
