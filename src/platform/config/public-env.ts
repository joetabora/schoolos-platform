/**
 * Values that may be read from client components.
 * Never put secrets, API keys, or database URLs here.
 */
export type PublicEnv = {
  readonly appName: string;
};

export function getPublicEnv(): PublicEnv {
  const appName = process.env["NEXT_PUBLIC_APP_NAME"]?.trim();
  return {
    appName: appName && appName.length > 0 ? appName : "SchoolOS",
  };
}
