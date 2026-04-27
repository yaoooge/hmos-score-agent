
export enum AuthStatus {
  Unknown = 0,
  SignedOut = 1,
  SignedIn = 2
}

export enum SignOutReason {
  None = 0,
  UserInitiated = 1,
  SessionInvalid = 2
}

export enum ErrorCode {
  UNKNOWN_ERROR = -1,
  NO_ERROR = 0,
  PHONE_BINDING_INVALID = 30001
}

export enum AccountErrorCode {
  ACCOUNT_NOT_LOGGED_IN = 1001502001,
  APP_NOT_AUTHORIZED = 1001502002,
  NETWORK_ERROR = 1001502005,
  INTERNAL_ERROR = 1001502009,
  USER_CANCELED = 1001502012,
  SCOPES_OR_PERMISSIONS_NOT_REQUIRED = 1001502014,
  PACKAGE_FINGERPRINT_CHECK_ERROR = 1001500001,
  SCOPES_OR_PERMISSIONS_CHECK_ERROR = 1001500003
}

export enum MainTabId {
  Home = 0,
  Mine = 1
}

export enum FormMode {
  Create = 'CREATE',
  Edit = 'EDIT'
}

export enum StandardCharsets {
  GBK = 'gbk',
  UTF_8 = 'utf-8',
  UTF_16 = 'utf-16'
}

export enum RelativeDay {
  Today = 'TODAY',
  Tomorrow = 'TOMORROW'
}

export enum WidgetActionType {
  Router = 'router',
  Message = 'message',
  Call = 'call'
}

export enum IntentTask {
  NONE = 'NONE',
  GO_TO_HOME_PAGE = 'GO_TO_HOME_PAGE',
  GO_TO_CHECKIN_PAGE = 'GO_TO_CHECKIN_PAGE'
}

export interface FeatureMenuItem {
  label: string;
  routerPageName?: string;
  routerParams?: ESObject;
  action?: () => void;
}

export interface TabsItem {
  id: number;
  label: string | Resource;
  icon: ResourceStr;
  activeIcon: ResourceStr;
  content: WrappedBuilder<[]>;
}
