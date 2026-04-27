import { DayPart } from '../common/CustomTypes';
import { MathUtils } from './MathUtils';

export const MINUTES_PER_DAY: number = 1440;
export const DAYS_PER_WEEK: number = 7;
export const MS_PER_DAY: number = 24 * 60 * 60 * 1000;
export const MS_PER_WEEK: number = DAYS_PER_WEEK * MS_PER_DAY;
export const WEEKDAY_LABELS_ZH_CN: readonly string[] = [
  '周日', '周一', '周二', '周三', '周四', '周五', '周六'
];
export const DAY_PART_LABEL_MAP: Map<DayPart, string> = new Map([
  [DayPart.Morning, '上午'],
  [DayPart.Afternoon, '下午'],
  [DayPart.Evening, '晚上']
]);

export class DateUtils {
  /**
   * 判断两个日期是否为同年。
   */
  public static isSameYear(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear();
  }
  /**
   * 判断两个日期是否为同年同月。
   */
  public static isSameMonth(a: Date, b: Date): boolean {
    return DateUtils.isSameYear(a, b) && a.getMonth() === b.getMonth();
  }
  /**
   * 判断两个日期是否为同年同月同日。
   */
  public static isSameDay(a: Date, b: Date): boolean {
    return DateUtils.isSameMonth(a, b) && a.getDate() === b.getDate();
  }
  /**
   * 根据时段类型获取对应描述 (上午/下午/晚上)。
   */
  public static getDayPartLabel(part: DayPart): string {
    return DAY_PART_LABEL_MAP.get(part) ?? '';
  }
  /**
   * 获取日期对应的星期文本，示例：'周一'。
   */
  public static getWeekdayLabel(date: Date, locale: string = 'zh-CN'): string {
    const formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return formatter.format(new Date(date));
  }
  /**
   * 将 dayOfWeek(0=周日..6=周六) 转为星期文本，示例：'周一'。
   */
  public static getWeekdayLabelByDayOfWeek(dayOfWeek: number): string {
    return WEEKDAY_LABELS_ZH_CN[dayOfWeek] ?? '';
  }
  /**
   * 获取传入日期所在周的星期一。
   */
  public static getMonday(date: Date): Date {
    const result: Date = new Date(date);
    // 0: 周日, 1: 周一, 2:...
    const day: number = result.getDay();
    const diffToMonday: number = (day + 6) % 7;
    result.setDate(result.getDate() - diffToMonday);
    result.setHours(0, 0, 0, 0);
    return result;
  }
  /**
   * 获取传入日期自零点起经过的分钟数，区间：[0, 1440)。
   */
  public static getMinuteOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
  }
  /**
   * 将自零点起经过的分钟数格式化为时间字符串，示例：'09:30'。
   */
  public static formatTimeByMinute(minuteOfDay: number): string {
    const m: number = MathUtils.mod(minuteOfDay, MINUTES_PER_DAY);
    const hh: string = String(Math.floor(m / 60)).padStart(2, '0');
    const mm: string = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  /**
   * 将传入日期格式化为 yyyy.mm.dd 风格字符串。
   */
  public static formatDateYmdDot(date: Date): string {
    const year: number = date.getFullYear();
    const month: string = String(date.getMonth() + 1).padStart(2, '0');
    const day: string = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
  /**
   * 将传入日期格式化为 mm.dd 风格字符串。
   */
  public static formatDateMdDot(date: Date): string {
    const month: string = String(date.getMonth() + 1).padStart(2, '0');
    const day: string = String(date.getDate()).padStart(2, '0');
    return `${month}.${day}`;
  }
  /**
   * 将传入日期所在周格式化为周范围字符串 (不显示年份)，示例：'12.29--01.04'。
   */
  public static formatWeekRangeMonToSun(date: Date): string {
    const monday: Date = DateUtils.getMonday(date);
    const sunday: Date = new Date(monday);
    sunday.setDate(monday.getDate() + (DAYS_PER_WEEK - 1));
    const start: string = DateUtils.formatDateMdDot(monday);
    const end: string = DateUtils.formatDateMdDot(sunday);
    return `${start}--${end}`;
  }
}
