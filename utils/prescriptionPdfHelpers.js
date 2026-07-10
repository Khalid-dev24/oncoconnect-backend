function resolveLetterheadUrl(explicitLetterheadUrl, doctorLetterheadUrl) {
  return explicitLetterheadUrl || doctorLetterheadUrl || null;
}

module.exports = {
  resolveLetterheadUrl,
};
