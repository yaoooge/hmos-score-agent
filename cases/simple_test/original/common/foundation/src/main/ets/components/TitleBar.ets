import { CommonConst } from '../common/CommonConst';
import { CircleButton } from './CircleButton';

@ComponentV2
export struct TitleBar {

  @Param
  public title: string | Resource = '';

  @Param
  public enableBackward: boolean = false;

  @Param
  public bgColor: ResourceColor = Color.Transparent;

  @Event
  public onBackButtonClick: Callback<void> | undefined = undefined;

  public build(): void {
    Column() {
      Row() {
        if (this.enableBackward) {
          CircleButton({
            symbol: $r('sys.symbol.chevron_backward'),
            symbolSize: 24
          })
            .margin({ left: 16 })
            .onClick(() => this.onBackButtonClick && this.onBackButtonClick())
        }
        Text(this.title)
          .fontSize(this.enableBackward ? $r('sys.float.Title_S') : $r('sys.float.Title_M'))
          .fontColor($r('sys.color.font_primary'))
          .fontWeight(FontWeight.Bold)
          .margin(this.enableBackward ? { left: 8 } : { left: 24 })
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .height(CommonConst.TITLE_BAR_HEIGHT)
      .alignItems(VerticalAlign.Center)
    }
    .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP])
    .backgroundColor(this.bgColor)
  }
}
