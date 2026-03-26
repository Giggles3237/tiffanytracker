const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const openaiKey = defineSecret("OPENAI_API_KEY");

exports.funnyNote = onCall(
  {
    secrets: [openaiKey],
    // Keep cold starts cheap — this is a lightweight text transform
    memory: "256MiB",
    maxInstances: 10,
  },
  async (request) => {
    // Only authenticated users can call this
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to use this feature.");
    }

    const note = (request.data.note || "").slice(0, 200); // cap input length
    const category = request.data.category || "question";

    if (!note) {
      return { funnyNote: null };
    }

    const categoryLabels = {
      signature: "Signature Hunt",
      question: "Quick Question",
      audit: "The Audit",
      social: "Weekend Plans / Chatter",
    };
    const catLabel = categoryLabels[category] || category;

    const systemPrompt = [
      "You are the T.I.F.F.A.N.Y. Defense System (Tactical Intelligence For Finance & Administration Necessary Yelling) at a car dealership F&I office.",
      "Tiffany is a beloved coworker who asks a LOT of questions and is always on the move around the dealership.",
      "Your job: rewrite the incident note as a brief, dramatic, military/spy-style status report.",
      "Rules:",
      "- Keep it under 15 words",
      "- ALL CAPS",
      "- Be funny but never mean — this is affectionate humor",
      "- Use dealership/F&I jargon when possible",
      "- Think radar intercepts, field reports, threat assessments",
      "- Do NOT include quotes or explanation, just the rewritten note",
    ].join(" ");

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey.value()}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 60,
            temperature: 1.0,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `Category: ${catLabel}. Original note: ${note}`,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        console.error("OpenAI API error:", response.status, await response.text());
        // Fail gracefully — just return the original note
        return { funnyNote: null };
      }

      const data = await response.json();
      const rewritten =
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;

      return { funnyNote: rewritten ? rewritten.trim() : null };
    } catch (err) {
      console.error("funnyNote error:", err);
      // Fail gracefully — caller will use the original note
      return { funnyNote: null };
    }
  }
);

/** Delete a Firebase Auth user (used to reject pending signup requests). */
exports.rejectUser = onCall(
  { memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to perform this action.");
    }
    const targetUid = (request.data && request.data.targetUid || "").trim();
    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required.");
    }
    await admin.auth().deleteUser(targetUid);
    return { ok: true };
  }
);

/** Any authenticated user can reset another user's password (everyone has admin access). */
exports.adminResetPassword = onCall(
  { memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to reset a password.");
    }
    const targetUserEmail = (request.data && request.data.targetUserEmail || "").trim();
    const newPassword = request.data && request.data.newPassword;
    if (!targetUserEmail || typeof newPassword !== "string") {
      throw new HttpsError("invalid-argument", "targetUserEmail and newPassword are required.");
    }
    if (newPassword.length < 6) {
      throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
    }
    let targetUser;
    try {
      targetUser = await admin.auth().getUserByEmail(targetUserEmail);
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        throw new HttpsError("not-found", "No user found with that email.");
      }
      throw new HttpsError("internal", "Could not look up user.");
    }
    await admin.auth().updateUser(targetUser.uid, { password: newPassword });
    return { ok: true };
  }
);
