import { CommonConst } from '../common/CommonConst';

@ObservedV2
export class WeekPickerVM {

  @Trace
  public title: string = '';

  @Trace
  public totalWeeks: number = CommonConst.DEFAULT_TOTAL_WEEKS;

  @Trace
  public isMaskMode: boolean = false;

  @Trace
  public selectedIndexOrMask: number = 0;

  @Trace
  public onSelectedChange: Callback<number> = () => {};

  @Trace
  public isOpen: boolean = false;

  @Trace
  public sheetType: SheetType = SheetType.BOTTOM;

  @Trace
  public onWillDismiss: Callback<DismissReason> = () => {};

  @Trace
  public onWillSpringBackWhenDismiss: Callback<SpringBackAction> = (action: SpringBackAction) => action.springBack();

  @Trace
  public close: () => void = () => {};
}
