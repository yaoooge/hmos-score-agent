import { common, contextConstant } from '@kit.AbilityKit';
import { preferences as preferencesMgr } from '@kit.ArkData';
import { window as windowMgr, PersistenceV2, UIContext } from '@kit.ArkUI';

import { NormalizedError } from '../utils/NormalizedError';
import { Logger } from '../utils/Logger';
import { CacheStore } from './stores/CacheStore';
import { PreferencesStore } from './stores/PreferencesStore';
import { UIStore } from './stores/UIStore';

class Stores {

  private _initialized = false;

  private _pref: PreferencesStore | undefined = undefined;

  private _ui: UIStore | undefined = undefined;

  private _cache: CacheStore = new CacheStore();

  /**
   * 持久化的业务数据存储。
   *
   * - 持久化：支持，赋值后调用 flushSync() 即可；
   * - 同步 UI 状态：不支持；
   * - 限制：单个 value 上限 16MB；需完成 Stores 初始化后使用；
   * - 特殊说明：写数据、首次读数据，均为同步耗时操作；
   *
   * @returns 返回 PreferencesStore 实例。
   */
  public get pref(): PreferencesStore {
    if (!this._pref) {
      throw new NormalizedError('PreferencesStore 不存在');
    }
    return this._pref;
  }

  /**
   * 可驱动 UI 的轻量级持久化数据存储。
   *
   * - 持久化：支持，直接赋值即可；
   * - 同步 UI 状态：支持；
   * - 限制：总存储上限约 8KB；需完成 Stores 初始化后使用；
   * - 特殊说明：适合存放供全局频繁使用且需持久化的轻量 UI 数据，其它情况推荐由页面单独管理；
   * - 设计约定: 所有开放变量必须使用 @Trace 装饰；
   *
   * @returns 返回 UIStore 实例。
   */
  public get ui(): UIStore {
    if (!this._ui) {
      throw new NormalizedError('UIStore 不存在');
    }
    return this._ui;
  }

  /**
   * 运行时内存缓存。
   *
   * - 持久化：不支持；
   * - 同步 UI 状态：部分支持 (是否被 @Trace 装饰)；
   * - 限制：无；
   *
   * @returns 返回 CacheStore 实例。
   */
  public get cache(): CacheStore {
    return this._cache;
  }

  /**
   * 初始化 Stores 能力，需在 loadContent 回调触发后调用。
   *
   * @param context - UIAbility 组件上下文。
   * @returns
   */
  public init(context: common.UIAbilityContext): void {
    if (this._initialized) {
      return;
    }
    const start: number = Date.now();
    try {
      this._pref = new PreferencesStore(preferencesMgr.getPreferencesSync(context, {
        name: PreferencesStore.KEY
      }));
      if (!this.isUIPersistenceAvailable(context)) {
        throw new NormalizedError('UI Persistence 能力不可信，请检查 init 调用时机');
      }
      this._ui = this.connectUIStore();
      this._initialized = true;
    } catch (e) {
      NormalizedError.logAndThrow(e);
    } finally {
      const end: number = Date.now();
      Logger.info(`Stores init completed: ok=${this._initialized} duration=${end - start}ms`);
    }
  }

  /**
   * 校验当前 UI 持久化能力是否可信。
   *
   * PersistenceV2 在诸如 connect 时机错误等特殊场景下，将获取到全新默认实例
   * 而非原本持久化的实例，其将导致 UI 不同步以及数据误覆盖。
   *
   * @param context - UIAbility 组件上下文
   * @returns 返回校验结果。
   */
  private isUIPersistenceAvailable(context: common.UIAbilityContext): boolean {
    try {
      const window: windowMgr.Window = context.windowStage.getMainWindowSync();
      const uiContext: UIContext = window.getUIContext();
      return Boolean(uiContext);
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      return false;
    }
  }

  private connectUIStore(): UIStore {
    try {
      const ui: UIStore | undefined = PersistenceV2.globalConnect({
        type: UIStore,
        key: UIStore.KEY,
        defaultCreator: () => new UIStore(),
        areaMode: contextConstant.AreaMode.EL2
      });
      if (!ui) {
        throw new NormalizedError(`UIStore connect failed (key=${UIStore.KEY})`);
      }
      return ui;
    } catch (e) {
      return NormalizedError.logAndThrow(e);
    }
  }
}

export const stores: Stores = new Stores();
