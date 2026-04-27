import { FunctionalMode } from '../common/CustomTypes';

@ComponentV2
export struct FunctionalRow {

  @Param
  public text: string = '';

  @Param
  public label: string = '';

  @Param
  public placeholder: string = '';

  @Param
  public mode: FunctionalMode = FunctionalMode.TEXT_INPUT;

  @Param
  public maxLength: number = Number.POSITIVE_INFINITY;

  @Param
  public inputType: InputType = InputType.Normal;

  @Event
  public onButtonClick: Callback<void> = () => {};

  @Event
  public onTextChange: Callback<string> = () => {};

  public build(): void {
    if (this.mode === FunctionalMode.BUTTON) {
      Button() {
        Row() {
          this.buildLabel()
          Text(this.text)
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .textAlign(TextAlign.End)
            .fontColor($r('sys.color.font_primary'))
            .fontSize($r('sys.float.Body_M'))
            .fontWeight(FontWeight.Regular)
          SymbolGlyph($r('sys.symbol.chevron_right'))
            .fontSize(24)
            .fontColor([$r('sys.color.icon_fourth')])
            .margin({ left: 4 })
        }
      }
      .constraintSize({ minHeight: 48 })
      .type(ButtonType.Normal)
      .padding({ top: 0, bottom: 0, left: 12, right: 8 })
      .borderRadius(16)
      .onClick(() => this.onButtonClick())
      .backgroundColor(Color.Transparent)
    } else if (this.mode === FunctionalMode.TEXT_INPUT) {
      Row() {
        this.buildLabel()
        TextInput({ text: this.text, placeholder: this.placeholder })
          .layoutWeight(1)
          .height(48)
          .borderWidth(0)
          .borderRadius(0)
          .textAlign(TextAlign.End)
          .maxLength(this.maxLength)
          .type(this.inputType)
          .caretColor($r('sys.color.multi_color_09'))
          .placeholderColor($r('sys.color.font_secondary'))
          .placeholderFont({ size: $r('sys.float.Body_M'), weight: FontWeight.Medium })
          .fontWeight(FontWeight.Medium)
          .fontColor($r('sys.color.font_primary'))
          .fontSize($r('sys.float.Body_M'))
          .showCounter(false)
          .onChange((value: string) => this.onTextChange(value))
          .padding(0)
          .backgroundColor(Color.Transparent)
      }
      .width('100%')
      .padding({ left: 12, right: 12 })
      .alignItems(VerticalAlign.Center)
    }
  }

  @Builder
  private buildLabel(): void {
    Text(this.label)
      .width(100)
      .height(48)
      .maxLines(1)
      .fontSize($r('sys.float.Subtitle_M'))
      .fontColor($r('sys.color.font_primary'))
      .fontWeight(FontWeight.Medium)
  }
}
