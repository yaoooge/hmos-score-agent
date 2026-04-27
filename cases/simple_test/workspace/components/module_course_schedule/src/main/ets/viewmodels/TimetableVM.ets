import { Timetable, Period, DayPart, DayPartBlock, CourseOverviewItem } from '../common/CustomTypes';
import { TimetableUtils } from '../utils/TimetableUtils';
import { DateUtils, DAYS_PER_WEEK, MS_PER_DAY, MS_PER_WEEK } from '../utils/DateUtils';

@ObservedV2
export class TimetableVM {

  @Trace
  private _timetable: Timetable;

  @Trace
  private _weekNum: number = 1;

  @Trace
  public today: Date = new Date();

  /**
   * 时段分块列表，每个分块都对应一个时段描述并持有该时段下的节次索引表。
   *
   * 时段描述：例如 '上午/下午/晚上'；
   * 节次索引表：例如 [0, 1, 2]，表示该时段包含第一节、第二节以及第三节课；
   */
  @Computed
  public get dayPartBlocks(): DayPartBlock[] {
    const periods: Period[] = this._timetable.periods;
    if (periods.length === 0) {
      return [];
    }
    const dayPartBlocks: DayPartBlock[] = [];
    let block: DayPartBlock | null = null;
    let dayPart: DayPart | null = null;
    for (let i: number = 0; i < periods.length; i++) {
      if (!block || dayPart !== periods[i].dayPart) {
        dayPart = periods[i].dayPart;
        block = {
          dayPartLabel: DateUtils.getDayPartLabel(dayPart),
          periodIndices: []
        };
        dayPartBlocks.push(block);
      }
      block.periodIndices.push(i);
    }
    return dayPartBlocks;
  }

  @Computed
  public get monToSunDates(): Date[] {
    const anchorDate: Date = new Date(this._timetable.semester.anchorTimeMs);
    const weekNum: number = TimetableUtils.clampWeekNum(this._timetable, this._weekNum);
    const weekMonday: Date = new Date(
      DateUtils.getMonday(anchorDate).getTime() + (weekNum - 1) * MS_PER_WEEK
    );
    const result: Date[] = [];
    for (let i: number = 0; i < DAYS_PER_WEEK; i++) {
      result.push(new Date(weekMonday.getTime() + i * MS_PER_DAY));
    }
    return result;
  }

  @Computed
  public get weekCourseList(): CourseOverviewItem[] {
    return TimetableUtils.getCourseOverviewListByWeekNum(this._timetable, this._weekNum);
  }

  @Computed
  public get monthStr(): string {
    return String(this.monToSunDates[0].getMonth() + 1).padStart(2, '0');
  }

  public updateTimetable(timetable: Timetable): void {
    this._timetable = TimetableUtils.deepClone(timetable);
  }

  public updateWeekNum(weekNum: number): void {
    this._weekNum = weekNum;
  }

  constructor(timetable: Timetable, weekNum: number) {
    this._timetable = TimetableUtils.deepClone(timetable);
    this._weekNum = weekNum;
  }
}
