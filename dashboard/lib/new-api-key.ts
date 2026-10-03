/**
 * The new account's API key, handed from signup to onboarding.
 *
 * The gateway returns a tenant's key exactly once, at creation, and stores
 * only its hash. Signup used to discard it, so every new customer met a
 * "rp_live_YOUR_KEY" placeholder and had to find Settings to make another.
 * sessionStorage carries it across the one redirect and a refresh, and it is
 * gone when the tab closes.
 */
export const NEW_KEY_STORAGE = "repath-new-api-key";
