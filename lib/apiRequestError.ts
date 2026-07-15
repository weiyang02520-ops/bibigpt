export class ApiRequestError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.statusCode = statusCode
  }
}

export function getApiRequestStatus(error: unknown, fallback = 500) {
  if (error instanceof ApiRequestError) {
    return error.statusCode
  }

  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode)
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
      return statusCode
    }
  }

  return fallback
}
