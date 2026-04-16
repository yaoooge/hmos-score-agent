/**
 * 餐厅卡片组件
 * 使用 @Component 构建 UI（V1 装饰器）
 * 
 * 关键设计：
 * 1. 使用 @ObjectLink 接收 Restaurant 对象，自动观察状态变化
 * 2. 收藏按钮点击时触发事件回调，由父组件处理状态更新
 * 3. 卡片内容根据 Restaurant 的属性自动刷新
 */

import { Restaurant } from '../../common/models/Restaurant';

@Component
export struct RestaurantCard {
  // 餐厅数据参数（使用 @ObjectLink 观察对象变化）
  @ObjectLink restaurant: Restaurant;
  
  // 收藏点击事件回调
  onFavoriteClick: (restaurantId: string) => void = () => {};

  build() {
    Column() {
      // 卡片容器
      Row() {
        // 左侧：餐厅图片占位符
        Column() {
          Text('🍽️')
            .fontSize(48)
            .fontColor('#FF6B35')
        }
        .width(80)
        .height(80)
        .backgroundColor('#FFF5F0')
        .justifyContent(FlexAlign.Center)
        .borderRadius(8)

        // 右侧：餐厅信息
        Column() {
          // 餐厅名称和收藏按钮
          Row() {
            Text(this.restaurant.name)
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor('#333333')
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)

            // 收藏按钮（使用 Emoji 避免系统资源）
            Button(this.restaurant.isFavorite ? '❤️' : '🤍')
              .fontSize(24)
              .backgroundColor(Color.Transparent)
              .onClick(() => {
                this.onFavoriteClick(this.restaurant.id);
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ bottom: 8 })

          // 评分和菜系
          Row() {
            // 评分星星（使用 Emoji）
            Text('⭐')
              .fontSize(16)
            Text(this.restaurant.rating.toFixed(1))
              .fontSize(14)
              .fontColor('#FF9500')
              .fontWeight(FontWeight.Medium)
              .margin({ left: 4, right: 12 })

            // 菜系类型
            Text(this.restaurant.cuisineType)
              .fontSize(14)
              .fontColor('#666666')
              .backgroundColor('#F5F5F5')
              .padding({ left: 8, right: 8, top: 2, bottom: 2 })
              .borderRadius(4)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .margin({ bottom: 8 })

          // 地址
          Text(this.restaurant.address)
            .fontSize(12)
            .fontColor('#999999')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .layoutWeight(1)
        .padding({ left: 12 })
        .justifyContent(FlexAlign.Start)
      }
      .width('100%')
      .padding(12)
      .backgroundColor(Color.White)
      .borderRadius(12)
      .shadow({
        radius: 8,
        color: '#00000020',
        offsetX: 0,
        offsetY: 2
      })
    }
    .width('100%')
    .margin({ bottom: 12 })
  }
}