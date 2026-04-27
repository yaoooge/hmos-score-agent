import { Timetable } from 'module_course_schedule';
import { preferences as preferencesMgr } from '@kit.ArkData';
import { CommonConst } from '../../common/CommonConst';
import { NormalizedError } from '../../utils/NormalizedError';

type Nullable<T> = T | null;

export class PreferencesStore {

  public static readonly KEY: string = 'PREFERENCES_STORE';

  private _preferences: preferencesMgr.Preferences;

  private _sessionToken: Nullable<string> = null;

  private _timetable: Nullable<Timetable> = null;

  public get sessionToken(): string {
    if (this._sessionToken !== null) {
      return this._sessionToken;
    }
    this._sessionToken = this.getValue(CommonConst.PREF_SESSION_TOKEN, '');
    return this._sessionToken;
  }

  public set sessionToken(token: Nullable<string>) {
    this.setValue(CommonConst.PREF_SESSION_TOKEN, token);
    this._sessionToken = token;
  }

  public get timetable(): Timetable {
    if (this._timetable !== null) {
      return this._timetable;
    }
    const defaultValue: Timetable = {
      id: '',
      semester: {
        label: '',
        anchorTimeMs: 0,
        weekCount: 0
      },
      periods: [],
      courses: []
    };
    this._timetable = this.getValue(CommonConst.PREF_TIMETABLE, defaultValue);
    return this._timetable;
  }

  public set timetable(timetable: Nullable<Timetable>) {
    this.setValue(CommonConst.PREF_TIMETABLE, timetable);
    this._timetable = timetable;
  }

  public flushSync(): void {
    try {
      this._preferences.flushSync();
    } catch (e) {
      NormalizedError.logAndThrow(e);
    }
  }

  public getValue<T extends preferencesMgr.ValueType>(key: string, defaultValue: T): T {
    try {
      if (!this._preferences.hasSync(key)) {
        return defaultValue;
      }
      return this._preferences.getSync(key, defaultValue) as T;
    } catch (e) {
      return NormalizedError.logAndThrow(e);
    }
  }

  public setValue(key: string, value: Nullable<preferencesMgr.ValueType>): void {
    try {
      if (value === null || value === undefined) {
        this._preferences.deleteSync(key);
      } else {
        this._preferences.putSync(key, value);
      }
    } catch (e) {
      NormalizedError.logAndThrow(e);
    }
  }

  constructor(preferences: preferencesMgr.Preferences) {
    this._preferences = preferences;
  }
}
