import { window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { NormalizedError } from './NormalizedError';

const AVOID_AREA_TYPES: window.AvoidAreaType[] = [
  window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR,
  window.AvoidAreaType.TYPE_SYSTEM,
  window.AvoidAreaType.TYPE_CUTOUT
];

@ObservedV2
export class WindowListener {

  private _mainWindow: window.Window;

  @Trace
  private _cutout: window.AvoidArea | null = null;

  @Trace
  private _system: window.AvoidArea | null = null;

  @Trace
  private _indicator: window.AvoidArea | null = null;

  @Trace
  public windowSize: window.Size = { width: 0, height: 0 };

  @Computed
  public get avoidTop(): number {
    const cutoutTop: number =
      this._cutout?.topRect.height ? (this._cutout.topRect.top + this._cutout.topRect.height) : 0;
    const systemTop: number = this._system?.topRect.height ?? 0;
    return Math.max(systemTop, cutoutTop);
  }

  @Computed
  public get avoidBottom(): number {
    const cutoutBottom: number =
      this._cutout?.bottomRect.height ? (this.windowSize.height - this._cutout.bottomRect.top) : 0;
    const indicatorBottom: number = this._indicator?.bottomRect.height ?? 0;
    return Math.max(cutoutBottom, indicatorBottom);
  }

  public start(): void {
    this.loadWindowSize();
    this._mainWindow.on('avoidAreaChange', this.onAvoidAreaChange);
    this._mainWindow.on('windowSizeChange', this.onWindowSizeChange);
  }

  public stop(): void {
    this._mainWindow.off('avoidAreaChange', this.onAvoidAreaChange);
    this._mainWindow.off('windowSizeChange', this.onWindowSizeChange);
  }

  private onAvoidAreaChange: Callback<window.AvoidAreaOptions> = (options: window.AvoidAreaOptions) => {
    if (options.type === window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) {
      this._indicator = options.area;
    } else if (options.type === window.AvoidAreaType.TYPE_SYSTEM) {
      this._system = options.area;
    } else if (options.type === window.AvoidAreaType.TYPE_CUTOUT) {
      this._cutout = options.area;
    }
  };

  private onWindowSizeChange: Callback<window.Size> = (size: window.Size) => {
    this.loadAvoidArea();
    this.windowSize = size;
  };

  private loadAvoidArea(): void {
    try {
      for (const type of AVOID_AREA_TYPES) {
        this.onAvoidAreaChange({
          type: type,
          area: this._mainWindow.getWindowAvoidArea(type)
        });
      }
    } catch (e) {
      NormalizedError.logAndThrow(e);
    }
  }

  private loadWindowSize(): void {
    try {
      const windowRect: window.Rect = this._mainWindow.getWindowProperties().windowRect;
      this.onWindowSizeChange({ width: windowRect.width, height: windowRect.height });
    } catch (e) {
      NormalizedError.logAndThrow(e);
    }
  }

  constructor(ctx: common.UIAbilityContext) {
    try {
      this._mainWindow = ctx.windowStage.getMainWindowSync();
      this.loadWindowSize();
    } catch (e) {
      NormalizedError.logAndThrow(e);
    }
  }
}
