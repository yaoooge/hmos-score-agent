import {
  Timetable, CourseArrangement, Period, Course,
  DayPart, DayPartPeriodSegment, CourseOverviewItem
} from '../common/CustomTypes';
import { ColorPalette } from './ColorPalette';
import { DateUtils, MS_PER_WEEK } from './DateUtils';
import { WeekMaskUtils } from './WeekMaskUtils';

export class TimetableUtils {
  /**
   * 根据课表节数配置及目标起止节数，获取其对应的时分范围描述。
   *
   * @param start - 起始节数索引；
   * @param end   - 终止节数索引；
   * @returns 时分范围描述 'hh:mm-hh:mm'；
   */
  public static getTimeRangeLabel(timetable: Timetable, start: number, end: number): string {
    const startPeriod: Period | undefined = timetable.periods[start];
    const endPeriod: Period | undefined = timetable.periods[end];
    if (!startPeriod || !endPeriod) {
      return '';
    }
    const startLabel: string = DateUtils.formatTimeByMinute(startPeriod.startMin);
    const endLabel: string = DateUtils.formatTimeByMinute(endPeriod.endMin);
    return `${startLabel}-${endLabel}`;
  }
  /**
   * 结合课表，获取目标日期相对于锚点日期属于第几周。
   *
   * @param timetable - 课表源数据；
   * @param date      - 目标日期；
   * @returns 相对周数 (1: 第一周, 2: 第二周, 3: ...)；
   */
  public static getWeekNumByDate(timetable: Timetable, date: Date, needClamp: boolean = true): number {
    const anchorDay: Date = new Date(timetable.semester.anchorTimeMs);
    const anchorMonday: Date = DateUtils.getMonday(anchorDay);
    const targetMonday: Date = DateUtils.getMonday(date);
    const diffMs: number = targetMonday.getTime() - anchorMonday.getTime();
    const weekNum: number = Math.floor(diffMs / MS_PER_WEEK) + 1;
    return needClamp ? TimetableUtils.clampWeekNum(timetable, weekNum) : weekNum;
  }
  /**
   * 判断一个课程安排在指定日期是否生效。
   *
   * @returns true: 生效, false: 不生效；
   */
  public static isArrangementOnDate(timetable: Timetable, arrangement: CourseArrangement, date: Date): boolean {
    const weekNum: number = TimetableUtils.getWeekNumByDate(timetable, date, false);
    const isOnTargetWeek: boolean = WeekMaskUtils.isWeekInMask(arrangement.weekMask, weekNum);
    const isOnTargetDay: boolean = arrangement.dayOfWeek === date.getDay();
    return isOnTargetWeek && isOnTargetDay;
  }
  /**
   * 将某一周数规范化到课表的有效范围内。
   *
   * @returns 规范化后的周数 (1: 第一周, 2: 第二周, 3: ...)；
   */
  public static clampWeekNum(timetable: Timetable, week: number): number {
    const weekCount: number = timetable.semester.weekCount;
    const w: number = Number.isFinite(week) ? Math.trunc(week) : 1;
    if (w < 1) {
      return 1;
    }
    if (w > weekCount) {
      return weekCount;
    }
    return w;
  }
  /**
   * 将给定起止节数按照课表时段分割。
   *
   * @param timetable - 课表源数据；
   * @param start - 起始节数索引；
   * @param end   - 终止节数索引；
   * @returns 切分后的课程节次段落；
   */
  public static splitPeriodRangeByDayPart(timetable: Timetable, start: number, end: number): DayPartPeriodSegment[] {
    if (start < 0 || end < 0 || end < start) {
      return [];
    }
    const periods: Period[] = timetable.periods;
    if (end >= periods.length) {
      return [];
    }
    const segments: DayPartPeriodSegment[] = [];
    let segStart: number = start;
    let segDayPart: DayPart = periods[start].dayPart;
    for (let i: number = start; i <= end; i++) {
      const part: DayPart = periods[i].dayPart;
      if (part !== segDayPart) {
        segments.push({
          periodStart: segStart,
          periodEnd: i - 1,
          dayPart: segDayPart
        });
        segStart = i;
        segDayPart = part;
      }
    }
    segments.push({
      periodStart: segStart,
      periodEnd: end,
      dayPart: segDayPart
    });
    return segments;
  }
  /**
   * 获取指定日期的课程概览列表。
   *
   * @param timetable - 课表源数据；
   * @param date      - 目标日期；
   * @returns 当日全部课程概览列表，顺序按照课程起始节次从低到高；
   */
  public static getCourseOverviewListByDate(timetable: Timetable, date: Date): CourseOverviewItem[] {
    const list: CourseOverviewItem[] = TimetableUtils.getCourseOverviewList(
      timetable,
      arrangement => TimetableUtils.isArrangementOnDate(timetable, arrangement, date)
    );
    return list.sort((a, b) => a.periodStart - b.periodStart);
  }
  /**
   * 获取指定周的课程概览列表。
   *
   * @param timetable - 课表源数据；
   * @param weekNum   - 第几周；
   * @returns 该周全部课程概览列表，无序；
   */
  public static getCourseOverviewListByWeekNum(timetable: Timetable, weekNum: number): CourseOverviewItem[] {
    return TimetableUtils.getCourseOverviewList(
      timetable,
      arrangement => WeekMaskUtils.isWeekInMask(arrangement.weekMask, weekNum)
    );
  }
  /**
   * 获取课程概览列表。
   *
   * @param timetable - 课表源数据；
   * @param filter    - 课程安排过滤器；
   * @returns 过滤后的课程概览列表；
   */
  public static getCourseOverviewList(
    timetable: Timetable,
    filter: (arrangement: CourseArrangement) => boolean
  ): CourseOverviewItem[] {
    const result: CourseOverviewItem[] = [];
    const courses: Course[] = timetable.courses;
    for (const course of courses) {
      for (const arrangement of course.arrangements) {
        if (!filter(arrangement)) {
          continue;
        }
        const segments: DayPartPeriodSegment[] = TimetableUtils.splitPeriodRangeByDayPart(
          timetable,
          arrangement.periodStart,
          arrangement.periodEnd
        );
        for (const seg of segments) {
          result.push({
            courseId: course.id,
            name: course.name,
            color: course.color || ColorPalette.getColor(0),
            arrangementId: arrangement.id,
            location: arrangement.location,
            teacher: arrangement.teacher,
            dayOfWeek: arrangement.dayOfWeek,
            periodStart: seg.periodStart,
            periodEnd: seg.periodEnd,
            timeRangeLabel: TimetableUtils.getTimeRangeLabel(timetable, seg.periodStart, seg.periodEnd),
            dayPartLabel: DateUtils.getDayPartLabel(seg.dayPart)
          });
        }
      }
    }
    return result;
  }
  /**
   * 判断两个课程安排是否存在时间冲突。
   *
   * @returns true: 存在冲突, false: 不存在冲突；
   */
  public static isArrangementTimeConflict(a: CourseArrangement, b: CourseArrangement): boolean {
    if (a.id === b.id) {
      return false;
    }
    if ((a.weekMask & b.weekMask) === 0) {
      return false;
    }
    if (a.dayOfWeek !== b.dayOfWeek) {
      return false;
    }
    const aStart: number = Math.min(a.periodStart, a.periodEnd);
    const aEnd: number = Math.max(a.periodStart, a.periodEnd);
    const bStart: number = Math.min(b.periodStart, b.periodEnd);
    const bEnd: number = Math.max(b.periodStart, b.periodEnd);
    return !(aEnd < bStart || bEnd < aStart);
  }
  /**
   * 判断一门课程自身的所有课程安排是否存在时间冲突。
   *
   * @returns true: 存在冲突, false: 不存在冲突；
   */
  public static hasSelfArrangementConflict(course: Course): boolean {
    const arr: CourseArrangement[] = course.arrangements;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (TimetableUtils.isArrangementTimeConflict(arr[i], arr[j])) {
          return true;
        }
      }
    }
    return false;
  }
  /**
   * 判断两门课程的课程安排彼此是否存在时间冲突。
   *
   * @returns true: 存在冲突, false: 不存在冲突；
   */
  public static isCourseTimeConflict(a: Course, b: Course): boolean {
    if (a.id === b.id) {
      return false;
    }
    for (const x of a.arrangements) {
      for (const y of b.arrangements) {
        if (TimetableUtils.isArrangementTimeConflict(x, y)) {
          return true;
        }
      }
    }
    return false;
  }
  /**
   * 向课表新增或覆盖 id 相同的课程。
   *
   * @returns true: 本次新增发生了覆盖行为, false: 本次新增未覆盖任何课程；
   */
  public static upsertCourse(timetable: Timetable, course: Course): boolean {
    const courses: Course[] = timetable.courses;
    const index: number = courses.findIndex(c => c.id === course.id);
    if (index === -1) {
      courses.push(course);
      return false;
    }
    courses[index] = course;
    return true;
  }
  /**
   * 根据锚点日期获取学期描述。
   *
   * @returns 学期描述；
   */
  public static getSemesterLabelByDate(anchorDate: Date): string {
    const y: number = anchorDate.getFullYear();
    const m: number = anchorDate.getMonth() + 1;
    const isTerm1: boolean = m >= 8;
    const schoolYearStart: number = isTerm1 ? y : y - 1;
    const schoolYearEnd: number = schoolYearStart + 1;
    const termNo: 1 | 2 = isTerm1 ? 1 : 2;
    return `${schoolYearStart}-${schoolYearEnd}学年 第${termNo}学期`;
  }
  /**
   * 对课表源数据进行深拷贝。
   */
  public static deepClone(timetable: Timetable): Timetable {
    return {
      id: timetable.id,
      semester: {
        label: timetable.semester.label,
        anchorTimeMs: timetable.semester.anchorTimeMs,
        weekCount: timetable.semester.weekCount
      },
      periods: timetable.periods.map(period  => (
        {
          dayPart: period .dayPart,
          startMin: period .startMin,
          endMin: period.endMin
        } as Period
      )),
      courses: timetable.courses.map(course => (
        {
          id: course.id,
          name: course.name,
          color: course.color,
          arrangements: course.arrangements.map(arrangement => (
            {
              id: arrangement.id,
              courseId: arrangement.courseId,
              dayOfWeek: arrangement.dayOfWeek,
              periodStart: arrangement.periodStart,
              periodEnd: arrangement.periodEnd,
              location: arrangement.location,
              teacher: arrangement.teacher,
              weekMask: arrangement.weekMask
            } as CourseArrangement
          ))
        } as Course
      ))
    };
  }
}
