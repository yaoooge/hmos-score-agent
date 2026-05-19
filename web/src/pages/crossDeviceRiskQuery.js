export function buildCrossDeviceRiskQueryParams({
  from,
  to,
  page,
  pageSize,
  keyword,
  riskLevel,
}) {
  return {
    from,
    to,
    page,
    pageSize,
    keyword,
    riskLevel,
    agreement: "disagreed",
  };
}
