const client = new (require('node-rest-client').Client)();
const Api = require('./api-wrappers').RpmApi;

function core(url, data, headers) {
  return new Promise(resolve => {
    client.post(url, { headers, data }, resolve);
  });
}

module.exports = function (url, key) {
  return Api.call(this, url, key, core);
};