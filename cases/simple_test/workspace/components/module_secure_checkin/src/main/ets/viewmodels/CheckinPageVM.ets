import { geoLocationManager } from '@kit.LocationKit';
import { abilityAccessCtrl, common, Permissions, bundleManager } from '@kit.AbilityKit';
import { PromptAction } from '@ohos.arkui.UIContext';

import { Api } from '../http/Api';
import { ErrorCode, ViewModelState } from '../common/CustomTypes';
import { GetCheckinInfoResponse } from '../models/ApiModels';
import { Logger } from '../utils/Logger';
import { NormalizedError } from '../utils/NormalizedError';

const LOCATION_PERMISSIONS: Permissions[] = ['ohos.permission.APPROXIMATELY_LOCATION'];

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

  @Trace
  public isLocationAuthorized: boolean = false;

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
      await this.checkLocationPermission();
    } catch (e) {
      this.state = ViewModelState.INIT_FAILED;
      Logger.error(NormalizedError.from(e).toLogLine());
    } finally {
      this.isLoading = false;
    }
  }

  public async checkLocationPermission(): Promise<boolean> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const grantStatus = await atManager.checkAccessToken(
        bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION).appInfo.accessTokenId,
        LOCATION_PERMISSIONS[0]
      );
      this.isLocationAuthorized = grantStatus === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
      return this.isLocationAuthorized;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      this.isLocationAuthorized = false;
      return false;
    }
  }

  public async requestLocationPermission(): Promise<boolean> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const result = await atManager.requestPermissionsFromUser(
        this.context,
        LOCATION_PERMISSIONS
      );
      if (result.authResults[0] === 0) {
        this.isLocationAuthorized = true;
        return true;
      }
      this.isLocationAuthorized = false;
      return false;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      this.isLocationAuthorized = false;
      return false;
    }
  }

  public async doCheckinWithLocationCheck(): Promise<boolean> {
    const hasPermission = await this.checkLocationPermission();
    if (!hasPermission) {
      const granted = await this.requestLocationPermission();
      if (!granted) {
        this.showToast('需要位置权限才能签到');
        return false;
      }
    }
    const location = await this.getCurrentLocation();
    if (location) {
      Logger.info(`Location: ${location.latitude}, ${location.longitude}`);
    }
    return true;
  }

  public async doCheckin(): Promise<void> {

  }

  public async getCurrentLocation(): Promise<geoLocationManager.Location | undefined> {
    if (!this.isLocationAuthorized) {
      return undefined;
    }
    try {
      const location = await geoLocationManager.getCurrentLocation();
      return location;
    } catch (e) {
      Logger.error(NormalizedError.from(e).toLogLine());
      return undefined;
    }
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
