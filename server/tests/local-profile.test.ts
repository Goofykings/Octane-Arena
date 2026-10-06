import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { configuration } from "../src/config";
import { starter } from "../../shared/catalog";
import { newLocalPlayerId } from "../../shared/local-profile";
test("local profiles are validated metadata, with independent server session IDs", async () => {
  const origin = "http://localhost:5173",
    headers = {
      origin,
      "content-type": "application/json",
      "x-arena-client": "1",
    };
  const { app } = await createApp(configuration({}));
  try {
    const profile = {
      localPlayerId: newLocalPlayerId(),
      name: "LocalDriver",
      avatarId: "fox",
      avatarColor: "#FF727C",
    };
    const session = () =>
      app.inject({
        method: "POST",
        url: "/api/party/session",
        headers,
        payload: { newSession: true, preset: starter(), profile },
      });
    const first = (await session()).json(),
      second = (await session()).json();
    assert.notEqual(first.playerId, second.playerId);
    assert.notEqual(first.playerId, profile.localPlayerId);
    const request = (
      path: string,
      payload: unknown,
      method: "POST" | "PUT" = "POST",
    ) =>
      app.inject({
        method,
        url: "/api/party" + path,
        headers: { ...headers, "x-arena-party": first.sessionToken },
        payload,
      });
    let state = (await request("/create", {})).json();
    assert.equal(state.party.members[0].localPlayerId, profile.localPlayerId);
    assert.equal(state.party.members[0].name, "LocalDriver");
    assert.equal(state.party.members[0].avatarId, "fox");
    assert.equal(state.party.members[0].avatarColor, "#FF727C");
    assert.equal("tag" in state.party.members[0], false);
    const updated = await request(
      "/appearance",
      {
        preset: starter(),
        profile: {
          ...profile,
          name: "Renamed",
          avatarId: "prism",
          avatarColor: "#75dba6",
        },
        stats: { wins: 999 },
      },
      "PUT",
    );
    assert.equal(updated.statusCode, 200);
    state = updated.json();
    assert.equal(state.playerId, first.playerId);
    assert.equal(state.party.members[0].name, "Renamed");
    assert.equal(state.party.members[0].avatarId, "prism");
    assert.equal(state.party.members[0].avatarColor, "#75DBA6");
    assert.equal(state.party.members[0].stats, undefined);
    for (const invalid of [
      { avatarId: "script" },
      { avatarColor: "red;display:none" },
    ])
      assert.equal(
        (
          await request(
            "/appearance",
            { preset: starter(), profile: { ...profile, ...invalid } },
            "PUT",
          )
        ).statusCode,
        400,
      );
    // Older clients can send a tag, but it is stripped and never published.
    state = (
      await request(
        "/appearance",
        { preset: starter(), profile: { ...profile, tag: "OLD" } },
        "PUT",
      )
    ).json();
    assert.equal("tag" in state.party.members[0], false);
    assert.equal(
      (
        await request(
          "/appearance",
          {
            preset: starter(),
            profile: { ...profile, localPlayerId: newLocalPlayerId() },
          },
          "PUT",
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await request(
          "/appearance",
          { preset: starter(), profile: { ...profile, name: "<bad\u0001>" } },
          "PUT",
        )
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
