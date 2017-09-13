const fetch = require('node-fetch');
const Api = require('./api-wrappers').RpmApi;

function core(url, data, headers) {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }).then((response) => response.json());
}

module.exports = function (url, key) {
  return new Api(url, key, core);
};
