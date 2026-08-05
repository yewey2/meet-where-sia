const TECHNICAL_ERROR_PATTERN = /api key|failed to fetch|networkerror|load google maps|request failed with status/i;

function sentence(value: string) {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function actionableErrorMessage(
  error: unknown,
  fallback: string,
  nextStep: string,
) {
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
  const safeDetail = TECHNICAL_ERROR_PATTERN.test(detail) ? fallback : detail;
  return `${sentence(safeDetail)} ${nextStep}`;
}
