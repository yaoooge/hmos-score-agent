/**
 * 餐厅列表页面
 * 使用 @Component 和 @State 绑定 ViewModel（V1 装饰器）
 * 
 * 关键设计：
 * 1. List 组件使用正确的 keyGenerator，避免状态错位
 * 2. ForEach 渲染 filteredRestaurants，确保筛选后正确刷新
 * 3. 收藏操作通过 ViewModel 处理，状态变化自动触发 UI 更新
 */

import { RestaurantListVM } from '../viewmodels/RestaurantListVM';
import { RestaurantCard } from '../components/RestaurantCard';
import { RatingFilter } from '../components/RatingFilter';
import { Restaurant } from '../../common/models/Restaurant';
import { RatingFilterOption } from '../models/RestaurantFilter';

@Entry
@Component
export struct RestaurantListPage {
  // ViewModel 实例（使用 @State 观察）
  @State vm: RestaurantListVM = new RestaurantListVM();

  // Scroller 实例（必须先声明）
  private scroller: Scroller = new Scroller();

  build() {
    Column() {
      // 页面标题栏
      Row() {
        Text('美食餐厅')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor('#333333')
          .layoutWeight(1)

        // 筛选按钮（使用 Emoji）
        Button(this.vm.showFilterPanel ? '🔽' : '🔼')
          .fontSize(20)
          .backgroundColor(Color.Transparent)
          .onClick(() => {
            this.vm.toggleFilterPanel();
            // 触发状态更新
            this.vm = this.vm;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 8 })
      .justifyContent(FlexAlign.SpaceBetween)
      .alignItems(VerticalAlign.Center)

      // 统计信息
      Row() {
        Text(`共 ${this.vm.allRestaurants.length} 家餐厅`)
          .fontSize(14)
          .fontColor('#666666')

        Text(this.vm.getFavoriteCount() > 0 ? ` | 已收藏 ${this.vm.getFavoriteCount()} 家` : '')
          .fontSize(14)
          .fontColor('#FF6B35')
      }
      .width('100%')
      .padding({ left: 16, right: 16, bottom: 12 })

      // 筛选面板（条件渲染）
      Column() {
        RatingFilter({
          selectedRating: this.vm.filter.selectedRating,
          onFilterChange: (option: RatingFilterOption) => {
            this.vm.setRatingFilter(option);
            // 触发状态更新
            this.vm = this.vm;
          }
        })
      }
      .width('100%')
      .padding({ left: 16, right: 16 })
      .visibility(this.vm.showFilterPanel ? Visibility.Visible : Visibility.None)

      // 当前筛选结果提示
      Column() {
        Text(`当前筛选: ${this.vm.getFilteredCount()} 家餐厅`)
          .fontSize(12)
          .fontColor('#999999')
          .margin({ top: 8, bottom: 8 })
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .visibility(this.vm.showFilterPanel ? Visibility.Visible : Visibility.None)

      // 餐厅列表
      if (this.vm.isLoading) {
        // 加载状态
        Column() {
          Text('加载中...')
            .fontSize(16)
            .fontColor('#999999')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      } else {
        // 餐厅列表（使用 List + ForEach）
        List({ scroller: this.scroller }) {
          ForEach(
            this.vm.filteredRestaurants,
            (restaurant: Restaurant) => {
              ListItem() {
                RestaurantCard({
                  restaurant: restaurant,
                  onFavoriteClick: (restaurantId: string) => {
                    this.vm.toggleFavorite(restaurantId);
                    // 触发状态更新
                    this.vm = this.vm;
                  }
                })
              }
            },
            (restaurant: Restaurant) => restaurant.id  // 关键：使用餐厅 ID 作为唯一键，避免状态错位
          )
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 16, right: 16, top: 8 })
        .scrollBar(BarState.Auto)
        .edgeEffect(EdgeEffect.Spring)
      }

      // 空状态提示
      if (!this.vm.isLoading && this.vm.filteredRestaurants.length === 0) {
        Column() {
          Text('🔍')
            .fontSize(48)
            .margin({ bottom: 16 })
          Text('没有符合条件的餐厅')
            .fontSize(16)
            .fontColor('#999999')
            .margin({ bottom: 8 })
          Button('重置筛选')
            .fontSize(14)
            .fontColor('#FF6B35')
            .backgroundColor('#FFF5F0')
            .onClick(() => {
              this.vm.resetFilter();
              // 触发状态更新
              this.vm = this.vm;
            })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F8F8F8')
  }
}