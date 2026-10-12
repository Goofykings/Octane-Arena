import type { PartyClient } from "../game/party";
/** Compatibility adapter for the existing host-authority gameplay abstraction.
 * PeerJS owns all SDP/ICE. No native peer/channel setup lives here. */
export class RtcPeers {
  private transport;
  constructor(private party: PartyClient) {
    this.transport = party.transport;
  }
  get status() {
    return this.transport.status;
  }
  get peers() {
    return this.transport.peers;
  }
  get onData() {
    return this.transport.onData;
  }
  set onData(value: (id: string, data: unknown) => void) {
    this.transport.onData = value;
  }
  private closed: (id: string) => void = () => {};
  set onClose(value: (id: string) => void) {
    this.closed = value;
    const original = this.transport.onClose;
    this.transport.onClose = (id) => {
      original(id);
      if (id) value(id);
    };
  }
  get onClose() {
    return this.closed;
  }
  pump(now: number) {
    this.transport.pump(now);
  }
  ready(id: string) {
    return this.transport.ready(id);
  }
  send(id: string, data: unknown, fast = false) {
    return this.transport.send(id, data, fast);
  }
  sendReplay(id: string, data: unknown) {
    return this.transport.sendReplay(id, data);
  }
  latency(id: string) {
    return this.transport.latency(id);
  }
  diagnostics() {
    return {
      partyConnection: this.party.connection,
      playerId: this.party.playerId,
      role: !this.party.state
        ? "none"
        : this.party.state.hostId === this.party.playerId
          ? "host"
          : "guest",
      ...this.transport.diagnostics(),
    };
  }
  close() {
    /* Match exit keeps the party's connection alive; PartyClient owns teardown. */
  }
}
