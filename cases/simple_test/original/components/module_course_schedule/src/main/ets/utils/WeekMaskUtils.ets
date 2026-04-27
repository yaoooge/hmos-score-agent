import { WeekSelectMode } from '../common/CustomTypes';

const SAFE_MASK_BITS: number = 31;
const ODD_MASK_32: number = 0x55555555; // 0x55 -> 0b01010101
const EVEN_MASK_32: number = 0xAAAAAAAA; // 0xAA -> 0b10101010

/**
 * 提供与 '周选择掩码 (weekMask)' 相关的工具方法。
 *
 * 1. 周选择掩码
 * 将 bit0 ~ bit30 从低位到高位依次表示 1 ~ 31 周的选择情况，1 表示选中，0 表示未选中。
 *
 * 2. 设计约束
 * ArkTS 位运算基于 32-bit 有符号整数，为避免溢出以及符号位干扰，本工具类仅使用低 31 位。
 */
export class WeekMaskUtils {
  /**
   * 根据周选择模式和总周数获取对应掩码。
   *
   * @param mode      - 周选择模式；
   * @param weekCount - 总共有几周 (1 <= weekCount <= 31)；
   * @returns 周选择掩码；
   */
  public static getWeekMaskBySelectMode(mode: WeekSelectMode, weekCount: number): number {
    if (!WeekMaskUtils.isValidWeekCount(weekCount)) {
      return 0;
    }
    const validMask: number = (1 << weekCount) - 1;
    switch (mode) {
      case WeekSelectMode.All:
        return validMask;
      case WeekSelectMode.Odd:
        return ODD_MASK_32 & validMask;
      case WeekSelectMode.Even:
        return EVEN_MASK_32 & validMask;
      case WeekSelectMode.Custom:
      default:
        return 0;
    }
  }
  /**
   * 根据周选择掩码和总周数获取对应选择模式。
   *
   * @param weekMask  - 周选择掩码；
   * @param weekCount - 总共有几周 (1 <= weekCount <= 31)；
   * @returns 周选择模式；
   */
  public static getWeekSelectModeByMask(weekMask: number, weekCount: number): WeekSelectMode {
    if (!WeekMaskUtils.isValidWeekCount(weekCount)) {
      return WeekSelectMode.Custom;
    }
    const validMask: number = (1 << weekCount) - 1;
    if ((weekMask & validMask) !== weekMask) {
      return WeekSelectMode.Custom;
    }
    if (weekMask === validMask) {
      return WeekSelectMode.All;
    }
    if (weekMask === (ODD_MASK_32 & validMask)) {
      return WeekSelectMode.Odd;
    }
    if (weekMask === (EVEN_MASK_32 & validMask)) {
      return WeekSelectMode.Even;
    }
    return WeekSelectMode.Custom;
  }
  /**
   * 根据周选择掩码和总周数获取对应文本描述。
   *
   * @param weekMask  - 周选择掩码；
   * @param weekCount - 总共有几周 (1 <= weekCount <= 31)；
   * @returns 周选择文本描述；
   */
  public static getWeekLabelByMask(weekMask: number, weekCount: number): string {
    if (!WeekMaskUtils.isValidWeekCount(weekCount)) {
      return '';
    }
    // 未选择任何周，或选择的某些周超出了总周数范围
    const validMask: number = (1 << weekCount) - 1;
    if (weekMask === 0 || (weekMask & validMask) !== weekMask) {
      return '';
    }
    if ((weekMask & (weekMask - 1)) === 0) {
      const bitIndex: number = 31 - Math.clz32(weekMask);
      return `第${bitIndex + 1}周`;
    }
    const mode: WeekSelectMode = WeekMaskUtils.getWeekSelectModeByMask(weekMask, weekCount);
    if (mode === WeekSelectMode.All) {
      return `第1-${weekCount}周`;
    }
    if (mode === WeekSelectMode.Odd) {
      const end: number = (weekCount % 2 === 1) ? weekCount : (weekCount - 1);
      return `第1-${end}周 (单周)`;
    }
    if (mode === WeekSelectMode.Even) {
      const end: number = (weekCount % 2 === 0) ? weekCount : (weekCount - 1);
      return `第2-${end}周 (双周)`;
    }
    return WeekMaskUtils.getCustomWeekLabelByMask(weekMask, weekCount);
  }
  /**
   * 校验某一周是否属于某一选择掩码。
   *
   * @returns 校验结果 (true: 属于, false: 不属于)；
   */
  public static isWeekInMask(weekMask: number, week: number): boolean {
    if (!WeekMaskUtils.isValidWeekCount(week)) {
      return false;
    }
    const bit: number = 1 << (week - 1);
    return (weekMask & bit) !== 0;
  }
  /**
   * 将指定周加入选择掩码。
   *
   * @returns 周选择掩码；
   */
  public static addWeekToMask(weekMask: number, week: number): number {
    if (!WeekMaskUtils.isValidWeekCount(week)) {
      return weekMask;
    }
    return weekMask | (1 << (week - 1));
  }
  /**
   * 将指定周从选择掩码中移除。
   *
   * @returns 周选择掩码；
   */
  public static removeWeekFromMask(weekMask: number, week: number): number {
    if (!WeekMaskUtils.isValidWeekCount(week)) {
      return weekMask;
    }
    return weekMask & ~(1 << (week - 1));
  }
  /**
   * 校验周总数是否为合法值。
   *
   * @returns 校验结果 (true: 合法, false: 不合法)；
   */
  private static isValidWeekCount(weekCount: number): boolean {
    return Number.isInteger(weekCount) && weekCount > 0 && weekCount <= SAFE_MASK_BITS;
  }
  /**
   * 根据周选择掩码和总周数获取对应文本描述。(采用自定义模式风格，适用于无规律选择)。
   *
   * @param weekMask  - 周选择掩码；
   * @param weekCount - 总共有几周 (1 <= weekCount <= 31)；
   * @returns 周选择文本描述；
   */
  private static getCustomWeekLabelByMask(weekMask: number, weekCount: number): string {
    const parts: string[] = [];
    /*
     * 遍历第 1 ~ weekCount 周。
     */
    let w: number = 1;
    while (w <= weekCount) {
      /*
       * 校验第 w 周是否被选中。
       */
      const bit: number = 1 << (w - 1);
      if ((weekMask & bit) === 0) {
        w++;
        continue;
      }
      /*
       * 计算从 w 周开始，连续多少周都被选中。
       */
      const start: number = w;
      let end: number = w;
      while (end < weekCount) {
        const nextBit: number = 1 << end;
        if ((weekMask & nextBit) === 0) {
          break;
        }
        end++;
      }
      /*
       * 生成并保存这一段连续周的范围描述。
       */
      if (start === end) {
        parts.push(`第${start}周`);
      } else {
        parts.push(`第${start}-${end}周`);
      }
      w = end + 1;
    }
    return parts.join(' ');
  }
}
