/*global fetch*/

function core(url, data, headers) {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }).then((response) => response.json());
}

module.exports = function () {
  return core;
};