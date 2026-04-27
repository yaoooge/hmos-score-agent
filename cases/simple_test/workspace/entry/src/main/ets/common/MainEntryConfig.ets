import { MainTabId, TabsItem } from 'foundation';

import { buildHomeTab } from '../components/HomeTab';
import { buildMineTab } from '../components/MineTab';

export class MainEntryConfig {
  /**
   * 主页面 Tab 列表配置
   */
  public static readonly TAB_LIST: TabsItem[] = [
    {
      id: MainTabId.Home,
      label: '首页',
      icon: $r('app.media.ic_tab_home'),
      activeIcon: $r('app.media.ic_tab_home_active'),
      content: wrapBuilder(buildHomeTab)
    },
    {
      id: MainTabId.Mine,
      label: '我的',
      icon: $r('app.media.ic_tab_mine'),
      activeIcon: $r('app.media.ic_tab_mine_active'),
      content: wrapBuilder(buildMineTab)
    }
  ];
}
