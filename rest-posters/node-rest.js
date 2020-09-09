const { Client } = require('node-rest-client');

module.exports = function () {
  const client = new Client({ connection: { maxBodyLength: Infinity } });
  return (url, data, headers) => new Promise((resolve, reject) => client.post(url, { headers, data }, resolve).on('error', reject));
};
