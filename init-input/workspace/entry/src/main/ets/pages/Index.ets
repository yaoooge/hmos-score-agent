/**
 * 应用入口页面
 * 使用 Navigation 组件作为路由容器（V1 装饰器）
 */

import { RestaurantListPage } from '../restaurant/pages/RestaurantListPage';

@Entry
@Component
struct Index {
  // Navigation 路由控制器
  private navPathStack: NavPathStack = new NavPathStack();

  build() {
    Navigation(this.navPathStack) {
      // 直接加载餐厅列表页面作为主页
      RestaurantListPage()
    }
    .title('美食餐厅')
    .titleMode(NavigationTitleMode.Mini)
    .mode(NavigationMode.Stack)
    .backgroundColor('#F8F8F8')
  }
}