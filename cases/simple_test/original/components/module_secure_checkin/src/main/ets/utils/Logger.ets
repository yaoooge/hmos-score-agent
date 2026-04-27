import { UtilLog } from '@hw-agconnect/util-log';

UtilLog.setGlobalConfig({
  tag: '[CHECKIN]',
  domain: 0x0000,
  open: true,
  showStack: true,
  showBorder: true,
  showDivider: true
});

export { UtilLog as Logger };
