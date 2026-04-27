import {
  stores,
  MainTabId,
  NormalizedError,
  AuthStatus,
  SignOutReason,
  CommonConst,
  AppPrivacyUtils,
  Logger,
  IntentTask
} from 'foundation';
import { AccountService, UserService } from 'network';
import { Timetable, TimetableUtils } from 'module_course_schedule';
import { util } from '@kit.ArkTS';

import { IntentTaskVM } from './IntentTaskVM';
import { MainEntryConfig as Config } from '../common/MainEntryConfig';

@ObservedV2
export class MainEntryVM {

  private static _instance: MainEntryVM | null = null;

  public static getInstance(): MainEntryVM {
    if (!MainEntryVM._instance) {
      MainEntryVM._instance = new MainEntryVM();
    }
    return MainEntryVM._instance;
  }

  @Computed
  public get activeMainTabIndex(): MainTabId {
    const activeId: MainTabId = stores.cache.activeMainTabId;
    const index: number = Config.TAB_LIST.findIndex(tab => tab.id === activeId);
    if (index < 0) {
      throw new NormalizedError(`MainTabId not found: ${activeId}`);
    }
    return index;
  }

  @Computed
  public get invalidSessionToken(): string {
    return stores.cache.invalidSessionToken;
  }

  @Monitor('invalidSessionToken')
  public onInvalidSessionTokenChange(monitor: IMonitor): void {
    const v: IMonitorValue<string> | undefined = monitor.value('invalidSessionToken');
    if (v?.now && v.now === stores.pref.sessionToken) {
      AccountService.signOut(SignOutReason.SessionInvalid);
    }
  }

  public init(): void {
    AppPrivacyUtils.refreshPrivacyPolicyAcceptance();
    Logger.info(`主页面初始化执行中，当前隐私协议状态: ${stores.cache.hasAcceptedPrivacyPolicy ? '已同意' : '未同意'}`);
    if (stores.cache.hasAcceptedPrivacyPolicy) {
      this.realInit();
      return;
    }
    AppPrivacyUtils.subscribe(() => {
      if (stores.cache.hasAcceptedPrivacyPolicy) {
        this.realInit();
      }
    });
  }

  private realInit(): void {
    if (stores.cache.intentTask !== IntentTask.NONE) {
      if (!stores.pref.sessionToken) {
        UserService.clearUserInfo();
        stores.cache.authStatus = AuthStatus.SignedOut;
      } else {
        UserService.refreshUserInfo();
        stores.cache.authStatus = AuthStatus.SignedIn;
      }
    } else {
      this.initAuthStatusAndUserInfo();
    }
    IntentTaskVM.getInstance().init();
  }

  private async initAuthStatusAndUserInfo(): Promise<void> {
    if (stores.cache.authStatus !== AuthStatus.Unknown) {
      return;
    }
    if (!stores.pref.sessionToken) {
      const result: boolean = await AccountService.silentSignIn();
      if (!result) {
        UserService.clearUserInfo();
        stores.cache.authStatus = AuthStatus.SignedOut;
        return;
      }
    }
    stores.cache.authStatus = AuthStatus.SignedIn;
    await UserService.refreshUserInfo();
    if (!stores.ui.hasPhoneBinding) {
      AccountService.signOut(SignOutReason.None);
    }
  }

  private initSchoolTimetable(): void {
    const timetable: Timetable = stores.pref.timetable;
    if (!timetable.id) {
      const today: Date = new Date();
      today.setHours(0, 0, 0, 0);
      stores.pref.timetable = {
        id: util.generateRandomUUID(false),
        semester: {
          label: TimetableUtils.getSemesterLabelByDate(today),
          anchorTimeMs: today.getTime(),
          weekCount: CommonConst.DEFAULT_TOTAL_WEEKS
        },
        periods: [...CommonConst.DEFAULT_PERIODS],
        courses: []
      };
      stores.pref.flushSync();
    }
  }

  private constructor() {
    this.initSchoolTimetable();
  }
}
