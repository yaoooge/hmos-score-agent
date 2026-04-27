import { WidgetActionType, IntentTask, RouterConst } from 'foundation';

@Entry
@Component
struct SchoolLifeWidgetCard {

  public build(): void {
    Row() {
      this.buildEventButton($r('app.media.ic_form_home'), '首页', () => {
        postCardAction(this, {
          action: WidgetActionType.Router,
          abilityName: RouterConst.MAIN_ABILITY_NAME,
          params: {
            intentTask: IntentTask.GO_TO_HOME_PAGE,
          }
        });
      })
      this.buildEventButton($r('app.media.ic_form_sign_in'), '打卡', () => {
        postCardAction(this, {
          action: WidgetActionType.Router,
          abilityName: RouterConst.MAIN_ABILITY_NAME,
          params: {
            intentTask: IntentTask.GO_TO_CHECKIN_PAGE
          }
        });
      })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private buildEventButton(icon: ResourceStr, label: ResourceStr, event: () => void): void {
    Row({ space: 6 }) {
      Image(icon)
        .size({ width: 24, height: 24 })
        .objectFit(ImageFit.Fill)
      Text(label)
        .fontColor($r('sys.color.font_primary'))
        .fontSize($r('sys.float.Body_S'))
        .fontWeight(FontWeight.Regular)
    }
    .layoutWeight(1)
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .onClick(() => event())
  }
}
