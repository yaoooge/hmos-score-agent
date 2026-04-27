import { stores, routerStack, MainTabId, IntentTask } from 'foundation';
import { HomeTabVM } from './HomeTabVM';

@ObservedV2
export class IntentTaskVM {

  private static _instance: IntentTaskVM | null = null;

  private _isInitialized: boolean = false;

  public static getInstance(): IntentTaskVM {
    if (!IntentTaskVM._instance) {
      IntentTaskVM._instance = new IntentTaskVM();
    }
    return IntentTaskVM._instance;
  }

  @Computed
  public get intentTask(): string {
    return stores.cache.intentTask;
  }

  @Monitor('intentTask')
  public onIntentTaskChange(monitor: IMonitor): void {
    const v: IMonitorValue<string> | undefined = monitor.value('intentTask');
    if (v?.now && this._isInitialized) {
      this.handleIntentTask(v?.now);
    }
  }

  public init(): void {
    if (this._isInitialized) {
      return;
    }
    this._isInitialized = true;
    this.handleIntentTask(stores.cache.intentTask);
  }

  private handleIntentTask(intent: string): void {
    if (intent === IntentTask.GO_TO_HOME_PAGE) {
      routerStack.clear();
      stores.cache.activeMainTabId = MainTabId.Home;
    } else if (intent === IntentTask.GO_TO_CHECKIN_PAGE) {
      HomeTabVM.getInstance().goToCheckinPage();
    }
    stores.cache.intentTask = IntentTask.NONE;
  }

  private constructor() {
  }
}
