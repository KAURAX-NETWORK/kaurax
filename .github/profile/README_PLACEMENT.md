# How to publish this profile

GitHub renders an organization profile from a **separate repository named `.github`**, at the
path `profile/README.md` — not from this file's location inside the monorepo.

To publish it:

1. Create `https://github.com/KAURAX-NETWORK/.github` (public)
2. Copy [`README.md`](README.md) from this directory to `profile/README.md` in that repository
3. Commit and push

This copy is kept here so the profile text is version-controlled alongside the code it
describes, and so a change to the trust model can be made in both places in one review.

**Both copies must be updated together.** If the org profile ever states a stronger security
property than [`docs/SECURITY_MODEL.md`](../../docs/SECURITY_MODEL.md), the profile is wrong.

*No repository has been created and nothing has been pushed. This is a documented manual step.*
