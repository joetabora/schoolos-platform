export type HealthResponse = {
  readonly status: "ok";
  readonly service: "schoolos-web";
};

export function healthPayload(): HealthResponse {
  return { status: "ok", service: "schoolos-web" };
}
