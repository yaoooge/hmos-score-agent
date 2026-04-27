import { AuthStatus, MainTabId, IntentTask } from '../../common/CustomTypes';

@ObservedV2
export class CacheStore {

  public static readonly KEY: string = 'CACHE_STORE';

  /**
   * 登录状态
   */
  @Trace
  public authStatus: AuthStatus = AuthStatus.Unknown;

  /**
   * 已失效的凭证，用于监听器与当前持久化的凭证比较，触发自动登出
   */
  @Trace
  public invalidSessionToken: string = '';

  /**
   * 主页面(根页面) Tab Id，用于触发 Tab Content 切换
   */
  @Trace
  public activeMainTabId: MainTabId = MainTabId.Home;

  /**
   * 课程数据版本，应用启动时默认为 0，课程数据变化时需迭代版本，用于触发课表、首页课程概览等组件刷新状态
   */
  @Trace
  public courseDataVersion: number = 0;

  /**
   * 是否同意了隐私协议
   */
  @Trace
  public hasAcceptedPrivacyPolicy: boolean = false;

  /**
   * 意图任务。
   */
  @Trace
  public intentTask: string = IntentTask.NONE;
}
