const { validateString, fetch, throwError, } = require('../util');
const debug = require('debug')('rpm:geocode');
const assert = require('assert');

const STATUS_OK = 'OK';
const BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const IGNORE_TYPES = ['political'];
const GeocoderError = 'GeocoderError';

const normalizeResult = ({ results, status, error_message }) => {
    status === STATUS_OK || throwError(error_message || status, GeocoderError, { status });
    assert(results.length > 0);
    const r = results[0];
    const address = {};
    r.address_components.forEach(({ long_name: long, short_name: short, types }) =>
        types.forEach(t => IGNORE_TYPES.indexOf(t) < 0 && (address[t] = { long, short }))
    );
    r.address = address;
    return r;
};

module.exports = ({ apiKey }) => {
    validateString(apiKey);

    const cache = {};
    const addresses = {};

    return async address => {
        validateString(address);
        let result = addresses[cache[address]];
        if (!result) {
            let url = new URL(BASE_URL);
            url.searchParams.append('key', apiKey);
            url.searchParams.append('address', address);
            url = url.toString();
            debug('GET %s', url);
            result = normalizeResult(await fetch(url).then(r => r.json()));
            const { place_id } = result;
            addresses[place_id] || (addresses[place_id] = result);
            cache[address] = place_id;
        }
        return result;
    };
};
