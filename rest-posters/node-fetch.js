const fetch = require('node-fetch');
const { fetch2json } = require('../util');

const core = (url, data, headers) => {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }).then(fetch2json);
};

module.exports = () => {
  return core;
};