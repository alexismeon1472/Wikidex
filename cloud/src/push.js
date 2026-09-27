import {
  sendPushBatch,
  topicFromString
} from "@mmmike/web-push/send";

function jsonBody(response) {
  return response.json().catch(() => null);
}

function userAccountStub(env, accountId) {
  return env.USER_ACCOUNT.get(
    env.USER_ACCOUNT.idFromName(String(accountId))
  );
}

function vapidConfig(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(env.VAPID_SUBJECT || "").trim();

  if (!publicKey || !privateKey || !subject) return null;

  return {
    publicKey,
    privateKey,
    subject
  };
}

async function loadSubscriptions(env, accountId) {
  const response = await userAccountStub(env, accountId)
    .fetch("https://account.internal/push/subscriptions/raw");

  const data = await jsonBody(response);
  if (!response.ok) return [];

  return Array.isArray(data?.subscriptions)
    ? data.subscriptions
    : [];
}

async function pruneSubscriptions(env, accountId, endpoints) {
  if (!Array.isArray(endpoints) || !endpoints.length) return;

  try {
    await userAccountStub(env, accountId).fetch(
      new Request("https://account.internal/push/subscriptions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoints })
      })
    );
  } catch {}
}

export function pushConfigured(env) {
  return !!vapidConfig(env);
}

export function pushPublicKey(env) {
  return String(env.VAPID_PUBLIC_KEY || "").trim() || null;
}

export async function sendUserPush(
  env,
  accountId,
  payload,
  {
    urgency = "normal",
    topic = null,
    ttl = 86400
  } = {}
) {
  const vapid = vapidConfig(env);

  if (!vapid) {
    return {
      ok: false,
      configured: false,
      delivered: 0,
      gone: 0,
      failed: 0
    };
  }

  const subscriptions = await loadSubscriptions(env, accountId);

  if (!subscriptions.length) {
    return {
      ok: true,
      configured: true,
      delivered: 0,
      gone: 0,
      failed: 0
    };
  }

  const resolvedTopic = topic
    ? await topicFromString(String(topic))
    : undefined;

  try {
    const result = await sendPushBatch(
      subscriptions,
      payload,
      vapid,
      {
        concurrency: Math.min(4, subscriptions.length),
        urgency,
        ttl,
        topic: resolvedTopic,
        timeoutMs: 10000
      }
    );

    if (result.gone?.length) {
      await pruneSubscriptions(env, accountId, result.gone);
    }

    return {
      ok: result.failed.length === 0,
      configured: true,
      delivered: result.delivered,
      gone: result.gone.length,
      failed: result.failed.length
    };
  } catch {
    return {
      ok: false,
      configured: true,
      delivered: 0,
      gone: 0,
      failed: subscriptions.length
    };
  }
}

function notificationBody(state, kind) {
  const title = state?.title || "Enchère WikiMasters";
  const current = Number(state?.currentBid);
  const max = Number(state?.max);
  const finalPrice = Number(state?.finalPrice);

  if (kind === "outbid") {
    return {
      title: "Tu as été surenchéri",
      body:
        title +
        (Number.isFinite(current)
          ? " · mise actuelle " + current + " WB"
          : "")
    };
  }

  if (kind === "cap-reached") {
    return {
      title: "Plafond AutoBid atteint",
      body:
        title +
        (Number.isFinite(max)
          ? " · plafond " + max + " WB"
          : "")
    };
  }

  if (kind === "won") {
    return {
      title: "Enchère gagnée",
      body:
        title +
        (Number.isFinite(finalPrice)
          ? " · " + finalPrice + " WB"
          : "")
    };
  }

  if (kind === "lost") {
    return {
      title: "Enchère perdue",
      body:
        title +
        (Number.isFinite(finalPrice)
          ? " · finale " + finalPrice + " WB"
          : "")
    };
  }

  return {
    title: "WikiDex",
    body: title
  };
}

export async function notifyAutoBid(env, state, kind) {
  if (!state?.accountId || !state?.listingId) return;

  const message = notificationBody(state, kind);
  const listingId = String(state.listingId);

  return sendUserPush(
    env,
    state.accountId,
    {
      title: message.title,
      body: message.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      image: state.imageUrl || undefined,
      tag: "wikidex-" + listingId,
      data: {
        url:
          "/?tab=autobid&listing=" +
          encodeURIComponent(listingId)
      },
      requireInteraction:
        kind === "won" ||
        kind === "cap-reached",
      timestamp: Date.now()
    },
    {
      urgency:
        kind === "outbid" ||
        kind === "cap-reached"
          ? "high"
          : "normal",
      topic: "auction:" + listingId,
      ttl: 86400
    }
  );
}
