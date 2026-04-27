

class RouterStack extends NavPathStack {
  /**
   * 从路由栈底部开始遍历，如果存在名为 name 的页面，则回退路由栈到该页面；否则将该页面直接入栈。
   *
   * @param name - NavDestination 页面名称。
   * @param animated - 是否支持转场动画。
   * @returns 返回被 push/popTo 页面的最终索引。
   */
  public pushOrPopToName(name: string, animated: boolean = true): number {
    const index: number = this.getIndexByName(name)[0] ?? -1;
    if (index !== -1) {
      this.popToIndex(index, animated);
      return index;
    } else {
      this.pushPathByName(name, undefined, animated);
      return this.size() - 1;
    }
  }
}

export const routerStack: RouterStack = new RouterStack();
