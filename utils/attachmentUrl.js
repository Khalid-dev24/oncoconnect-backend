function buildAttachmentUrl(req, fileName) {
  const host = req.get('host') || req.get('x-forwarded-host') || 'localhost:4000';
  const forwardedProto = req.get('x-forwarded-proto');
  const protocol = (forwardedProto || req.protocol || 'http')
    .split(',')[0]
    .trim() || 'http';

  return `${protocol}://${host}/uploads/prescriptions/${encodeURIComponent(fileName)}`;
}

module.exports = {
  buildAttachmentUrl,
};
