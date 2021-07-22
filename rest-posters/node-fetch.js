const fetch = require('node-fetch');
const assert = require('assert');

const fetch2json = async response => {
  assert(response instanceof fetch.Response);
  response = await response.text();
  try {
    return JSON.parse(response);
  } catch (e) {
    console.error(response);
    throw e;
  }
};

function core(url, data, headers) {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }).then(fetch2json);
}

module.exports = function () {
  return core;
};