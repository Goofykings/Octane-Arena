export const peerErrorMessage = (type: string) =>
  ({
    "unavailable-id": "PARTY CODE IN USE",
    "peer-unavailable": "PARTY NOT FOUND",
    network: "CONNECTION FAILED — CHECK YOUR NETWORK",
    "server-error": "SIGNALING SERVICE UNAVAILABLE",
    "socket-error": "SIGNALING CONNECTION FAILED",
    "socket-closed": "SIGNALING DISCONNECTED",
    webrtc:
      "WEBRTC CONNECTION FAILED — THIS NETWORK MAY BLOCK PEER CONNECTIONS",
  })[type] ?? "CONNECTION FAILED";
