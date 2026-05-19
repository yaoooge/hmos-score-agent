export type CrossDeviceRiskQueryParams = {
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  keyword?: string;
  riskLevel?: "" | "high" | "medium" | "low";
};

export function buildCrossDeviceRiskQueryParams(
  params: CrossDeviceRiskQueryParams,
): CrossDeviceRiskQueryParams & { agreement: "disagreed" };
