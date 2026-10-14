import { createHmac } from "node:crypto";
import type { PeerIceServer, PeerRtcConfig, ServerEnv } from "@prepquest/shared";

const TURN_TTL_SEC = 3600;

const split = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * ICE servers for one person's audio call. STUN needs no secret. TURN (coturn with `use-auth-secret`) gets
 * credentials that expire after an hour: the user name is the expiry time and the user, and the password is
 * an HMAC of it, so nothing is stored and a leaked pair stops working on its own.
 */
export function rtcConfig(
  env: Pick<ServerEnv, "PEER_STUN_URLS" | "PEER_TURN_URLS" | "PEER_TURN_SECRET">,
  userId: string,
  now: Date,
): PeerRtcConfig {
  const iceServers: PeerIceServer[] = [];
  const stun = split(env.PEER_STUN_URLS);
  if (stun.length > 0) iceServers.push({ urls: stun });
  const turn = split(env.PEER_TURN_URLS);
  if (turn.length === 0 || !env.PEER_TURN_SECRET) return { iceServers, expiresAt: null };
  const expires = Math.floor(now.getTime() / 1000) + TURN_TTL_SEC;
  const username = `${expires}:${userId}`;
  const credential = createHmac("sha1", env.PEER_TURN_SECRET).update(username).digest("base64");
  iceServers.push({ urls: turn, username, credential });
  return { iceServers, expiresAt: new Date(expires * 1000).toISOString() };
}
