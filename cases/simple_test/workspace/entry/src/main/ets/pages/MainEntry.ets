import { stores, routerStack, TabsItem } from 'foundation';

import { MainEntryConfig as Config } from '../common/MainEntryConfig';
import { MainEntryVM } from '../viewmodels/MainEntryVM';

@Entry
@ComponentV2
struct MainEntry {

  private model: MainEntryVM = MainEntryVM.getInstance();

  public aboutToAppear(): void {
    this.model.init();
  }

  public build(): void {
    Navigation(routerStack) {
      Tabs({ index: this.model.activeMainTabIndex }) {
        ForEach(Config.TAB_LIST, (item: TabsItem, index: number) => {
          TabContent() {
            item.content.builder()
          }
          .tabBar(this.buildTabBar(item, index))
          .backgroundColor($r('sys.color.comp_background_tertiary'))
          .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        }, (item: TabsItem, index: number) => index + JSON.stringify(item))
      }
      .width('100%')
      .height('100%')
      .scrollable(false)
      .barMode(BarMode.Fixed)
      .barHeight(48)
      .animationMode(AnimationMode.NO_ANIMATION)
      .animationDuration(0)
      .barPosition(BarPosition.End)
      .barBackgroundColor(Color.Transparent)
      .backgroundColor($r('sys.color.comp_background_primary'))
      .onChange((index: number) => stores.cache.activeMainTabId = Config.TAB_LIST[index].id)
      .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
    }
    .mode(NavigationMode.Stack)
    .hideTitleBar(true)
    .hitTestBehavior(stores.cache.hasAcceptedPrivacyPolicy ? HitTestMode.Default : HitTestMode.Block)
  }

  @Builder
  private buildTabBar(item: TabsItem, index: number): void {
    Column() {
      Image(this.model.activeMainTabIndex === index ? item.activeIcon : item.icon)
        .width(24)
        .height(24)
        .draggable(false)
      Text(item.label)
        .fontColor(this.model.activeMainTabIndex === index ?
          $r('sys.color.multi_color_09') : $r('sys.color.font_secondary')
        )
        .fontSize($r('sys.float.Caption_M'))
        .fontWeight(FontWeight.Regular)
        .margin({ top: 4 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }
}