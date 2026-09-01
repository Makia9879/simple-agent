/** The only API base setting. Deploy with PUBLIC_API_BASE_URL=/api/v1 (default). */
export const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL || '/api/v1').replace(/\/$/, '');
