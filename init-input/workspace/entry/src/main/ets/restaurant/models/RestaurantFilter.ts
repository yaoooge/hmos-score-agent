/**
 * 餐厅筛选条件模型
 */

/**
 * 评分筛选选项
 */
export type RatingFilterOption = 'all' | '4.5+' | '4.0+' | '3.5+' | '3.0+';

/**
 * 评分筛选配置
 */
export interface RatingFilterConfig {
  label: string;
  value: RatingFilterOption;
  minRating: number;
}

/**
 * 评分筛选选项列表
 */
export const RATING_FILTER_OPTIONS: RatingFilterConfig[] = [
  { label: '全部', value: 'all', minRating: 0 },
  { label: '4.5分以上', value: '4.5+', minRating: 4.5 },
  { label: '4.0分以上', value: '4.0+', minRating: 4.0 },
  { label: '3.5分以上', value: '3.5+', minRating: 3.5 },
  { label: '3.0分以上', value: '3.0+', minRating: 3.0 }
];

/**
 * 筛选条件类
 */
export class RestaurantFilter {
  selectedRating: RatingFilterOption = 'all';

  /**
   * 设置评分筛选
   */
  setRatingFilter(option: RatingFilterOption): void {
    this.selectedRating = option;
  }

  /**
   * 获取最小评分阈值
   */
  getMinRating(): number {
    const config = RATING_FILTER_OPTIONS.find(item => item.value === this.selectedRating);
    return config ? config.minRating : 0;
  }

  /**
   * 重置筛选条件
   */
  reset(): void {
    this.selectedRating = 'all';
  }
}