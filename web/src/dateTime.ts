function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDashboardDateTime(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());

  return `${String(year)}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
