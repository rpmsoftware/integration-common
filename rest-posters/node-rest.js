const Client = require('node-rest-client').Client;

module.exports = function () {
  const client = new Client({ connection: { maxBodyLength: Infinity } });
  return (url, data, headers) => new Promise(resolve => client.post(url, { headers, data }, resolve));
};
