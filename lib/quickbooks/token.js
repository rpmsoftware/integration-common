const { validateString, normalizeInteger } = require('../util');
const THRESHOLD = 10 * 1000; // 10 seconds
const REFRESH_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours

module.exports = class Token {
    constructor({
        x_refresh_token_expires_in,
        refresh_token,
        access_token,
        expires_in,
        realmID
    }) {
        const now = Date.now();
        this.refreshToken = validateString(refresh_token);
        this.accessToken = validateString(access_token);
        this.refreshTokenExpiresIn = normalizeInteger(x_refresh_token_expires_in);
        this.refreshTokenExpires = now + this.refreshTokenExpiresIn * 1000;
        this.accessTokenExpires = now + normalizeInteger(expires_in) * 1000;
        this.realmID = realmID ? validateString(realmID) : undefined;
    }

    get isAccessTokenValid() {
        return this.accessTokenExpires - Date.now() > THRESHOLD;
    }

    get isRefreshTokenNeedsRenewal() {
        return this.refreshTokenExpires - Date.now() < REFRESH_THRESHOLD;
    }

    get isRefreshTokenValid() {
        return this.refreshTokenExpires - Date.now() > THRESHOLD;
    }
};

