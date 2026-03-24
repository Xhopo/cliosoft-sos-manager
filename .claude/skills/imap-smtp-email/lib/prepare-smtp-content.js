function prepareSmtpContent(options) {
  const prepared = { ...options };

  if (prepared.body) {
    if (prepared.html === true) {
      prepared.html = prepared.body;
      delete prepared.text;
    } else {
      prepared.text = prepared.body;
    }
  }

  return prepared;
}

module.exports = {
  prepareSmtpContent,
};
