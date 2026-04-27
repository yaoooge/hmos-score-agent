import { CourseOverviewItem, Period, DateUtils, Timetable, TimetableUtils } from 'module_course_schedule';
import { stores, NormalizedError, Logger, RelativeDay, AuthStatus, routerStack, Toast } from 'foundation';
import { CHECKIN_PAGE_NAME } from 'module_secure_checkin';

@ObservedV2
export class HomeTabVM {

  public static getInstance(): HomeTabVM {
    if (!HomeTabVM._instance) {
      HomeTabVM._instance = new HomeTabVM();
    }
    return HomeTabVM._instance;
  }

  private static _instance: HomeTabVM | null = null;

  @Trace
  private _timetable: Timetable = TimetableUtils.deepClone(stores.pref.timetable);

  @Trace
  private _today: Date = new Date();

  @Trace
  private _minuteOfToday: number = DateUtils.getMinuteOfDay(this._today);

  @Trace
  private _todayCourseList: CourseOverviewItem[] = [];

  @Trace
  private _tomorrowCourseList: CourseOverviewItem[] = [];

  @Trace
  public previewDay: RelativeDay = RelativeDay.Today;

  @Computed
  public get courseDateLabel(): string {
    const date: Date = new Date(this._today.getTime());
    if (this.previewDay === RelativeDay.Tomorrow) {
      date.setDate(date.getDate() + 1);
    }
    return DateUtils.formatDateYmdDot(date);
  }

  @Computed
  public get courseList(): CourseOverviewItem[] {
    if (this.previewDay === RelativeDay.Today) {
      return this._todayCourseList;
    } else {
      return this._tomorrowCourseList;
    }
  }

  @Computed
  public get courseDataVersion(): number {
    return stores.cache.courseDataVersion;
  }

  @Monitor('courseDataVersion')
  public onCourseDataVersionChange(): void {
    this._timetable = TimetableUtils.deepClone(stores.pref.timetable);
    this.refreshCourseList();
  }

  private refreshCourseList(): void {
    const today: Date = new Date(this._today.getTime());
    const tomorrow: Date = new Date(this._today.getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    this._todayCourseList = TimetableUtils.getCourseOverviewListByDate(this._timetable, today);
    this._tomorrowCourseList = TimetableUtils.getCourseOverviewListByDate(this._timetable, tomorrow);
  }

  @Computed
  public get finishedPeriodIndex(): number {
    const periods: Period[] = this._timetable.periods;
    const minuteOfDay: number = this._minuteOfToday;
    let index: number = -1;
    for (const period of periods) {
      if (minuteOfDay >= period.endMin) {
        index++;
      }
    }
    return index;
  }

  public goToCheckinPage(): void {
    switch (stores.cache.authStatus) {
      case AuthStatus.SignedIn:
        routerStack.pushOrPopToName(CHECKIN_PAGE_NAME);
        break;
      case AuthStatus.SignedOut:
        Toast.showMsg('请关联账号后使用签到');
        break;
      case AuthStatus.Unknown:
      default:
        Toast.showMsg('网络繁忙，请稍后重试');
    }
  }

  private handleSecondTick(): void {
    try {
      const now: Date = new Date();
      this._minuteOfToday = DateUtils.getMinuteOfDay(now);
      if (!DateUtils.isSameDay(this._today, now)) {
        this._today = now;
        this.refreshCourseList();
      }
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    } finally {
      const delay : number = 1000 - (Date.now() % 1000);
      setTimeout(() => this.handleSecondTick(), delay);
    }
  }

  private constructor() {
    this.refreshCourseList();
    this.handleSecondTick();
  }
}
