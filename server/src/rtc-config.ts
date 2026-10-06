import { createHmac } from "node:crypto";
import type { ServerConfig } from "./config";
import type { IceConfig } from "../../shared/rtc";
export function iceConfiguration(
  config: ServerConfig,
  playerId: string,
  now = Date.now(),
): IceConfig {
  const iceServers: IceConfig["iceServers"] = [];
  if (config.stunUrls?.length) iceServers.push({ urls: config.stunUrls });
  const relayAvailable = !!(config.turnUrls?.length && config.turnSecret);
  if (relayAvailable) {
    // coturn REST credentials expire after one hour; the permanent secret stays here.
    const username = `${Math.floor(now / 1000) + 3600}:${playerId}`;
    iceServers.push({
      urls: config.turnUrls!,
      username,
      credential: createHmac("sha1", config.turnSecret!)
        .update(username)
        .digest("base64"),
    });
  }
  return {
    iceServers,
    iceTransportPolicy: config.icePolicy ?? "all",
    relayAvailable,
  };
}
