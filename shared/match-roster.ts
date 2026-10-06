import { starter } from "./catalog";
import type { NetPlayer } from "./network";
import type { PartyState } from "./party";
export function partyRoster(party: PartyState): NetPlayer[] {
  const players: NetPlayer[] = party.members.map((m) => ({
    id: m.id,
    name: m.name,
    localPlayerId: m.localPlayerId,
    avatarId: m.avatarId,
    avatarColor: m.avatarColor,
    team: m.team as 0 | 1,
    controller: "remote",
    preset: structuredClone(m.preset),
  }));
  if (party.mode === "2v2bots")
    for (let i = 0; i < 2; i++)
      players.push({
        id: `bot-${party.code}-${i}`,
        name: i ? "Relay" : "Circuit",
        team: 1,
        controller: "bot",
        preset: { ...starter(), body: "vector" },
      });
  return players;
}
