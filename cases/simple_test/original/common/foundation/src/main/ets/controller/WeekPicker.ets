import { ComponentContent } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';

import { WeekPickerVM } from '../viewmodels/WeekPickerVM';
import { WeekPickerContent } from '../components/WeekPickerContent';
import { NormalizedError } from '../utils/NormalizedError';
import { Logger } from '../utils/Logger';

export class WeekPicker {

  private uiContext: UIContext;

  private model: WeekPickerVM = new WeekPickerVM();

  private node: ComponentContent<WeekPickerVM> | null = null;

  public enableMaskMode(isMaskMode: boolean): WeekPicker {
    this.model.isMaskMode = isMaskMode;
    return this;
  }

  public setTitle(title: string): WeekPicker {
    this.model.title = title;
    return this;
  }

  public setTotalWeeks(total: number): WeekPicker {
    this.model.totalWeeks = total;
    return this;
  }

  public setSelectedIndexOrMask(indexOrMask: number): WeekPicker {
    this.model.selectedIndexOrMask = indexOrMask;
    return this;
  }

  public onSelectedChange(callback: (index: number) => void): WeekPicker {
    this.model.onSelectedChange = callback;
    return this;
  }

  public onWillDismiss(callback: (reason: DismissReason) => void): WeekPicker {
    this.model.onWillDismiss = callback;
    return this;
  }

  public onWillSpringBackWhenDismiss(callback: (action: SpringBackAction) => void): WeekPicker {
    this.model.onWillSpringBackWhenDismiss = callback;
    return this;
  }

  public async open(): Promise<boolean> {
    if (this.model.isOpen || this.node) {
      return false;
    }
    try {
      this.model.isOpen = true;
      this.node = new ComponentContent(this.uiContext, wrapBuilder(buildWeekPickerContent), this.model);
      await this.uiContext.openBindSheet(this.node, {
        height: SheetSize.FIT_CONTENT,
        preferType: SheetType.CENTER,
        showClose: false,
        enableOutsideInteractive: false,
        onWillDismiss: (action: DismissSheetAction) => this.model.onWillDismiss(action.reason),
        onWillSpringBackWhenDismiss: (action: SpringBackAction) => this.model.onWillSpringBackWhenDismiss(action),
        onTypeDidChange: (type: SheetType) => this.model.sheetType = type,
        backgroundColor: $r('sys.color.background_secondary'),
        keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY
      });
      return true;
    } catch {
      this.model.isOpen = false;
      this.node = null;
      return false;
    }
  }

  public close(): void {
    if (this.model.isOpen && this.node) {
      this.model.isOpen = false;
      this.uiContext.closeBindSheet(this.node)
        .catch((e: BusinessError<void>) => Logger.error(NormalizedError.from(e).toLogLine()))
        .finally(() => this.node = null);
    }
  }

  constructor(uiContext: UIContext) {
    this.uiContext = uiContext;
    this.model.close = () => this.close();
    this.model.onWillDismiss = () => this.close();
  }
}

@Builder
function buildWeekPickerContent(model: WeekPickerVM): void {
  WeekPickerContent({ model: model })
}
