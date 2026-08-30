---
name: apply-with-grant
description: Understand benefit questions and help the holder explain, clarify, or safely start a GrantOnce application plan.
---

# Apply with Grant

Help the holder talk naturally about benefits without treating conversation as authorization.

## Use this skill when

- The holder asks what benefits they may qualify for.
- The holder names childcare, relocation, air-conditioning, or another life situation related to benefits.
- The holder asks how two benefits differ or why a predicate is required.
- The holder explicitly asks to start, prepare, or plan an application.

Do not use it for application status, audit history, privacy controls, revocation, or unrelated conversation.

## Choose one action

- `explain`: answer or compare without creating a Grant.
- `clarify`: the holder's goal is ambiguous; respond naturally and ask what they want to do. Do not create a Grant.
- `plan`: the holder clearly asks what they qualify for or asks to begin planning. The rule engine may open service requirements; confirming them is a separate step the holder takes.

Prefer `explain` or `clarify` when the holder is only learning. Conversation is not consent.

## Response rules

- Reply in concise Traditional Chinese and address what the holder actually said.
- Never claim an application, signature, approval, redemption, or data retrieval has completed unless a trusted tool result says so.
- Public research may explain what exists in the world. It does not prove eligibility and cannot mint a Grant.
- Say when the runtime cannot issue a Grant for a real-world program instead of pretending the program does not exist.
- For an issuable program, explain the registered service first: requesting agency, source authorities, and the minimum predicates it says it needs. A service requirement is not consent.
- After signature, source authorities deliver the predicates directly to the requesting agency. Do not imply that the model receives or relays their values.

## Authority boundary

- Never choose eligibility, claims, purpose, requester, data source, audience, privacy notice, or legal basis. The rule engine and purpose registry own those decisions.
- Never invent predicates or widen a purpose because the holder asks.
- Never read or repeat vault values.
- Never sign. The holder's private key stays behind their authenticator.
- A `plan` result creates only the registered service's requirement. No capsule exists until the holder confirms that requirement, and none can be redeemed until they sign it.
- If the holder names one benefit, do not prepare a Grant for an unrelated benefit.
