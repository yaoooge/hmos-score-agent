/**
 * 评分筛选组件
 * 提供评分筛选选项
 */

import { RATING_FILTER_OPTIONS, RatingFilterOption } from '../models/RestaurantFilter';

@Component
export struct RatingFilter {
  // 当前选中的评分筛选选项
  @Prop selectedRating: RatingFilterOption = 'all';
  
  // 筛选变更事件回调
  onFilterChange: (option: RatingFilterOption) => void = () => {};

  build() {
    Column() {
      // 筛选标题
      Text('评分筛选')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor('#333333')
        .margin({ bottom: 12 })

      // 筛选选项列表
      Row() {
        ForEach(RATING_FILTER_OPTIONS, (config: RatingFilterConfig) => {
          Button(config.label)
            .fontSize(14)
            .fontColor(this.selectedRating === config.value ? Color.White : '#666666')
            .backgroundColor(this.selectedRating === config.value ? '#FF6B35' : '#F5F5F5')
            .borderRadius(20)
            .height(36)
            .margin({ right: 8 })
            .onClick(() => {
              this.onFilterChange(config.value);
            })
        }, (config: RatingFilterConfig) => config.value)
      }
      .width('100%')
      .justifyContent(FlexAlign.Start)
    }
    .width('100%')
    .padding(16)
    .backgroundColor(Color.White)
    .borderRadius(12)
    .margin({ bottom: 16 })
  }
}

/**
 * 评分筛选配置类型
 */
interface RatingFilterConfig {
  label: string;
  value: RatingFilterOption;
  minRating: number;
}