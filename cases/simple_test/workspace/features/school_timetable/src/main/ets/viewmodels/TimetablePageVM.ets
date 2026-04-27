import { stores } from 'foundation';
import { DateUtils, Timetable, TimetableUtils, TimetableVM } from 'module_course_schedule';

@ObservedV2
export class TimetablePageVM {

  @Trace
  private _timetableData: Timetable = TimetableUtils.deepClone(stores.pref.timetable);

  @Trace
  private _weekNum: number = TimetableUtils.getWeekNumByDate(this._timetableData, new Date());

  @Trace
  public timetable: TimetableVM = new TimetableVM(this._timetableData, this._weekNum);

  @Trace
  public isFeatureMenuShown: boolean = false;

  @Computed
  public get weekNum(): number {
    return this._weekNum;
  }

  @Computed
  public get weekRangeLabel(): string {
    // 以锚点日期为基准，计算出任意一个属于第 weekNum 周的日期
    const date: Date = new Date(this._timetableData.semester.anchorTimeMs);
    date.setDate(date.getDate() + (this._weekNum - 1) * 7);
    return DateUtils.formatWeekRangeMonToSun(date);
  }

  @Computed
  public get courseDataVersion(): number {
    return stores.cache.courseDataVersion;
  }

  @Monitor('courseDataVersion')
  public onCourseDataVersionChange(): void {
    this._timetableData = TimetableUtils.deepClone(stores.pref.timetable);
    this._weekNum = TimetableUtils.clampWeekNum(this._timetableData, this._weekNum);
    this.timetable.updateWeekNum(this._weekNum);
    this.timetable.updateTimetable(this._timetableData);
  }

  public setWeekNum(weekNum: number): void {
    this._weekNum = TimetableUtils.clampWeekNum(this._timetableData, weekNum);
    this.timetable.updateWeekNum(this._weekNum);
  }

  public getAnchorDate(): Date {
    return new Date(this._timetableData.semester.anchorTimeMs);
  }

  public setAnchorDate(date: Date): void {
    this._timetableData.semester.anchorTimeMs = date.getTime();
    this._timetableData.semester.label = TimetableUtils.getSemesterLabelByDate(date);
    stores.pref.timetable = this._timetableData;
    stores.pref.flushSync();
    stores.cache.courseDataVersion++;
  }
}
