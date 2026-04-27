import { geoLocationManager } from '@kit.LocationKit';
import { common } from '@kit.AbilityKit';
import { PromptAction } from '@ohos.arkui.UIContext';

import { Api } from '../http/Api';
import { ErrorCode, ViewModelState } from '../common/CustomTypes';
import { GetCheckinInfoResponse } from '../models/ApiModels';
import { Logger } from '../utils/Logger';
import { NormalizedError } from '../utils/NormalizedError';

@ObservedV2
export class CheckinPageVM {

  @Trace
  public state: ViewModelState = ViewModelState.UNINITIALIZED;

  @Trace
  public isLoading: boolean = false;

  @Trace
  public isCheckedIn: boolean = false;

  @Trace
  public checkinCode: string = '';

  @Trace
  public showErrorTips: boolean = false;

  @Trace
  public courseName: string = '';

  private courseId: string = '';

  private context: common.UIAbilityContext;

  private promptAction: PromptAction;

  public async initialize(): Promise<void> {
    if (this.isLoading || this.state === ViewModelState.READY) {
      return;
    }
    try {
      this.isLoading = true;
      const resp: GetCheckinInfoResponse = await Api.getCheckinInfo();
      if (resp.code !== ErrorCode.NO_ERROR) {
        throw new Error(resp.message);
      }
      this.courseId = resp.courseId ?? '';
      this.courseName = resp.courseName ?? '';
      this.isCheckedIn = Boolean(resp.isCheckedIn);
      this.checkinCode = (this.isCheckedIn && resp.checkinCode) ? resp.checkinCode : '';
      this.state = ViewModelState.READY;
    } catch (e) {
      this.state = ViewModelState.INIT_FAILED;
      Logger.error(NormalizedError.from(e).toLogLine());
    } finally {
      this.isLoading = false;
    }
  }

  public async doCheckin(): Promise<void> {
   
  }

  public async getCurrentLocation(): Promise<geoLocationManager.Location | undefined> {
    return undefined;
  }

  public showToast(msg: string): void {
    try {
      this.promptAction.showToast({ message: msg });
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
    }
  }

  constructor(uiContext: UIContext) {
    this.promptAction = uiContext.getPromptAction();
    this.context = uiContext.getHostContext() as common.UIAbilityContext;
    this.initialize();
  }
}
